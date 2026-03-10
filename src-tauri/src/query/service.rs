use std::{collections::HashMap, sync::Arc};

use tauri::AppHandle;
use tokio::{sync::Mutex, task};
use tokio_util::sync::CancellationToken;
use tracing::{error, info};
use uuid::Uuid;

use crate::{
    commands::emit_query_execution_event,
    connections::ConnectionService,
    foundation::{
        iso_timestamp, AppError, CancelQueryExecutionResult, DiagnosticsStore,
        QueryExecutionAccepted, QueryExecutionProgressEvent, QueryExecutionRequest,
        QueryExecutionStatus,
    },
    persistence::Repository,
};

use super::driver::{cancelled_query_error, QueryExecutionDriver};

#[derive(Clone)]
pub(crate) struct QueryService {
    repository: Arc<Repository>,
    connections: ConnectionService,
    diagnostics: DiagnosticsStore,
    driver: Arc<dyn QueryExecutionDriver>,
    jobs: crate::foundation::JobRegistry,
    tab_jobs: Arc<Mutex<HashMap<String, String>>>,
}

impl QueryService {
    pub(crate) fn new(
        repository: Arc<Repository>,
        connections: ConnectionService,
        diagnostics: DiagnosticsStore,
        driver: Arc<dyn QueryExecutionDriver>,
        jobs: crate::foundation::JobRegistry,
    ) -> Self {
        Self {
            repository,
            connections,
            diagnostics,
            driver,
            jobs,
            tab_jobs: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub(crate) async fn start_query(
        &self,
        app: Option<AppHandle>,
        request: QueryExecutionRequest,
    ) -> Result<QueryExecutionAccepted, AppError> {
        if request.sql.trim().is_empty() {
            let error = AppError::retryable(
                "query_empty_sql",
                "Run requires a non-empty SQL statement.",
                None,
            );
            self.diagnostics.record_error(error.clone());
            return Err(error);
        }

        if request.is_selection_multi_statement {
            let error = AppError::retryable(
                "query_multi_statement_selection",
                "Phase 4 only supports running a single selected statement at a time.",
                Some(request.tab_id.clone()),
            );
            self.diagnostics.record_error(error.clone());
            return Err(error);
        }

        let session = self
            .connections
            .active_session_runtime(&request.connection_id)
            .await
            .map_err(map_session_error)?;

        {
            let mut guard = self.tab_jobs.lock().await;
            if guard.contains_key(&request.tab_id) {
                let error = AppError::retryable(
                    "query_tab_already_running",
                    "Cancel the current query before starting another one in the same tab.",
                    Some(request.tab_id.clone()),
                );
                self.diagnostics.record_error(error.clone());
                return Err(error);
            }
            guard.insert(request.tab_id.clone(), String::new());
        }

        let job_id = Uuid::new_v4().to_string();
        let correlation_id = Uuid::new_v4().to_string();
        let started_at = iso_timestamp();
        let cancellation = CancellationToken::new();
        self.jobs.insert(job_id.clone(), cancellation.clone()).await;
        self.set_tab_job(&request.tab_id, &job_id).await;

        let accepted = QueryExecutionAccepted {
            job_id: job_id.clone(),
            correlation_id: correlation_id.clone(),
            tab_id: request.tab_id.clone(),
            connection_id: request.connection_id.clone(),
            started_at: started_at.clone(),
        };

        if let Some(app) = app.as_ref() {
            emit_query_execution_event(
                app,
                &QueryExecutionProgressEvent {
                    job_id: accepted.job_id.clone(),
                    correlation_id: accepted.correlation_id.clone(),
                    tab_id: accepted.tab_id.clone(),
                    connection_id: accepted.connection_id.clone(),
                    status: QueryExecutionStatus::Queued,
                    elapsed_ms: 0,
                    message: "Accepted query execution request.".to_string(),
                    started_at: accepted.started_at.clone(),
                    finished_at: None,
                    last_error: None,
                    result: None,
                },
            )?;
        }

        self.record_query_history(&request).await;

        let task_accepted = accepted.clone();
        let jobs = self.jobs.clone();
        let tab_jobs = self.tab_jobs.clone();
        let diagnostics = self.diagnostics.clone();
        let driver = self.driver.clone();
        let task_request = request.clone();
        task::spawn(async move {
            let maybe_app = app.clone();

            if let Some(app) = maybe_app.as_ref() {
                let running_event = QueryExecutionProgressEvent {
                    job_id: task_accepted.job_id.clone(),
                    correlation_id: task_accepted.correlation_id.clone(),
                    tab_id: task_accepted.tab_id.clone(),
                    connection_id: task_accepted.connection_id.clone(),
                    status: QueryExecutionStatus::Running,
                    elapsed_ms: 0,
                    message: "Running PostgreSQL query.".to_string(),
                    started_at: task_accepted.started_at.clone(),
                    finished_at: None,
                    last_error: None,
                    result: None,
                };

                if let Err(error) = emit_query_execution_event(app, &running_event) {
                    diagnostics.record_error(error.clone());
                    error!(?error, "failed to emit running query event");
                }
            }

            let (status, result, last_error, elapsed_ms, message) = match driver
                .run_query(session, task_request.sql.clone(), cancellation)
                .await
            {
                Ok((result, elapsed_ms)) => (
                    QueryExecutionStatus::Completed,
                    Some(result),
                    None,
                    elapsed_ms,
                    "Query completed.".to_string(),
                ),
                Err(error) if error.code == cancelled_query_error().code => (
                    QueryExecutionStatus::Cancelled,
                    None,
                    Some(error.clone()),
                    0,
                    "Query cancelled by user.".to_string(),
                ),
                Err(error) => (
                    QueryExecutionStatus::Failed,
                    None,
                    Some(error.clone()),
                    0,
                    error.message.clone(),
                ),
            };

            if let Some(error) = last_error.clone() {
                diagnostics.record_error(error);
            }

            if let Some(app) = maybe_app.as_ref() {
                let finished_event = QueryExecutionProgressEvent {
                    job_id: task_accepted.job_id.clone(),
                    correlation_id: task_accepted.correlation_id.clone(),
                    tab_id: task_accepted.tab_id.clone(),
                    connection_id: task_accepted.connection_id.clone(),
                    status,
                    elapsed_ms,
                    message,
                    started_at: task_accepted.started_at.clone(),
                    finished_at: Some(iso_timestamp()),
                    last_error,
                    result,
                };

                if let Err(error) = emit_query_execution_event(app, &finished_event) {
                    diagnostics.record_error(error.clone());
                    error!(?error, "failed to emit finished query event");
                }
            }

            jobs.remove(&task_accepted.job_id).await;
            clear_tab_job(&tab_jobs, &task_accepted.tab_id, &task_accepted.job_id).await;
            info!(job_id = %task_accepted.job_id, tab_id = %task_accepted.tab_id, "query job finished");
        });

        Ok(accepted)
    }

    pub(crate) async fn cancel_query(
        &self,
        job_id: String,
    ) -> Result<CancelQueryExecutionResult, AppError> {
        let cancelled = self.jobs.cancel(&job_id).await;

        if !cancelled {
            let error = AppError::retryable(
                "query_job_missing",
                "No active query matched the provided id.",
                Some(job_id.clone()),
            );
            self.diagnostics.record_error(error.clone());
            return Err(error);
        }

        Ok(CancelQueryExecutionResult { job_id })
    }

    async fn set_tab_job(&self, tab_id: &str, job_id: &str) {
        self.tab_jobs
            .lock()
            .await
            .insert(tab_id.to_string(), job_id.to_string());
    }

    async fn record_query_history(&self, request: &QueryExecutionRequest) {
        let repository = self.repository.clone();
        let sql = request.sql.clone();
        let connection_id = request.connection_id.clone();

        if let Err(error) = task::spawn_blocking(move || {
            repository.record_history_entry(sql, Some(connection_id))
        })
        .await
        .map_err(|error| {
            AppError::internal(
                "query_history_join_failed",
                "Failed to join query-history persistence.",
                Some(error.to_string()),
            )
        })
        .and_then(|result| result)
        {
            self.diagnostics.record_error(error.clone());
            error!(?error, "failed to record query history");
        }
    }

    #[cfg(test)]
    async fn active_job_for_tab(&self, tab_id: &str) -> Option<String> {
        self.tab_jobs.lock().await.get(tab_id).cloned()
    }
}

async fn clear_tab_job(tab_jobs: &Arc<Mutex<HashMap<String, String>>>, tab_id: &str, job_id: &str) {
    let mut guard = tab_jobs.lock().await;
    if guard.get(tab_id).map(String::as_str) == Some(job_id) {
        guard.remove(tab_id);
    }
}

fn map_session_error(error: AppError) -> AppError {
    match error.code.as_str() {
        "schema_no_active_session" => AppError::retryable(
            "query_no_active_session",
            "Run requires an active PostgreSQL connection.",
            error.detail,
        ),
        "schema_wrong_connection_selected" => AppError::retryable(
            "query_tab_target_mismatch",
            "This tab targets a different saved connection than the active PostgreSQL session.",
            error.detail,
        ),
        _ => error,
    }
}

#[cfg(test)]
mod tests {
    use std::{path::PathBuf, sync::Arc, time::Duration};

    use async_trait::async_trait;
    use tokio::time::{sleep, timeout};
    use tokio_util::sync::CancellationToken;

    use crate::{
        connections::{ActiveSessionRuntime, ConnectionService, MemorySecretStore},
        foundation::{
            AppError, ConnectionSessionStatus, DatabaseEngine, DatabaseSessionSnapshot,
            DiagnosticsStore, QueryExecutionOrigin, QueryExecutionRequest,
            QueryExecutionResult, QueryResultColumn, SslMode,
        },
        persistence::Repository,
    };

    use super::*;

    #[derive(Default)]
    struct FakeQueryDriver {
        delay_ms: u64,
        fail_with: Option<AppError>,
    }

    #[async_trait]
    impl QueryExecutionDriver for FakeQueryDriver {
        async fn run_query(
            &self,
            _session: ActiveSessionRuntime,
            sql: String,
            cancellation: CancellationToken,
        ) -> Result<(QueryExecutionResult, u64), AppError> {
            if self.delay_ms > 0 {
                tokio::select! {
                    _ = sleep(Duration::from_millis(self.delay_ms)) => {}
                    _ = cancellation.cancelled() => return Err(cancelled_query_error()),
                }
            }

            if let Some(error) = &self.fail_with {
                return Err(error.clone());
            }

            Ok((
                QueryExecutionResult::Rows {
                    columns: vec![QueryResultColumn {
                        name: "result".to_string(),
                        postgres_type: "text".to_string(),
                    }],
                    preview_rows: vec![vec![Some(sql)]],
                    preview_row_count: 1,
                    truncated: false,
                },
                7,
            ))
        }
    }

    fn test_database_path(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join("sparow-query-service-tests");
        std::fs::create_dir_all(&root).expect("failed to create query test directory");
        root.join(name)
    }

    fn test_service(
        name: &str,
        driver: Arc<dyn QueryExecutionDriver>,
    ) -> (QueryService, Arc<Repository>, ConnectionService) {
        let database_path = test_database_path(name);
        let _ = std::fs::remove_file(&database_path);
        let repository =
            Arc::new(Repository::new(database_path).expect("repository should initialize"));
        let diagnostics = DiagnosticsStore::new();
        let connections = ConnectionService::new(
            repository.clone(),
            Arc::new(MemorySecretStore::default()),
            Arc::new(crate::connections::RuntimePostgresDriver),
        );

        (
            QueryService::new(
                repository.clone(),
                connections.clone(),
                diagnostics,
                driver,
                crate::foundation::JobRegistry::default(),
            ),
            repository,
            connections,
        )
    }

    fn test_session(connection_id: &str) -> ActiveSessionRuntime {
        ActiveSessionRuntime {
            snapshot: DatabaseSessionSnapshot {
                connection_id: connection_id.to_string(),
                name: "Local".to_string(),
                engine: DatabaseEngine::Postgresql,
                database: "app_dev".to_string(),
                username: "sparow".to_string(),
                host: "127.0.0.1".to_string(),
                port: 5432,
                connected_at: iso_timestamp(),
                server_version: Some("PostgreSQL test".to_string()),
                ssl_in_use: Some(false),
                status: ConnectionSessionStatus::Connected,
            },
            ssl_mode: SslMode::Disable,
            pool: None,
        }
    }

    fn test_request(tab_id: &str, connection_id: &str, sql: &str) -> QueryExecutionRequest {
        QueryExecutionRequest {
            tab_id: tab_id.to_string(),
            connection_id: connection_id.to_string(),
            sql: sql.to_string(),
            origin: QueryExecutionOrigin::CurrentStatement,
            is_selection_multi_statement: false,
        }
    }

    #[tokio::test]
    async fn rejects_empty_sql() {
        let (service, _, connections) =
            test_service("rejects-empty-sql.sqlite3", Arc::new(FakeQueryDriver::default()));
        connections.set_test_active_session(test_session("conn-1")).await;

        let error = service
            .start_query(None, test_request("tab-1", "conn-1", "   "))
            .await
            .expect_err("empty sql should fail");

        assert_eq!(error.code, "query_empty_sql");
    }

    #[tokio::test]
    async fn rejects_multi_statement_selection_requests() {
        let (service, _, connections) = test_service(
            "rejects-multi-selection.sqlite3",
            Arc::new(FakeQueryDriver::default()),
        );
        connections.set_test_active_session(test_session("conn-1")).await;

        let error = service
            .start_query(
                None,
                QueryExecutionRequest {
                    is_selection_multi_statement: true,
                    ..test_request("tab-1", "conn-1", "select 1; select 2;")
                },
            )
            .await
            .expect_err("multi-statement selection should fail");

        assert_eq!(error.code, "query_multi_statement_selection");
    }

    #[tokio::test]
    async fn rejects_queries_without_active_session() {
        let (service, _, _) =
            test_service("rejects-no-session.sqlite3", Arc::new(FakeQueryDriver::default()));

        let error = service
            .start_query(None, test_request("tab-1", "conn-1", "select 1"))
            .await
            .expect_err("missing session should fail");

        assert_eq!(error.code, "query_no_active_session");
    }

    #[tokio::test]
    async fn rejects_target_mismatch() {
        let (service, _, connections) =
            test_service("rejects-target-mismatch.sqlite3", Arc::new(FakeQueryDriver::default()));
        connections.set_test_active_session(test_session("conn-active")).await;

        let error = service
            .start_query(None, test_request("tab-1", "conn-other", "select 1"))
            .await
            .expect_err("mismatch should fail");

        assert_eq!(error.code, "query_tab_target_mismatch");
    }

    #[tokio::test]
    async fn records_query_history_after_accepting_a_query() {
        let (service, repository, connections) =
            test_service("records-history.sqlite3", Arc::new(FakeQueryDriver::default()));
        connections.set_test_active_session(test_session("conn-1")).await;

        service
            .start_query(None, test_request("tab-1", "conn-1", "select 1"))
            .await
            .expect("query should start");

        timeout(Duration::from_secs(1), async {
            loop {
                if repository
                    .sample_counts()
                    .expect("sample counts should load")
                    .history_entries
                    > 0
                {
                    break;
                }
                sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("history should be recorded");
    }

    #[tokio::test]
    async fn blocks_duplicate_runs_in_the_same_tab() {
        let (service, _, connections) = test_service(
            "blocks-same-tab.sqlite3",
            Arc::new(FakeQueryDriver {
                delay_ms: 100,
                fail_with: None,
            }),
        );
        connections.set_test_active_session(test_session("conn-1")).await;

        service
            .start_query(None, test_request("tab-1", "conn-1", "select 1"))
            .await
            .expect("first query should start");

        let error = service
            .start_query(None, test_request("tab-1", "conn-1", "select 2"))
            .await
            .expect_err("second query should be blocked");

        assert_eq!(error.code, "query_tab_already_running");
    }

    #[tokio::test]
    async fn allows_concurrent_queries_in_different_tabs() {
        let (service, _, connections) = test_service(
            "allows-parallel-tabs.sqlite3",
            Arc::new(FakeQueryDriver {
                delay_ms: 100,
                fail_with: None,
            }),
        );
        connections.set_test_active_session(test_session("conn-1")).await;

        service
            .start_query(None, test_request("tab-1", "conn-1", "select 1"))
            .await
            .expect("first query should start");
        service
            .start_query(None, test_request("tab-2", "conn-1", "select 2"))
            .await
            .expect("second query should start");

        assert!(service.active_job_for_tab("tab-1").await.is_some());
        assert!(service.active_job_for_tab("tab-2").await.is_some());
    }

    #[tokio::test]
    async fn cancels_a_running_query() {
        let (service, _, connections) = test_service(
            "cancels-running-query.sqlite3",
            Arc::new(FakeQueryDriver {
                delay_ms: 1_000,
                fail_with: None,
            }),
        );
        connections.set_test_active_session(test_session("conn-1")).await;

        let accepted = service
            .start_query(None, test_request("tab-1", "conn-1", "select pg_sleep(5)"))
            .await
            .expect("query should start");

        service
            .cancel_query(accepted.job_id.clone())
            .await
            .expect("cancel should succeed");

        timeout(Duration::from_secs(1), async {
            loop {
                if service.active_job_for_tab("tab-1").await.is_none() {
                    break;
                }
                sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("tab should clear after cancellation");
    }

    #[tokio::test]
    #[ignore = "requires explicit PostgreSQL environment variables"]
    async fn postgres_query_smoke() {
        let (service, _, connections) = test_service(
            "postgres-query-smoke.sqlite3",
            Arc::new(crate::query::RuntimeQueryExecutionDriver),
        );
        let saved = save_real_connection(&connections).await;
        let _session = connections
            .connect_saved_connection(&saved.summary.id)
            .await
            .expect("connect should succeed");

        let runtime = connections
            .active_session_runtime(&saved.summary.id)
            .await
            .expect("active session runtime should exist");
        let driver = crate::query::RuntimeQueryExecutionDriver;
        let (result, _) = driver
            .run_query(
                runtime,
                "select 1 as value".to_string(),
                CancellationToken::new(),
            )
            .await
            .expect("query should execute");

        match result {
            QueryExecutionResult::Rows {
                columns,
                preview_rows,
                preview_row_count,
                ..
            } => {
                assert_eq!(columns[0].name, "value");
                assert_eq!(preview_rows[0][0].as_deref(), Some("1"));
                assert_eq!(preview_row_count, 1);
            }
            other => panic!("expected row result, got {other:?}"),
        }

        service
            .start_query(None, test_request("tab-1", &saved.summary.id, "select 1"))
            .await
            .expect("service query should start");
    }

    #[tokio::test]
    #[ignore = "requires explicit PostgreSQL environment variables"]
    async fn postgres_query_cancel_smoke() {
        let (service, _, connections) = test_service(
            "postgres-query-cancel-smoke.sqlite3",
            Arc::new(crate::query::RuntimeQueryExecutionDriver),
        );
        let saved = save_real_connection(&connections).await;
        let _session = connections
            .connect_saved_connection(&saved.summary.id)
            .await
            .expect("connect should succeed");

        let accepted = service
            .start_query(
                None,
                test_request("tab-1", &saved.summary.id, "select pg_sleep(10)"),
            )
            .await
            .expect("query should start");

        sleep(Duration::from_millis(200)).await;
        service
            .cancel_query(accepted.job_id.clone())
            .await
            .expect("cancel should succeed");

        timeout(Duration::from_secs(5), async {
            loop {
                if service.active_job_for_tab("tab-1").await.is_none() {
                    break;
                }
                sleep(Duration::from_millis(50)).await;
            }
        })
        .await
        .expect("query should clear after cancellation");
    }

    async fn save_real_connection(connections: &ConnectionService) -> crate::foundation::ConnectionDetails {
        let host = std::env::var("SPAROW_PG_HOST").expect("SPAROW_PG_HOST is required");
        let port = std::env::var("SPAROW_PG_PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(5432);
        let database =
            std::env::var("SPAROW_PG_DATABASE").expect("SPAROW_PG_DATABASE is required");
        let username =
            std::env::var("SPAROW_PG_USERNAME").expect("SPAROW_PG_USERNAME is required");
        let password =
            std::env::var("SPAROW_PG_PASSWORD").expect("SPAROW_PG_PASSWORD is required");
        let ssl_mode = match std::env::var("SPAROW_PG_SSL_MODE")
            .unwrap_or_else(|_| "prefer".to_string())
            .as_str()
        {
            "disable" => SslMode::Disable,
            "require" => SslMode::Require,
            "insecure" => SslMode::Insecure,
            _ => SslMode::Prefer,
        };

        connections
            .save_connection(crate::foundation::SaveConnectionRequest {
                id: None,
                draft: crate::foundation::ConnectionDraft {
                    name: "Query smoke".to_string(),
                    host,
                    port,
                    database,
                    username,
                    ssl_mode,
                    password: Some(password),
                },
            })
            .await
            .expect("save should succeed")
    }
}
