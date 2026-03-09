use tauri::{AppHandle, Emitter, State};

use crate::foundation::{
    AppBootstrap, AppError, AppState, BackgroundJobAccepted, BackgroundJobProgressEvent, BackgroundJobRequest,
    CancelJobResult, BACKGROUND_JOB_EVENT,
};

#[tauri::command]
pub async fn bootstrap_app(state: State<'_, AppState>) -> Result<AppBootstrap, AppError> {
    state.bootstrap().await
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
    app.emit(BACKGROUND_JOB_EVENT, event)
        .map_err(|error| AppError::internal("emit_failed", "Failed to emit background job event.", Some(error.to_string())))
}
