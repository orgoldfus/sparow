use tauri::{AppHandle, Emitter, State};

use crate::foundation::{
    AppBootstrap, AppError, AppState, BackgroundJobAccepted, BackgroundJobProgressEvent,
    BackgroundJobRequest, CancelJobResult, ConnectionDetails, ConnectionSummary,
    ConnectionTestResult, DatabaseSessionSnapshot, DeleteConnectionResult, DisconnectSessionResult,
    ListSchemaChildrenRequest, ListSchemaChildrenResult, RefreshSchemaScopeRequest,
    SaveConnectionRequest, SchemaRefreshAccepted, SchemaSearchRequest, SchemaSearchResult,
    TestConnectionRequest, BACKGROUND_JOB_EVENT,
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
