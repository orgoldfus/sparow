use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

use tauri::AppHandle;
use tokio::{task, time::{sleep, Duration}};
use tokio_util::sync::CancellationToken;
use tracing::{error, info};
use uuid::Uuid;

use crate::{
    commands::emit_background_job_event,
    persistence::Repository,
};

use super::{
    environment_label, iso_timestamp, platform_label, AppBootstrap, AppError, AppPaths,
    BackgroundJobAccepted, BackgroundJobProgressEvent, BackgroundJobRequest, BackgroundJobStatus,
    CancelJobResult, DiagnosticsSnapshot, JobRegistry,
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

#[derive(Debug, Clone)]
pub struct AppState {
    paths: AppPaths,
    repository: Arc<Repository>,
    diagnostics: DiagnosticsStore,
    jobs: JobRegistry,
}

impl AppState {
    pub fn new(
        paths: AppPaths,
        repository: Arc<Repository>,
        diagnostics: DiagnosticsStore,
        jobs: JobRegistry,
    ) -> Self {
        Self {
            paths,
            repository,
            diagnostics,
            jobs,
        }
    }

    pub async fn bootstrap(&self) -> Result<AppBootstrap, AppError> {
        let repository = self.repository.clone();
        let counts = task::spawn_blocking(move || repository.sample_counts())
            .await
            .map_err(|error| AppError::internal("join_failed", "Failed to join bootstrap task.", Some(error.to_string())))??;

        Ok(AppBootstrap {
            app_name: "Sparow".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            environment: environment_label(),
            platform: platform_label(),
            feature_flags: vec![
                "phase1-foundation".to_string(),
                "diagnostics-surface".to_string(),
                "mock-background-job".to_string(),
            ],
            storage: self.paths.as_storage_paths(),
            diagnostics: self.diagnostics.snapshot(),
            sample_data: super::contracts::SampleData {
                history_entries: counts.history_entries,
                saved_queries: counts.saved_queries,
                schema_cache_entries: counts.schema_cache_entries,
            },
        })
    }

    pub async fn start_mock_job(
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
        emit_background_job_event(&app, &queued_event)?;

        let diagnostics = self.diagnostics.clone();
        let repository = self.repository.clone();
        let jobs = self.jobs.clone();
        let task_job_id = job_id.clone();
        let task_correlation_id = correlation_id.clone();
        task::spawn(async move {
            for step in 1..=request.steps {
                if cancellation.is_cancelled() {
                    let cancelled_error = AppError::retryable(
                        "mock_job_cancelled",
                        "Mock job was cancelled.",
                        None,
                    );
                    diagnostics.record_error(cancelled_error.clone());
                    let cancelled_event = BackgroundJobProgressEvent {
                        job_id: task_job_id.clone(),
                        correlation_id: task_correlation_id.clone(),
                        status: BackgroundJobStatus::Cancelled,
                        step: step.saturating_sub(1),
                        total_steps: request.steps,
                        message: "Mock job cancelled by user.".to_string(),
                        timestamp: iso_timestamp(),
                        last_error: Some(cancelled_error),
                    };
                    diagnostics.record_event(cancelled_event.clone());
                    if let Err(error) = emit_background_job_event(&app, &cancelled_event) {
                        diagnostics.record_error(error.clone());
                        error!(?error, "failed to emit cancelled event");
                    }
                    jobs.remove(&task_job_id).await;
                    return;
                }

                sleep(Duration::from_millis(request.delay_ms)).await;

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
            .map_err(|error| AppError::internal("join_failed", "Failed to persist mock history.", Some(error.to_string())))
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

    pub async fn cancel_mock_job(&self, job_id: String) -> Result<CancelJobResult, AppError> {
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
