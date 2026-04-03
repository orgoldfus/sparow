use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

use tauri::AppHandle;
use tokio::task;

use crate::{
    connections::ConnectionService, persistence::Repository, productivity::ProductivityService,
    query::QueryService, schema::SchemaService,
};

use super::{
    environment_label, platform_label, AppBootstrap, AppError, AppPaths, BackgroundJobAccepted,
    BackgroundJobProgressEvent, BackgroundJobRequest, CancelJobResult, CancelQueryExecutionResult,
    CancelQueryResultExportResult, ConnectionDetails, ConnectionSummary, ConnectionTestResult,
    DatabaseSessionSnapshot, DeleteConnectionResult, DeleteSavedQueryResult, DiagnosticsSnapshot,
    DisconnectSessionResult, ListQueryHistoryRequest, ListQueryHistoryResult,
    ListSavedQueriesRequest, ListSavedQueriesResult, ListSchemaChildrenRequest,
    ListSchemaChildrenResult, MockJobRunner, QueryExecutionAccepted, QueryExecutionRequest,
    QueryResultCountRequest, QueryResultCountResult, QueryResultExportAccepted,
    QueryResultExportRequest, QueryResultWindow, QueryResultWindowRequest,
    RefreshSchemaScopeRequest, SaveConnectionRequest, SaveSavedQueryRequest, SavedQuery,
    SchemaRefreshAccepted, SchemaSearchRequest, SchemaSearchResult, TestConnectionRequest,
};

#[derive(Debug, Default)]
struct DiagnosticsInner {
    last_error: Option<AppError>,
    recent_events: VecDeque<BackgroundJobProgressEvent>,
}

#[derive(Debug, Clone, Default)]
pub struct DiagnosticsStore {
    inner: Arc<Mutex<DiagnosticsInner>>,
}

impl DiagnosticsStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record_event(&self, event: BackgroundJobProgressEvent) {
        let mut guard = self.inner.lock().expect("diagnostics lock poisoned");
        guard.recent_events.push_front(event);
        while guard.recent_events.len() > 12 {
            let _ = guard.recent_events.pop_back();
        }
    }

    pub fn record_error(&self, error: AppError) {
        let mut guard = self.inner.lock().expect("diagnostics lock poisoned");
        guard.last_error = Some(error);
    }

    pub fn snapshot(&self) -> DiagnosticsSnapshot {
        let guard = self.inner.lock().expect("diagnostics lock poisoned");

        DiagnosticsSnapshot {
            last_error: guard.last_error.clone(),
            recent_events: guard.recent_events.iter().cloned().collect(),
        }
    }
}

#[derive(Clone)]
pub struct AppState {
    paths: AppPaths,
    repository: Arc<Repository>,
    diagnostics: DiagnosticsStore,
    mock_jobs: MockJobRunner,
    connections: ConnectionService,
    schema: SchemaService,
    query: QueryService,
    productivity: ProductivityService,
}

#[derive(Clone)]
pub(crate) struct AppServices {
    pub(crate) connections: ConnectionService,
    pub(crate) schema: SchemaService,
    pub(crate) query: QueryService,
    pub(crate) productivity: ProductivityService,
}

impl AppState {
    pub(crate) fn new(
        paths: AppPaths,
        repository: Arc<Repository>,
        diagnostics: DiagnosticsStore,
        mock_jobs: MockJobRunner,
        services: AppServices,
    ) -> Self {
        Self {
            paths,
            repository,
            diagnostics,
            mock_jobs,
            connections: services.connections,
            schema: services.schema,
            query: services.query,
            productivity: services.productivity,
        }
    }

    pub async fn bootstrap(&self) -> Result<AppBootstrap, AppError> {
        let repository = self.repository.clone();
        let sample_counts = task::spawn_blocking(move || repository.sample_counts())
            .await
            .map_err(|error| {
                AppError::internal(
                    "join_failed",
                    "Failed to join bootstrap task.",
                    Some(error.to_string()),
                )
            })??;
        let saved_connections = self.connections.list_saved_connections().await?;
        let selected_connection_id = self.connections.selected_connection_id().await?;

        Ok(AppBootstrap {
            app_name: "Sparow".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            environment: environment_label(),
            platform: platform_label(),
            feature_flags: vec![
                "phase2-connections".to_string(),
                "phase3-schema-browser".to_string(),
                "phase4-query-workspace".to_string(),
                "phase5-result-viewer".to_string(),
                "diagnostics-surface".to_string(),
                "mock-background-job".to_string(),
            ],
            storage: self.paths.as_storage_paths(),
            diagnostics: self.diagnostics.snapshot(),
            sample_data: super::contracts::SampleData {
                history_entries: sample_counts.history_entries,
                saved_queries: sample_counts.saved_queries,
                schema_cache_entries: sample_counts.schema_cache_entries,
            },
            saved_connections,
            selected_connection_id,
            active_session: self.connections.active_session_snapshot().await,
        })
    }

    pub async fn list_saved_connections(&self) -> Result<Vec<ConnectionSummary>, AppError> {
        let result = self.connections.list_saved_connections().await;
        if let Err(error) = &result {
            self.diagnostics.record_error(error.clone());
        }
        result
    }

    pub async fn get_saved_connection(&self, id: &str) -> Result<ConnectionDetails, AppError> {
        let result = self.connections.get_saved_connection(id).await;
        if let Err(error) = &result {
            self.diagnostics.record_error(error.clone());
        }
        result
    }

    pub async fn save_connection(
        &self,
        request: SaveConnectionRequest,
    ) -> Result<ConnectionDetails, AppError> {
        let result = self.connections.save_connection(request).await;
        if let Err(error) = &result {
            self.diagnostics.record_error(error.clone());
        }
        result
    }

    pub async fn test_connection(
        &self,
        request: TestConnectionRequest,
    ) -> Result<ConnectionTestResult, AppError> {
        let result = self.connections.test_connection(request).await;
        if let Some(error) = result.error.clone() {
            self.diagnostics.record_error(error);
        }
        Ok(result)
    }

    pub async fn connect_saved_connection(
        &self,
        id: &str,
    ) -> Result<DatabaseSessionSnapshot, AppError> {
        let result = self.connections.connect_saved_connection(id).await;
        if let Err(error) = &result {
            self.diagnostics.record_error(error.clone());
        }
        result
    }

    pub async fn disconnect_active_connection(&self) -> Result<DisconnectSessionResult, AppError> {
        self.connections.disconnect_active_connection().await
    }

    pub async fn delete_saved_connection(
        &self,
        id: &str,
    ) -> Result<DeleteConnectionResult, AppError> {
        let result = self.connections.delete_saved_connection(id).await;
        if let Err(error) = &result {
            self.diagnostics.record_error(error.clone());
        }
        result
    }

    pub async fn list_query_history(
        &self,
        request: ListQueryHistoryRequest,
    ) -> Result<ListQueryHistoryResult, AppError> {
        let result = self.productivity.list_query_history(request).await;
        if let Err(error) = &result {
            self.diagnostics.record_error(error.clone());
        }
        result
    }

    pub async fn list_saved_queries(
        &self,
        request: ListSavedQueriesRequest,
    ) -> Result<ListSavedQueriesResult, AppError> {
        let result = self.productivity.list_saved_queries(request).await;
        if let Err(error) = &result {
            self.diagnostics.record_error(error.clone());
        }
        result
    }

    pub async fn save_saved_query(
        &self,
        request: SaveSavedQueryRequest,
    ) -> Result<SavedQuery, AppError> {
        let result = self.productivity.save_saved_query(request).await;
        if let Err(error) = &result {
            self.diagnostics.record_error(error.clone());
        }
        result
    }

    pub async fn delete_saved_query(&self, id: String) -> Result<DeleteSavedQueryResult, AppError> {
        let result = self.productivity.delete_saved_query(id).await;
        if let Err(error) = &result {
            self.diagnostics.record_error(error.clone());
        }
        result
    }

    pub async fn list_schema_children(
        &self,
        app: AppHandle,
        request: ListSchemaChildrenRequest,
    ) -> Result<ListSchemaChildrenResult, AppError> {
        let result = self.schema.list_children(Some(app), request).await;
        if let Err(error) = &result {
            self.diagnostics.record_error(error.clone());
        }
        result
    }

    pub async fn refresh_schema_scope(
        &self,
        app: AppHandle,
        request: RefreshSchemaScopeRequest,
    ) -> Result<SchemaRefreshAccepted, AppError> {
        let result = self.schema.refresh_scope(Some(app), request).await;
        if let Err(error) = &result {
            self.diagnostics.record_error(error.clone());
        }
        result
    }

    pub async fn search_schema_cache(
        &self,
        request: SchemaSearchRequest,
    ) -> Result<SchemaSearchResult, AppError> {
        let result = self.schema.search_cache(request).await;
        if let Err(error) = &result {
            self.diagnostics.record_error(error.clone());
        }
        result
    }

    pub async fn start_query_execution(
        &self,
        app: AppHandle,
        request: QueryExecutionRequest,
    ) -> Result<QueryExecutionAccepted, AppError> {
        let result = self.query.start_query(Some(app), request).await;
        if let Err(error) = &result {
            self.diagnostics.record_error(error.clone());
        }
        result
    }

    pub async fn cancel_query_execution(
        &self,
        job_id: String,
    ) -> Result<CancelQueryExecutionResult, AppError> {
        let result = self.query.cancel_query(job_id).await;
        if let Err(error) = &result {
            self.diagnostics.record_error(error.clone());
        }
        result
    }

    pub async fn get_query_result_window(
        &self,
        request: QueryResultWindowRequest,
    ) -> Result<QueryResultWindow, AppError> {
        let result = self.query.get_query_result_window(request).await;
        if let Err(error) = &result {
            self.diagnostics.record_error(error.clone());
        }
        result
    }

    pub async fn get_query_result_count(
        &self,
        request: QueryResultCountRequest,
    ) -> Result<QueryResultCountResult, AppError> {
        let result = self.query.get_query_result_count(request).await;
        if let Err(error) = &result {
            self.diagnostics.record_error(error.clone());
        }
        result
    }

    pub async fn start_query_result_export(
        &self,
        app: AppHandle,
        request: QueryResultExportRequest,
    ) -> Result<QueryResultExportAccepted, AppError> {
        let result = self
            .query
            .start_query_result_export(Some(app), request)
            .await;
        if let Err(error) = &result {
            self.diagnostics.record_error(error.clone());
        }
        result
    }

    pub async fn cancel_query_result_export(
        &self,
        job_id: String,
    ) -> Result<CancelQueryResultExportResult, AppError> {
        let result = self.query.cancel_query_result_export(job_id).await;
        if let Err(error) = &result {
            self.diagnostics.record_error(error.clone());
        }
        result
    }

    pub async fn start_mock_job(
        &self,
        app: AppHandle,
        request: BackgroundJobRequest,
    ) -> Result<BackgroundJobAccepted, AppError> {
        self.mock_jobs.start_job(app, request).await
    }

    pub async fn cancel_mock_job(&self, job_id: String) -> Result<CancelJobResult, AppError> {
        self.mock_jobs.cancel_job(job_id).await
    }
}
