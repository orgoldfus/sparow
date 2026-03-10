use std::{collections::HashSet, sync::Arc};

use percent_encoding::percent_decode_str;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio::task::JoinError;
use tracing::{error, info};
use uuid::Uuid;

use crate::{
    connections::{ActiveSessionRuntime, ConnectionService},
    foundation::{
        iso_timestamp, AppError, DiagnosticsStore, ListSchemaChildrenRequest,
        ListSchemaChildrenResult, RefreshSchemaScopeRequest, SchemaCacheStatus,
        SchemaRefreshAccepted, SchemaRefreshProgressEvent, SchemaRefreshStatus, SchemaScopeKind,
        SchemaSearchRequest, SchemaSearchResult, SCHEMA_REFRESH_EVENT,
    },
    persistence::{ReplaceSchemaScopeRecord, Repository},
};

use super::introspection::SchemaIntrospectionDriver;

const STALE_AFTER_SECONDS: i64 = 120;

#[derive(Debug, Clone)]
pub(crate) struct ParsedScope {
    pub(crate) kind: SchemaScopeKind,
    pub(crate) path: Option<String>,
    pub(crate) schema_name: Option<String>,
    pub(crate) relation_name: Option<String>,
}

#[derive(Clone)]
pub(crate) struct SchemaService {
    repository: Arc<Repository>,
    connections: ConnectionService,
    diagnostics: DiagnosticsStore,
    driver: Arc<dyn SchemaIntrospectionDriver>,
    in_flight: Arc<Mutex<HashSet<String>>>,
}

impl SchemaService {
    pub(crate) fn new(
        repository: Arc<Repository>,
        connections: ConnectionService,
        diagnostics: DiagnosticsStore,
        driver: Arc<dyn SchemaIntrospectionDriver>,
    ) -> Self {
        Self {
            repository,
            connections,
            diagnostics,
            driver,
            in_flight: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    pub(crate) async fn list_children(
        &self,
        app: Option<AppHandle>,
        request: ListSchemaChildrenRequest,
    ) -> Result<ListSchemaChildrenResult, AppError> {
        let scope = parse_scope(request.parent_kind, request.parent_path.as_deref())?;
        let session = self
            .connections
            .active_session_runtime(&request.connection_id)
            .await?;
        let repository = self.repository.clone();
        let connection_id = request.connection_id.clone();
        let scope_path = scope.path.clone();
        let cached = tokio::task::spawn_blocking(move || {
            repository.load_schema_scope(&connection_id, scope_path.as_deref())
        })
        .await
        .map_err(|error| {
            AppError::internal(
                "schema_cache_read_failed",
                "Failed to join schema cache read task.",
                Some(error.to_string()),
            )
        })??;

        let cache_status = cache_status_for(&cached);
        let mut refresh_in_flight = self
            .refresh_in_flight(&request.connection_id, scope.kind, scope.path.as_deref())
            .await;

        if matches!(
            cache_status,
            SchemaCacheStatus::Empty | SchemaCacheStatus::Stale
        ) {
            let refresh_started = self.ensure_refresh(app, session, scope).await?.is_some();
            refresh_in_flight = refresh_in_flight || refresh_started;
        }

        if matches!(cache_status, SchemaCacheStatus::Empty)
            && !refresh_in_flight
            && cached.nodes.is_empty()
        {
            return Err(AppError::retryable(
                "schema_cache_read_failed",
                "No cached schema nodes were available for the requested scope.",
                request.parent_path,
            ));
        }

        Ok(ListSchemaChildrenResult {
            connection_id: request.connection_id,
            parent_kind: request.parent_kind,
            parent_path: request.parent_path,
            cache_status,
            refresh_in_flight,
            refreshed_at: cached.refreshed_at,
            nodes: cached.nodes,
        })
    }

    pub(crate) async fn refresh_scope(
        &self,
        app: Option<AppHandle>,
        request: RefreshSchemaScopeRequest,
    ) -> Result<SchemaRefreshAccepted, AppError> {
        let scope = parse_scope(request.scope_kind, request.scope_path.as_deref())?;
        let session = self
            .connections
            .active_session_runtime(&request.connection_id)
            .await?;

        self.ensure_refresh(app, session, scope)
            .await?
            .ok_or_else(|| {
                AppError::retryable(
                    "schema_refresh_already_running",
                    "A schema refresh is already running for this scope.",
                    request.scope_path,
                )
            })
    }

    pub(crate) async fn search_cache(
        &self,
        request: SchemaSearchRequest,
    ) -> Result<SchemaSearchResult, AppError> {
        let _ = self
            .connections
            .active_session_runtime(&request.connection_id)
            .await?;

        let repository = self.repository.clone();
        let connection_id = request.connection_id.clone();
        let query = request.query.clone();
        let limit = request.limit;
        let nodes = tokio::task::spawn_blocking(move || {
            repository.search_schema_nodes(&connection_id, &query, limit)
        })
        .await
        .map_err(|error| {
            AppError::internal(
                "schema_cache_read_failed",
                "Failed to join schema cache search task.",
                Some(error.to_string()),
            )
        })??;

        Ok(SchemaSearchResult {
            connection_id: request.connection_id,
            query: request.query,
            nodes,
        })
    }

    async fn ensure_refresh(
        &self,
        app: Option<AppHandle>,
        session: ActiveSessionRuntime,
        scope: ParsedScope,
    ) -> Result<Option<SchemaRefreshAccepted>, AppError> {
        let key = refresh_key(
            &session.snapshot.connection_id,
            scope.kind,
            scope.path.as_deref(),
        );
        let mut guard = self.in_flight.lock().await;
        if guard.contains(&key) {
            return Ok(None);
        }

        let accepted = SchemaRefreshAccepted {
            job_id: Uuid::new_v4().to_string(),
            correlation_id: Uuid::new_v4().to_string(),
            connection_id: session.snapshot.connection_id.clone(),
            scope_kind: scope.kind,
            scope_path: scope.path.clone(),
            started_at: iso_timestamp(),
        };
        guard.insert(key.clone());
        drop(guard);

        if let Some(app) = app.as_ref() {
            let queued_event = SchemaRefreshProgressEvent {
                job_id: accepted.job_id.clone(),
                correlation_id: accepted.correlation_id.clone(),
                connection_id: accepted.connection_id.clone(),
                scope_kind: accepted.scope_kind,
                scope_path: accepted.scope_path.clone(),
                status: SchemaRefreshStatus::Queued,
                nodes_written: 0,
                message: schema_scope_message(
                    "Queued refresh for",
                    scope.kind,
                    scope.path.as_deref(),
                ),
                timestamp: accepted.started_at.clone(),
                last_error: None,
            };

            if let Err(error) = emit_schema_refresh_event(app, &queued_event) {
                let mut guard = self.in_flight.lock().await;
                let _ = guard.remove(&key);
                return Err(error);
            }
        }

        let service = self.clone();
        let accepted_for_task = accepted.clone();
        let accepted_for_cleanup = accepted.clone();
        let app_for_cleanup = app.clone();
        let scope_kind = scope.kind;
        let scope_path = scope.path.clone();
        tokio::spawn(async move {
            let join_result = tokio::spawn({
                let service = service.clone();
                let app = app.clone();
                async move {
                    service
                        .run_refresh_job(app, session, scope, accepted_for_task)
                        .await;
                }
            })
            .await;

            if let Err(error) = join_result {
                service
                    .persist_refresh_failure(
                        accepted_for_cleanup.connection_id.clone(),
                        scope_kind,
                        scope_path.clone(),
                    )
                    .await
                    .unwrap_or_else(|persist_error| {
                        service.report_refresh_failure_persistence_error(
                            scope_kind,
                            scope_path.as_deref(),
                            &persist_error,
                        );
                    });
                service.record_refresh_failure(
                    app_for_cleanup.as_ref(),
                    &accepted_for_cleanup,
                    scope_kind,
                    scope_path.as_deref(),
                    refresh_task_error(error),
                );
            }

            let mut guard = service.in_flight.lock().await;
            let _ = guard.remove(&key);
        });

        Ok(Some(accepted))
    }

    async fn run_refresh_job(
        &self,
        app: Option<AppHandle>,
        session: ActiveSessionRuntime,
        scope: ParsedScope,
        accepted: SchemaRefreshAccepted,
    ) {
        let running_event = SchemaRefreshProgressEvent {
            job_id: accepted.job_id.clone(),
            correlation_id: accepted.correlation_id.clone(),
            connection_id: accepted.connection_id.clone(),
            scope_kind: accepted.scope_kind,
            scope_path: accepted.scope_path.clone(),
            status: SchemaRefreshStatus::Running,
            nodes_written: 0,
            message: schema_scope_message("Refreshing", scope.kind, scope.path.as_deref()),
            timestamp: iso_timestamp(),
            last_error: None,
        };
        if let Some(app) = app.as_ref() {
            if let Err(error) = emit_schema_refresh_event(app, &running_event) {
                self.diagnostics.record_error(error);
            }
        }

        let refreshed_at = iso_timestamp();
        let introspection = self
            .driver
            .introspect_scope(&session, &scope, &refreshed_at)
            .await;

        match introspection {
            Ok(nodes) => {
                let repository = self.repository.clone();
                let connection_id = accepted.connection_id.clone();
                let scope_kind = scope.kind;
                let scope_path = scope.path.clone();
                let refresh_result = tokio::task::spawn_blocking(move || {
                    repository.replace_schema_scope(ReplaceSchemaScopeRecord {
                        connection_id,
                        scope_kind,
                        scope_path,
                        refreshed_at,
                        refresh_status: "fresh".to_string(),
                        nodes,
                    })
                })
                .await;

                match refresh_result {
                    Ok(Ok(scope_record)) => {
                        let completed_event = SchemaRefreshProgressEvent {
                            job_id: accepted.job_id.clone(),
                            correlation_id: accepted.correlation_id.clone(),
                            connection_id: accepted.connection_id.clone(),
                            scope_kind: accepted.scope_kind,
                            scope_path: accepted.scope_path.clone(),
                            status: SchemaRefreshStatus::Completed,
                            nodes_written: scope_record.nodes.len(),
                            message: schema_scope_message(
                                "Completed refresh for",
                                scope.kind,
                                scope.path.as_deref(),
                            ),
                            timestamp: iso_timestamp(),
                            last_error: None,
                        };
                        if let Some(app) = app.as_ref() {
                            if let Err(error) = emit_schema_refresh_event(app, &completed_event) {
                                self.diagnostics.record_error(error);
                            }
                        }
                        info!(
                            connection_id = %accepted.connection_id,
                            scope = ?accepted.scope_path,
                            nodes_written = scope_record.nodes.len(),
                            "refreshed schema scope"
                        );
                    }
                    Ok(Err(error)) => {
                        self.persist_refresh_failure(
                            accepted.connection_id.clone(),
                            scope.kind,
                            scope.path.clone(),
                        )
                        .await
                        .unwrap_or_else(|persist_error| {
                            self.report_refresh_failure_persistence_error(
                                scope.kind,
                                scope.path.as_deref(),
                                &persist_error,
                            );
                        });
                        self.record_refresh_failure(
                            app.as_ref(),
                            &accepted,
                            scope.kind,
                            scope.path.as_deref(),
                            error,
                        );
                    }
                    Err(error) => {
                        let join_error = AppError::internal(
                            "schema_cache_write_failed",
                            "Failed to join schema cache write task.",
                            Some(error.to_string()),
                        );
                        self.persist_refresh_failure(
                            accepted.connection_id.clone(),
                            scope.kind,
                            scope.path.clone(),
                        )
                        .await
                        .unwrap_or_else(|persist_error| {
                            self.report_refresh_failure_persistence_error(
                                scope.kind,
                                scope.path.as_deref(),
                                &persist_error,
                            );
                        });
                        self.record_refresh_failure(
                            app.as_ref(),
                            &accepted,
                            scope.kind,
                            scope.path.as_deref(),
                            join_error,
                        );
                    }
                }
            }
            Err(error) => {
                self.persist_refresh_failure(
                    accepted.connection_id.clone(),
                    scope.kind,
                    scope.path.clone(),
                )
                .await
                .unwrap_or_else(|persist_error| {
                    self.report_refresh_failure_persistence_error(
                        scope.kind,
                        scope.path.as_deref(),
                        &persist_error,
                    );
                });
                self.record_refresh_failure(
                    app.as_ref(),
                    &accepted,
                    scope.kind,
                    scope.path.as_deref(),
                    error,
                );
            }
        }
    }

    fn record_refresh_failure(
        &self,
        app: Option<&AppHandle>,
        accepted: &SchemaRefreshAccepted,
        scope_kind: SchemaScopeKind,
        scope_path: Option<&str>,
        error: AppError,
    ) {
        self.diagnostics.record_error(error.clone());
        let event = SchemaRefreshProgressEvent {
            job_id: accepted.job_id.clone(),
            correlation_id: accepted.correlation_id.clone(),
            connection_id: accepted.connection_id.clone(),
            scope_kind,
            scope_path: scope_path.map(ToOwned::to_owned),
            status: SchemaRefreshStatus::Failed,
            nodes_written: 0,
            message: schema_scope_message("Refresh failed for", scope_kind, scope_path),
            timestamp: iso_timestamp(),
            last_error: Some(error.clone()),
        };
        if let Some(app) = app {
            if let Err(emit_error) = emit_schema_refresh_event(app, &event) {
                self.diagnostics.record_error(emit_error);
            }
        }
        error!(?error, scope = ?scope_path, "schema refresh failed");
    }

    async fn persist_refresh_failure(
        &self,
        connection_id: String,
        scope_kind: SchemaScopeKind,
        scope_path: Option<String>,
    ) -> Result<(), AppError> {
        let repository = self.repository.clone();
        let refreshed_at = iso_timestamp();
        let write_result = tokio::task::spawn_blocking(move || {
            repository.record_schema_scope_failure(
                &connection_id,
                scope_kind,
                scope_path.as_deref(),
                &refreshed_at,
            )
        })
        .await;

        match write_result {
            Ok(inner_result) => inner_result,
            Err(error) => Err(AppError::internal(
                "schema_scope_failure_persist_join_failed",
                "Failed to join schema failure persistence task.",
                Some(error.to_string()),
            )),
        }
    }

    fn report_refresh_failure_persistence_error(
        &self,
        scope_kind: SchemaScopeKind,
        scope_path: Option<&str>,
        error: &AppError,
    ) {
        self.diagnostics.record_error(error.clone());
        error!(
            ?error,
            scope_kind = ?scope_kind,
            scope = ?scope_path,
            "failed to persist schema refresh failure metadata"
        );
    }

    async fn refresh_in_flight(
        &self,
        connection_id: &str,
        scope_kind: SchemaScopeKind,
        scope_path: Option<&str>,
    ) -> bool {
        self.in_flight
            .lock()
            .await
            .contains(&refresh_key(connection_id, scope_kind, scope_path))
    }
}

fn parse_scope(kind: SchemaScopeKind, path: Option<&str>) -> Result<ParsedScope, AppError> {
    match kind {
        SchemaScopeKind::Root => {
            if path.is_some() {
                return Err(AppError::internal(
                    "schema_scope_parse_failed",
                    "Root scope requests must not include a scope path.",
                    path.map(str::to_owned),
                ));
            }

            Ok(ParsedScope {
                kind,
                path: None,
                schema_name: None,
                relation_name: None,
            })
        }
        SchemaScopeKind::Schema => {
            let path = path.ok_or_else(|| {
                AppError::internal(
                    "schema_scope_parse_failed",
                    "Schema scope requests require a schema path.",
                    None,
                )
            })?;
            let mut parts = path.split('/');
            match (parts.next(), parts.next(), parts.next(), parts.next()) {
                (Some("schema"), Some(schema_name), None, None) => {
                    let schema_name = decode_scope_segment(schema_name, path)?;
                    Ok(ParsedScope {
                        kind,
                        path: Some(path.to_string()),
                        schema_name: Some(schema_name),
                        relation_name: None,
                    })
                }
                _ => Err(AppError::internal(
                    "schema_scope_parse_failed",
                    "Schema scope path was invalid.",
                    Some(path.to_string()),
                )),
            }
        }
        SchemaScopeKind::Table | SchemaScopeKind::View => {
            let path = path.ok_or_else(|| {
                AppError::internal(
                    "schema_scope_parse_failed",
                    "Relation scope requests require a relation path.",
                    None,
                )
            })?;
            let expected_prefix = if matches!(kind, SchemaScopeKind::Table) {
                "table"
            } else {
                "view"
            };
            let mut parts = path.split('/');
            match (parts.next(), parts.next(), parts.next(), parts.next()) {
                (Some(prefix), Some(schema_name), Some(relation_name), None)
                    if prefix == expected_prefix =>
                {
                    let schema_name = decode_scope_segment(schema_name, path)?;
                    let relation_name = decode_scope_segment(relation_name, path)?;
                    Ok(ParsedScope {
                        kind,
                        path: Some(path.to_string()),
                        schema_name: Some(schema_name),
                        relation_name: Some(relation_name),
                    })
                }
                _ => Err(AppError::internal(
                    "schema_scope_parse_failed",
                    "Relation scope path was invalid.",
                    Some(path.to_string()),
                )),
            }
        }
    }
}

fn decode_scope_segment(segment: &str, path: &str) -> Result<String, AppError> {
    let decoded = percent_decode_str(segment)
        .decode_utf8()
        .map_err(|_| {
            AppError::internal(
                "schema_scope_parse_failed",
                "Schema scope path was invalid.",
                Some(path.to_string()),
            )
        })?
        .into_owned();

    if decoded.is_empty() {
        return Err(AppError::internal(
            "schema_scope_parse_failed",
            "Schema scope path was invalid.",
            Some(path.to_string()),
        ));
    }

    Ok(decoded)
}

fn cache_status_for(cached: &crate::persistence::CachedSchemaScopeRecord) -> SchemaCacheStatus {
    if cached.refresh_status.as_deref() == Some("failed") {
        return if cached.nodes.is_empty() {
            SchemaCacheStatus::Empty
        } else {
            SchemaCacheStatus::Stale
        };
    }

    match cached.refreshed_at.as_deref() {
        None => SchemaCacheStatus::Empty,
        Some(refreshed_at) => {
            if is_stale(refreshed_at) {
                SchemaCacheStatus::Stale
            } else {
                SchemaCacheStatus::Fresh
            }
        }
    }
}

fn is_stale(refreshed_at: &str) -> bool {
    let cutoff = (time::OffsetDateTime::now_utc() - time::Duration::seconds(STALE_AFTER_SECONDS))
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string());
    refreshed_at < cutoff.as_str()
}

fn refresh_key(
    connection_id: &str,
    scope_kind: SchemaScopeKind,
    scope_path: Option<&str>,
) -> String {
    format!(
        "{connection_id}::{:?}::{}",
        scope_kind,
        scope_path.unwrap_or("")
    )
}

fn emit_schema_refresh_event(
    app: &AppHandle,
    event: &SchemaRefreshProgressEvent,
) -> Result<(), AppError> {
    app.emit(SCHEMA_REFRESH_EVENT, event).map_err(|error| {
        AppError::internal(
            "schema_refresh_emit_failed",
            "Failed to emit a schema refresh event.",
            Some(error.to_string()),
        )
    })
}

fn schema_scope_message(
    prefix: &str,
    scope_kind: SchemaScopeKind,
    scope_path: Option<&str>,
) -> String {
    match scope_path {
        Some(scope_path) => format!("{prefix} {scope_kind:?} scope {scope_path}."),
        None => format!("{prefix} root schema scope."),
    }
}

fn refresh_task_error(error: JoinError) -> AppError {
    if error.is_panic() {
        return AppError::internal(
            "schema_refresh_panicked",
            "Schema refresh panicked before it could finish.",
            Some(error.to_string()),
        );
    }

    AppError::internal(
        "schema_refresh_task_failed",
        "Schema refresh task ended unexpectedly.",
        Some(error.to_string()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        connections::{MemorySecretStore, RuntimePostgresDriver},
        foundation::{
            AppPaths, ConnectionDraft, DatabaseEngine, DiagnosticsStore, SaveConnectionRequest,
            SchemaNode, SchemaNodeBase, SchemaNodeKind, SslMode,
        },
        schema::introspection::{
            encode_scope_segment, relation_kind_matches_scope, schema_node_id,
            RuntimeSchemaIntrospectionDriver, SchemaIntrospectionDriver,
        },
    };
    use async_trait::async_trait;
    use std::{collections::HashSet, path::PathBuf};

    #[derive(Clone)]
    struct FakeSchemaDriver {
        fail_scopes: Arc<HashSet<String>>,
        panic_scopes: Arc<HashSet<String>>,
    }

    #[async_trait]
    impl SchemaIntrospectionDriver for FakeSchemaDriver {
        async fn introspect_scope(
            &self,
            session: &ActiveSessionRuntime,
            scope: &ParsedScope,
            refreshed_at: &str,
        ) -> Result<Vec<SchemaNode>, AppError> {
            let key = refresh_key(
                &session.snapshot.connection_id,
                scope.kind,
                scope.path.as_deref(),
            );
            if self.fail_scopes.contains(&key) {
                return Err(AppError::retryable(
                    "schema_introspection_query_failed",
                    "fake driver failure",
                    scope.path.clone(),
                ));
            }
            if self.panic_scopes.contains(&key) {
                panic!("fake schema panic for {key}");
            }

            Ok(match scope.kind {
                SchemaScopeKind::Root => vec![SchemaNode::Schema {
                    base: SchemaNodeBase {
                        id: schema_node_id(&session.snapshot.connection_id, "schema/public"),
                        connection_id: session.snapshot.connection_id.clone(),
                        name: "public".to_string(),
                        path: "schema/public".to_string(),
                        parent_path: None,
                        schema_name: "public".to_string(),
                        relation_name: None,
                        has_children: true,
                        refreshed_at: refreshed_at.to_string(),
                    },
                }],
                SchemaScopeKind::Schema => vec![SchemaNode::Table {
                    base: SchemaNodeBase {
                        id: schema_node_id(&session.snapshot.connection_id, "table/public/users"),
                        connection_id: session.snapshot.connection_id.clone(),
                        name: "users".to_string(),
                        path: "table/public/users".to_string(),
                        parent_path: Some("schema/public".to_string()),
                        schema_name: "public".to_string(),
                        relation_name: Some("users".to_string()),
                        has_children: true,
                        refreshed_at: refreshed_at.to_string(),
                    },
                }],
                SchemaScopeKind::Table | SchemaScopeKind::View => vec![
                    SchemaNode::Column {
                        base: SchemaNodeBase {
                            id: schema_node_id(
                                &session.snapshot.connection_id,
                                "column/public/users/email",
                            ),
                            connection_id: session.snapshot.connection_id.clone(),
                            name: "email".to_string(),
                            path: "column/public/users/email".to_string(),
                            parent_path: Some("table/public/users".to_string()),
                            schema_name: "public".to_string(),
                            relation_name: Some("users".to_string()),
                            has_children: false,
                            refreshed_at: refreshed_at.to_string(),
                        },
                        data_type: "text".to_string(),
                        is_nullable: false,
                        ordinal_position: 1,
                    },
                    SchemaNode::Index {
                        base: SchemaNodeBase {
                            id: schema_node_id(
                                &session.snapshot.connection_id,
                                "index/public/users/users_email_idx",
                            ),
                            connection_id: session.snapshot.connection_id.clone(),
                            name: "users_email_idx".to_string(),
                            path: "index/public/users/users_email_idx".to_string(),
                            parent_path: Some("table/public/users".to_string()),
                            schema_name: "public".to_string(),
                            relation_name: Some("users".to_string()),
                            has_children: false,
                            refreshed_at: refreshed_at.to_string(),
                        },
                        column_names: vec!["email".to_string()],
                        is_unique: true,
                    },
                ],
            })
        }
    }

    #[tokio::test]
    async fn lists_root_scope_from_fake_driver() {
        let service = test_service(FakeSchemaDriver {
            fail_scopes: Arc::new(HashSet::new()),
            panic_scopes: Arc::new(HashSet::new()),
        })
        .await;

        let result = service
            .refresh_scope(
                None,
                RefreshSchemaScopeRequest {
                    connection_id: "conn-local-postgres".to_string(),
                    scope_kind: SchemaScopeKind::Root,
                    scope_path: None,
                },
            )
            .await
            .expect("refresh should start");

        wait_for_idle(&service).await;

        let loaded = service
            .list_children(
                None,
                ListSchemaChildrenRequest {
                    connection_id: "conn-local-postgres".to_string(),
                    parent_kind: SchemaScopeKind::Root,
                    parent_path: None,
                },
            )
            .await
            .expect("root scope should load");

        assert!(!result.job_id.is_empty());
        assert_eq!(loaded.cache_status, SchemaCacheStatus::Fresh);
        assert_eq!(loaded.nodes[0].kind(), SchemaNodeKind::Schema);
    }

    #[tokio::test]
    async fn uses_stale_cache_when_refresh_fails() {
        let fail_scopes = Arc::new(HashSet::from([refresh_key(
            "conn-local-postgres",
            SchemaScopeKind::Table,
            Some("table/public/users"),
        )]));
        let service = test_service(FakeSchemaDriver {
            fail_scopes,
            panic_scopes: Arc::new(HashSet::new()),
        })
        .await;

        service
            .repository
            .replace_schema_scope(ReplaceSchemaScopeRecord {
                connection_id: "conn-local-postgres".to_string(),
                scope_kind: SchemaScopeKind::Table,
                scope_path: Some("table/public/users".to_string()),
                refreshed_at: "2026-03-01T00:00:00.000Z".to_string(),
                refresh_status: "fresh".to_string(),
                nodes: vec![SchemaNode::Column {
                    base: SchemaNodeBase {
                        id: schema_node_id("conn-local-postgres", "column/public/users/email"),
                        connection_id: "conn-local-postgres".to_string(),
                        name: "email".to_string(),
                        path: "column/public/users/email".to_string(),
                        parent_path: Some("table/public/users".to_string()),
                        schema_name: "public".to_string(),
                        relation_name: Some("users".to_string()),
                        has_children: false,
                        refreshed_at: "2026-03-01T00:00:00.000Z".to_string(),
                    },
                    data_type: "text".to_string(),
                    is_nullable: false,
                    ordinal_position: 1,
                }],
            })
            .expect("cache seed should succeed");

        let loaded = service
            .list_children(
                None,
                ListSchemaChildrenRequest {
                    connection_id: "conn-local-postgres".to_string(),
                    parent_kind: SchemaScopeKind::Table,
                    parent_path: Some("table/public/users".to_string()),
                },
            )
            .await
            .expect("stale cache should still load");

        wait_for_idle(&service).await;

        assert_eq!(loaded.cache_status, SchemaCacheStatus::Stale);
        assert_eq!(loaded.nodes.len(), 1);
    }

    #[test]
    fn classifies_failed_empty_cache_as_empty() {
        let cached = crate::persistence::CachedSchemaScopeRecord {
            refreshed_at: Some("2026-03-09T18:15:00.000Z".to_string()),
            refresh_status: Some("failed".to_string()),
            nodes: Vec::new(),
        };

        assert_eq!(cache_status_for(&cached), SchemaCacheStatus::Empty);
    }

    #[test]
    fn classifies_failed_cache_with_nodes_as_stale() {
        let cached = crate::persistence::CachedSchemaScopeRecord {
            refreshed_at: Some("2026-03-09T18:15:00.000Z".to_string()),
            refresh_status: Some("failed".to_string()),
            nodes: vec![SchemaNode::Column {
                base: SchemaNodeBase {
                    id: schema_node_id("conn-local-postgres", "column/public/users/email"),
                    connection_id: "conn-local-postgres".to_string(),
                    name: "email".to_string(),
                    path: "column/public/users/email".to_string(),
                    parent_path: Some("table/public/users".to_string()),
                    schema_name: "public".to_string(),
                    relation_name: Some("users".to_string()),
                    has_children: false,
                    refreshed_at: "2026-03-09T18:15:00.000Z".to_string(),
                },
                data_type: "text".to_string(),
                is_nullable: false,
                ordinal_position: 1,
            }],
        };

        assert_eq!(cache_status_for(&cached), SchemaCacheStatus::Stale);
    }

    #[test]
    fn schema_node_ids_are_namespaced_by_connection() {
        assert_ne!(
            schema_node_id("conn-a", "schema/public"),
            schema_node_id("conn-b", "schema/public")
        );
        assert_eq!(
            schema_node_id("conn-a", "schema/public"),
            "conn-a:schema/public"
        );
    }

    #[test]
    fn rejects_malformed_root_scope_paths() {
        let error = parse_scope(SchemaScopeKind::Root, Some("schema/public"))
            .expect_err("root scope should reject a path");

        assert_eq!(error.code, "schema_scope_parse_failed");
    }

    #[test]
    fn rejects_malformed_schema_scope_paths() {
        for path in ["schema/", "schema/public/extra"] {
            let error = parse_scope(SchemaScopeKind::Schema, Some(path))
                .expect_err("schema scope should reject malformed paths");
            assert_eq!(error.code, "schema_scope_parse_failed");
        }
    }

    #[test]
    fn rejects_malformed_relation_scope_paths() {
        for path in ["table/public/", "view//users", "table/public/users/extra"] {
            let error = parse_scope(SchemaScopeKind::Table, Some(path))
                .expect_err("relation scope should reject malformed paths");
            assert_eq!(error.code, "schema_scope_parse_failed");
        }
    }

    #[test]
    fn round_trips_percent_encoded_scope_segments() {
        let schema_path = format!("schema/{}", encode_scope_segment("sales/2024"));
        let schema_scope = parse_scope(SchemaScopeKind::Schema, Some(&schema_path))
            .expect("schema scope should parse");
        assert_eq!(schema_scope.schema_name.as_deref(), Some("sales/2024"));

        let relation_path = format!(
            "table/{}/{}",
            encode_scope_segment("sales/2024"),
            encode_scope_segment("orders/daily"),
        );
        let relation_scope = parse_scope(SchemaScopeKind::Table, Some(&relation_path))
            .expect("relation scope should parse");
        assert_eq!(relation_scope.schema_name.as_deref(), Some("sales/2024"));
        assert_eq!(
            relation_scope.relation_name.as_deref(),
            Some("orders/daily")
        );
    }

    #[test]
    fn relation_scope_kind_matches_postgres_relkind() {
        assert!(relation_kind_matches_scope(SchemaScopeKind::Table, "r"));
        assert!(relation_kind_matches_scope(SchemaScopeKind::Table, "p"));
        assert!(relation_kind_matches_scope(SchemaScopeKind::View, "v"));
        assert!(!relation_kind_matches_scope(SchemaScopeKind::Table, "v"));
        assert!(!relation_kind_matches_scope(SchemaScopeKind::View, "r"));
    }

    #[tokio::test]
    async fn rejects_schema_calls_without_active_session() {
        let repository = Arc::new(
            Repository::new(std::env::temp_dir().join("sparow-schema-no-session.sqlite3"))
                .expect("repository should initialize"),
        );
        let connections = ConnectionService::new(
            repository.clone(),
            Arc::new(MemorySecretStore::default()),
            Arc::new(crate::connections::RuntimePostgresDriver),
        );
        let service = SchemaService::new(
            repository,
            connections,
            DiagnosticsStore::new(),
            Arc::new(FakeSchemaDriver {
                fail_scopes: Arc::new(HashSet::new()),
                panic_scopes: Arc::new(HashSet::new()),
            }),
        );

        let error = service
            .search_cache(SchemaSearchRequest {
                connection_id: "conn-local-postgres".to_string(),
                query: "users".to_string(),
                limit: 5,
            })
            .await
            .expect_err("search should fail without a session");

        assert_eq!(error.code, "schema_no_active_session");
    }

    #[tokio::test]
    async fn deduplicates_refresh_jobs() {
        let service = test_service(FakeSchemaDriver {
            fail_scopes: Arc::new(HashSet::new()),
            panic_scopes: Arc::new(HashSet::new()),
        })
        .await;

        let first = service
            .refresh_scope(
                None,
                RefreshSchemaScopeRequest {
                    connection_id: "conn-local-postgres".to_string(),
                    scope_kind: SchemaScopeKind::Schema,
                    scope_path: Some("schema/public".to_string()),
                },
            )
            .await
            .expect("first refresh should start");

        let error = service
            .refresh_scope(
                None,
                RefreshSchemaScopeRequest {
                    connection_id: "conn-local-postgres".to_string(),
                    scope_kind: SchemaScopeKind::Schema,
                    scope_path: Some("schema/public".to_string()),
                },
            )
            .await
            .expect_err("duplicate refresh should fail");

        wait_for_idle(&service).await;

        assert!(!first.job_id.is_empty());
        assert_eq!(error.code, "schema_refresh_already_running");
    }

    #[tokio::test]
    async fn reports_in_flight_refresh_while_empty_scope_is_loading() {
        let service = test_service(FakeSchemaDriver {
            fail_scopes: Arc::new(HashSet::new()),
            panic_scopes: Arc::new(HashSet::new()),
        })
        .await;

        let accepted = service
            .refresh_scope(
                None,
                RefreshSchemaScopeRequest {
                    connection_id: "conn-local-postgres".to_string(),
                    scope_kind: SchemaScopeKind::Root,
                    scope_path: None,
                },
            )
            .await
            .expect("refresh should start");

        let loaded = service
            .list_children(
                None,
                ListSchemaChildrenRequest {
                    connection_id: "conn-local-postgres".to_string(),
                    parent_kind: SchemaScopeKind::Root,
                    parent_path: None,
                },
            )
            .await
            .expect("list should report the in-flight refresh");

        wait_for_idle(&service).await;

        assert!(!accepted.job_id.is_empty());
        assert_eq!(loaded.cache_status, SchemaCacheStatus::Empty);
        assert!(loaded.refresh_in_flight);
        assert!(loaded.nodes.is_empty());
    }

    #[tokio::test]
    async fn releases_in_flight_refresh_when_driver_panics() {
        let panic_scopes = Arc::new(HashSet::from([refresh_key(
            "conn-local-postgres",
            SchemaScopeKind::Schema,
            Some("schema/public"),
        )]));
        let service = test_service(FakeSchemaDriver {
            fail_scopes: Arc::new(HashSet::new()),
            panic_scopes,
        })
        .await;

        let first = service
            .refresh_scope(
                None,
                RefreshSchemaScopeRequest {
                    connection_id: "conn-local-postgres".to_string(),
                    scope_kind: SchemaScopeKind::Schema,
                    scope_path: Some("schema/public".to_string()),
                },
            )
            .await
            .expect("first refresh should start");

        wait_for_idle(&service).await;

        let second = service
            .refresh_scope(
                None,
                RefreshSchemaScopeRequest {
                    connection_id: "conn-local-postgres".to_string(),
                    scope_kind: SchemaScopeKind::Schema,
                    scope_path: Some("schema/public".to_string()),
                },
            )
            .await
            .expect("refresh should restart after a panic");

        let diagnostics = service.diagnostics.snapshot();
        let last_error = diagnostics.last_error.expect("panic should be recorded");

        assert!(!first.job_id.is_empty());
        assert!(!second.job_id.is_empty());
        assert_eq!(last_error.code, "schema_refresh_panicked");
    }

    #[tokio::test]
    async fn persist_refresh_failure_returns_repository_errors() {
        let (service, database_path) = test_service_with_database_path(FakeSchemaDriver {
            fail_scopes: Arc::new(HashSet::new()),
            panic_scopes: Arc::new(HashSet::new()),
        })
        .await;

        std::fs::remove_file(&database_path).expect("database file should be removable");
        std::fs::create_dir(&database_path).expect("database path should become a directory");

        let error = service
            .persist_refresh_failure(
                "conn-local-postgres".to_string(),
                SchemaScopeKind::Schema,
                Some("schema/public".to_string()),
            )
            .await
            .expect_err("persist failure should surface repository errors");

        assert_eq!(error.code, "sqlite_open_failed");
    }

    #[tokio::test]
    #[ignore = "requires explicit PostgreSQL environment variables"]
    async fn postgres_schema_smoke() {
        let host = std::env::var("SPAROW_PG_HOST").expect("SPAROW_PG_HOST should be set");
        let database =
            std::env::var("SPAROW_PG_DATABASE").expect("SPAROW_PG_DATABASE should be set");
        let username =
            std::env::var("SPAROW_PG_USERNAME").expect("SPAROW_PG_USERNAME should be set");
        let password =
            std::env::var("SPAROW_PG_PASSWORD").expect("SPAROW_PG_PASSWORD should be set");
        let port = std::env::var("SPAROW_PG_PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(5432);
        let ssl_mode = std::env::var("SPAROW_PG_SSL_MODE")
            .ok()
            .as_deref()
            .map(parse_ssl_mode)
            .transpose()
            .expect("SPAROW_PG_SSL_MODE should parse")
            .unwrap_or(SslMode::Prefer);

        let root = std::env::temp_dir().join(format!("sparow-schema-smoke-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("logs")).expect("logs directory should exist");
        let repository = Arc::new(
            Repository::new(root.join("sparow.sqlite3")).expect("repository should initialize"),
        );
        let connections = ConnectionService::new(
            repository.clone(),
            Arc::new(MemorySecretStore::default()),
            Arc::new(RuntimePostgresDriver),
        );
        let details = connections
            .save_connection(SaveConnectionRequest {
                id: None,
                draft: ConnectionDraft {
                    name: "Smoke".to_string(),
                    host,
                    port,
                    database,
                    username,
                    ssl_mode,
                    password: Some(password),
                },
            })
            .await
            .expect("connection should save");

        let session = connections
            .connect_saved_connection(&details.summary.id)
            .await
            .expect("connection should establish");
        assert_eq!(session.engine, DatabaseEngine::Postgresql);

        let service = SchemaService::new(
            repository,
            connections.clone(),
            DiagnosticsStore::new(),
            Arc::new(RuntimeSchemaIntrospectionDriver),
        );
        service
            .refresh_scope(
                None,
                RefreshSchemaScopeRequest {
                    connection_id: details.summary.id.clone(),
                    scope_kind: SchemaScopeKind::Root,
                    scope_path: None,
                },
            )
            .await
            .expect("root refresh should start");
        wait_for_idle(&service).await;

        let root_scope = service
            .list_children(
                None,
                ListSchemaChildrenRequest {
                    connection_id: details.summary.id.clone(),
                    parent_kind: SchemaScopeKind::Root,
                    parent_path: None,
                },
            )
            .await
            .expect("root scope should load");
        let schema_path = root_scope
            .nodes
            .iter()
            .find_map(|node| match node {
                SchemaNode::Schema { base } => Some(base.path.clone()),
                _ => None,
            })
            .expect("root scope should return at least one schema");

        service
            .refresh_scope(
                None,
                RefreshSchemaScopeRequest {
                    connection_id: details.summary.id.clone(),
                    scope_kind: SchemaScopeKind::Schema,
                    scope_path: Some(schema_path.clone()),
                },
            )
            .await
            .expect("schema refresh should start");
        wait_for_idle(&service).await;

        let schema_scope = service
            .list_children(
                None,
                ListSchemaChildrenRequest {
                    connection_id: details.summary.id,
                    parent_kind: SchemaScopeKind::Schema,
                    parent_path: Some(schema_path),
                },
            )
            .await
            .expect("schema scope should load");

        assert!(
            schema_scope
                .nodes
                .iter()
                .any(|node| matches!(node.kind(), SchemaNodeKind::Table | SchemaNodeKind::View)),
            "expected at least one table or view in the smoke schema scope"
        );
    }

    async fn test_service(driver: FakeSchemaDriver) -> SchemaService {
        test_service_with_database_path(driver).await.0
    }

    async fn test_service_with_database_path(driver: FakeSchemaDriver) -> (SchemaService, PathBuf) {
        let root = std::env::temp_dir().join(format!("sparow-schema-tests-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("logs")).expect("logs directory should exist");
        let database_path = root.join("sparow.sqlite3");
        let paths = AppPaths {
            database_path: database_path.clone(),
            log_file_path: root.join("logs/sparow.log"),
        };
        let repository = Arc::new(
            Repository::new(paths.database_path.clone()).expect("repository should initialize"),
        );
        let secret_store = Arc::new(MemorySecretStore::default());
        let driver_connection = Arc::new(crate::connections::RuntimePostgresDriver);
        let connections =
            ConnectionService::new(repository.clone(), secret_store, driver_connection);
        let session = ActiveSessionRuntime {
            snapshot: crate::foundation::DatabaseSessionSnapshot {
                connection_id: "conn-local-postgres".to_string(),
                name: "Local".to_string(),
                engine: crate::foundation::DatabaseEngine::Postgresql,
                database: "app_dev".to_string(),
                username: "sparow".to_string(),
                host: "127.0.0.1".to_string(),
                port: 5432,
                connected_at: "2026-03-09T18:15:00.000Z".to_string(),
                server_version: Some("PostgreSQL 17".to_string()),
                ssl_in_use: Some(true),
                status: crate::foundation::ConnectionSessionStatus::Connected,
            },
            pool: None,
        };
        connections.set_test_active_session(session).await;
        let service = SchemaService::new(
            repository,
            connections,
            DiagnosticsStore::new(),
            Arc::new(driver),
        );

        (service, database_path)
    }

    async fn wait_for_idle(service: &SchemaService) {
        for _ in 0..40 {
            if service.in_flight.lock().await.is_empty() {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        panic!("schema service did not become idle in time");
    }

    fn parse_ssl_mode(value: &str) -> Result<SslMode, String> {
        match value {
            "disable" => Ok(SslMode::Disable),
            "prefer" => Ok(SslMode::Prefer),
            "require" => Ok(SslMode::Require),
            "insecure" => Ok(SslMode::Insecure),
            other => Err(format!("unsupported smoke SSL mode: {other}")),
        }
    }
}
