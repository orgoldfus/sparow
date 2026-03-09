use std::{collections::HashMap, sync::Arc};

use tauri::AppHandle;
use tokio::{
    sync::Mutex,
    task,
    time::{sleep, Duration},
};
use tokio_util::sync::CancellationToken;
use tracing::{error, info};
use uuid::Uuid;

use crate::{commands::emit_background_job_event, persistence::Repository};

use super::{
    iso_timestamp, AppError, BackgroundJobAccepted, BackgroundJobProgressEvent,
    BackgroundJobRequest, BackgroundJobStatus, CancelJobResult, DiagnosticsStore,
};

#[derive(Debug, Clone, Default)]
pub struct JobRegistry {
    tokens: Arc<Mutex<HashMap<String, CancellationToken>>>,
}

impl JobRegistry {
    pub async fn insert(&self, job_id: String, token: CancellationToken) {
        self.tokens.lock().await.insert(job_id, token);
    }

    pub async fn cancel(&self, job_id: &str) -> bool {
        let mut guard = self.tokens.lock().await;
        if let Some(token) = guard.remove(job_id) {
            token.cancel();
            return true;
        }

        false
    }

    pub async fn remove(&self, job_id: &str) {
        self.tokens.lock().await.remove(job_id);
    }
}

#[derive(Clone)]
pub(crate) struct MockJobRunner {
    diagnostics: DiagnosticsStore,
    repository: Arc<Repository>,
    jobs: JobRegistry,
}

impl MockJobRunner {
    pub(crate) fn new(
        diagnostics: DiagnosticsStore,
        repository: Arc<Repository>,
        jobs: JobRegistry,
    ) -> Self {
        Self {
            diagnostics,
            repository,
            jobs,
        }
    }

    pub(crate) async fn start_job(
        &self,
        app: AppHandle,
        request: BackgroundJobRequest,
    ) -> Result<BackgroundJobAccepted, AppError> {
        if request.steps == 0 {
            let error = AppError::retryable(
                "invalid_mock_job_request",
                "Mock jobs require at least one step.",
                None,
            );
            self.diagnostics.record_error(error.clone());
            return Err(error);
        }

        let job_id = Uuid::new_v4().to_string();
        let correlation_id = Uuid::new_v4().to_string();
        let started_at = iso_timestamp();
        let cancellation = CancellationToken::new();

        self.jobs.insert(job_id.clone(), cancellation.clone()).await;

        let queued_event = BackgroundJobProgressEvent {
            job_id: job_id.clone(),
            correlation_id: correlation_id.clone(),
            status: BackgroundJobStatus::Queued,
            step: 0,
            total_steps: request.steps,
            message: format!("Accepted mock job '{}'.", request.label),
            timestamp: started_at.clone(),
            last_error: None,
        };
        self.diagnostics.record_event(queued_event.clone());
        if let Err(error) = emit_background_job_event(&app, &queued_event) {
            self.diagnostics.record_error(error.clone());
            self.jobs.remove(&job_id).await;
            return Err(error);
        }

        let diagnostics = self.diagnostics.clone();
        let repository = self.repository.clone();
        let jobs = self.jobs.clone();
        let task_job_id = job_id.clone();
        let task_correlation_id = correlation_id.clone();
        task::spawn(async move {
            for step in 1..=request.steps {
                if cancellation.is_cancelled() {
                    handle_cancellation(
                        &app,
                        &diagnostics,
                        &jobs,
                        &task_job_id,
                        &task_correlation_id,
                        step.saturating_sub(1),
                        request.steps,
                    )
                    .await;
                    return;
                }

                sleep(Duration::from_millis(request.delay_ms)).await;

                if cancellation.is_cancelled() {
                    handle_cancellation(
                        &app,
                        &diagnostics,
                        &jobs,
                        &task_job_id,
                        &task_correlation_id,
                        step.saturating_sub(1),
                        request.steps,
                    )
                    .await;
                    return;
                }

                let event = BackgroundJobProgressEvent {
                    job_id: task_job_id.clone(),
                    correlation_id: task_correlation_id.clone(),
                    status: if step == request.steps {
                        BackgroundJobStatus::Completed
                    } else {
                        BackgroundJobStatus::Running
                    },
                    step,
                    total_steps: request.steps,
                    message: if step == request.steps {
                        format!("Mock job '{}' completed.", request.label)
                    } else {
                        format!("Mock step {step} completed.")
                    },
                    timestamp: iso_timestamp(),
                    last_error: None,
                };

                diagnostics.record_event(event.clone());
                if let Err(error) = emit_background_job_event(&app, &event) {
                    diagnostics.record_error(error.clone());
                    error!(?error, "failed to emit job progress");
                }
            }

            let record_repository = repository.clone();
            if let Err(error) = task::spawn_blocking(move || {
                record_repository.record_history(format!(
                    "-- mock job completed at {}\nselect 'phase-1';",
                    iso_timestamp()
                ))
            })
            .await
            .map_err(|error| {
                AppError::internal(
                    "join_failed",
                    "Failed to persist mock history.",
                    Some(error.to_string()),
                )
            })
            .and_then(|result| result)
            {
                diagnostics.record_error(error.clone());
                error!(?error, "failed to persist mock history");
            }

            jobs.remove(&task_job_id).await;
            info!(job_id = %task_job_id, "mock job completed");
        });

        Ok(BackgroundJobAccepted {
            job_id,
            correlation_id,
            started_at,
        })
    }

    pub(crate) async fn cancel_job(&self, job_id: String) -> Result<CancelJobResult, AppError> {
        let cancelled = self.jobs.cancel(&job_id).await;

        if !cancelled {
            let error = AppError::retryable(
                "mock_job_missing",
                "No active mock job matched the provided id.",
                Some(job_id.clone()),
            );
            self.diagnostics.record_error(error.clone());
            return Err(error);
        }

        Ok(CancelJobResult { job_id })
    }
}

async fn handle_cancellation(
    app: &AppHandle,
    diagnostics: &DiagnosticsStore,
    jobs: &JobRegistry,
    job_id: &str,
    correlation_id: &str,
    step: u16,
    total_steps: u16,
) {
    let cancelled_error =
        AppError::retryable("mock_job_cancelled", "Mock job was cancelled.", None);
    diagnostics.record_error(cancelled_error.clone());
    let cancelled_event = BackgroundJobProgressEvent {
        job_id: job_id.to_string(),
        correlation_id: correlation_id.to_string(),
        status: BackgroundJobStatus::Cancelled,
        step,
        total_steps,
        message: "Mock job cancelled by user.".to_string(),
        timestamp: iso_timestamp(),
        last_error: Some(cancelled_error),
    };
    diagnostics.record_event(cancelled_event.clone());
    if let Err(error) = emit_background_job_event(app, &cancelled_event) {
        diagnostics.record_error(error.clone());
        error!(?error, "failed to emit cancelled event");
    }
    jobs.remove(job_id).await;
}
