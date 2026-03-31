use tauri::{AppHandle, Emitter, State};

use crate::foundation::{
    AppBootstrap, AppError, AppState, BackgroundJobAccepted, BackgroundJobProgressEvent,
    BackgroundJobRequest, CancelJobResult, CancelQueryExecutionResult, ConnectionDetails,
    ConnectionSummary, ConnectionTestResult, DatabaseSessionSnapshot, DeleteConnectionResult,
    DeleteSavedQueryResult, DisconnectSessionResult, ListQueryHistoryRequest,
    ListQueryHistoryResult, ListSavedQueriesRequest, ListSavedQueriesResult,
    ListSchemaChildrenRequest, ListSchemaChildrenResult, QueryExecutionAccepted,
    QueryExecutionProgressEvent, QueryExecutionRequest, QueryResultCountRequest,
    QueryResultCountResult, QueryResultExportAccepted, QueryResultExportProgressEvent,
    QueryResultExportRequest, QueryResultWindow, QueryResultWindowRequest,
    RefreshSchemaScopeRequest, SaveConnectionRequest, SaveSavedQueryRequest, SavedQuery,
    SchemaRefreshAccepted, SchemaSearchRequest, SchemaSearchResult, TestConnectionRequest,
    BACKGROUND_JOB_EVENT, QUERY_EXECUTION_EVENT, QUERY_RESULT_EXPORT_EVENT,
};

#[tauri::command]
pub async fn bootstrap_app(state: State<'_, AppState>) -> Result<AppBootstrap, AppError> {
    state.bootstrap().await
}

#[tauri::command]
pub async fn list_saved_connections(
    state: State<'_, AppState>,
) -> Result<Vec<ConnectionSummary>, AppError> {
    state.list_saved_connections().await
}

#[tauri::command]
pub async fn get_saved_connection(
    state: State<'_, AppState>,
    id: String,
) -> Result<ConnectionDetails, AppError> {
    state.get_saved_connection(&id).await
}

#[tauri::command]
pub async fn save_connection(
    state: State<'_, AppState>,
    request: SaveConnectionRequest,
) -> Result<ConnectionDetails, AppError> {
    state.save_connection(request).await
}

#[tauri::command]
pub async fn test_connection(
    state: State<'_, AppState>,
    request: TestConnectionRequest,
) -> Result<ConnectionTestResult, AppError> {
    state.test_connection(request).await
}

#[tauri::command]
pub async fn connect_saved_connection(
    state: State<'_, AppState>,
    id: String,
) -> Result<DatabaseSessionSnapshot, AppError> {
    state.connect_saved_connection(&id).await
}

#[tauri::command]
pub async fn disconnect_active_connection(
    state: State<'_, AppState>,
) -> Result<DisconnectSessionResult, AppError> {
    state.disconnect_active_connection().await
}

#[tauri::command]
pub async fn delete_saved_connection(
    state: State<'_, AppState>,
    id: String,
) -> Result<DeleteConnectionResult, AppError> {
    state.delete_saved_connection(&id).await
}

#[tauri::command]
pub async fn list_query_history(
    state: State<'_, AppState>,
    request: ListQueryHistoryRequest,
) -> Result<ListQueryHistoryResult, AppError> {
    state.list_query_history(request).await
}

#[tauri::command]
pub async fn list_saved_queries(
    state: State<'_, AppState>,
    request: ListSavedQueriesRequest,
) -> Result<ListSavedQueriesResult, AppError> {
    state.list_saved_queries(request).await
}

#[tauri::command]
pub async fn save_saved_query(
    state: State<'_, AppState>,
    request: SaveSavedQueryRequest,
) -> Result<SavedQuery, AppError> {
    state.save_saved_query(request).await
}

#[tauri::command]
pub async fn delete_saved_query(
    state: State<'_, AppState>,
    id: String,
) -> Result<DeleteSavedQueryResult, AppError> {
    state.delete_saved_query(id).await
}

#[tauri::command]
pub async fn list_schema_children(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ListSchemaChildrenRequest,
) -> Result<ListSchemaChildrenResult, AppError> {
    state.list_schema_children(app, request).await
}

#[tauri::command]
pub async fn refresh_schema_scope(
    app: AppHandle,
    state: State<'_, AppState>,
    request: RefreshSchemaScopeRequest,
) -> Result<SchemaRefreshAccepted, AppError> {
    state.refresh_schema_scope(app, request).await
}

#[tauri::command]
pub async fn search_schema_cache(
    state: State<'_, AppState>,
    request: SchemaSearchRequest,
) -> Result<SchemaSearchResult, AppError> {
    state.search_schema_cache(request).await
}

#[tauri::command]
pub async fn start_query_execution(
    app: AppHandle,
    state: State<'_, AppState>,
    request: QueryExecutionRequest,
) -> Result<QueryExecutionAccepted, AppError> {
    state.start_query_execution(app, request).await
}

#[tauri::command]
pub async fn cancel_query_execution(
    state: State<'_, AppState>,
    job_id: String,
) -> Result<CancelQueryExecutionResult, AppError> {
    state.cancel_query_execution(job_id).await
}

#[tauri::command]
pub async fn get_query_result_window(
    state: State<'_, AppState>,
    request: QueryResultWindowRequest,
) -> Result<QueryResultWindow, AppError> {
    state.get_query_result_window(request).await
}

#[tauri::command]
pub async fn get_query_result_count(
    state: State<'_, AppState>,
    request: QueryResultCountRequest,
) -> Result<QueryResultCountResult, AppError> {
    state.get_query_result_count(request).await
}

#[tauri::command]
pub async fn start_query_result_export(
    app: AppHandle,
    state: State<'_, AppState>,
    request: QueryResultExportRequest,
) -> Result<QueryResultExportAccepted, AppError> {
    state.start_query_result_export(app, request).await
}

#[tauri::command]
pub async fn cancel_query_result_export(
    state: State<'_, AppState>,
    job_id: String,
) -> Result<crate::foundation::CancelQueryResultExportResult, AppError> {
    state.cancel_query_result_export(job_id).await
}

#[tauri::command]
pub async fn start_mock_job(
    app: AppHandle,
    state: State<'_, AppState>,
    request: BackgroundJobRequest,
) -> Result<BackgroundJobAccepted, AppError> {
    state.start_mock_job(app, request).await
}

#[tauri::command]
pub async fn cancel_mock_job(
    state: State<'_, AppState>,
    job_id: String,
) -> Result<CancelJobResult, AppError> {
    state.cancel_mock_job(job_id).await
}

pub fn emit_background_job_event(
    app: &AppHandle,
    event: &BackgroundJobProgressEvent,
) -> Result<(), AppError> {
    app.emit(BACKGROUND_JOB_EVENT, event).map_err(|error| {
        AppError::internal(
            "emit_failed",
            "Failed to emit background job event.",
            Some(error.to_string()),
        )
    })
}

pub fn emit_query_execution_event(
    app: &AppHandle,
    event: &QueryExecutionProgressEvent,
) -> Result<(), AppError> {
    app.emit(QUERY_EXECUTION_EVENT, event).map_err(|error| {
        AppError::internal(
            "emit_failed",
            "Failed to emit query execution event.",
            Some(error.to_string()),
        )
    })
}

pub fn emit_query_result_export_event(
    app: &AppHandle,
    event: &QueryResultExportProgressEvent,
) -> Result<(), AppError> {
    app.emit(QUERY_RESULT_EXPORT_EVENT, event).map_err(|error| {
        AppError::internal(
            "emit_failed",
            "Failed to emit query result export event.",
            Some(error.to_string()),
        )
    })
}
