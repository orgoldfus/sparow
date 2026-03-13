use std::{
    collections::HashMap,
    fs::{self, File},
    io::{BufWriter, Write},
    path::Path,
    sync::Arc,
};

use tauri::AppHandle;
use tokio::{sync::Mutex, task};
use tokio_util::sync::CancellationToken;
use tracing::{error, info};
use uuid::Uuid;

use crate::{
    commands::{
        emit_query_execution_event, emit_query_result_export_event, emit_query_result_stream_event,
    },
    connections::ConnectionService,
    foundation::{
        ensure_parent_directory, iso_timestamp, AppError, CancelQueryExecutionResult,
        CancelQueryResultExportResult, DiagnosticsStore, QueryExecutionAccepted,
        QueryExecutionProgressEvent, QueryExecutionRequest, QueryExecutionStatus, QueryResultCell,
        QueryResultExportAccepted, QueryResultExportProgressEvent, QueryResultExportRequest,
        QueryResultExportStatus, QueryResultStreamEvent, QueryResultStreamStatus,
        QueryResultWindow, QueryResultWindowRequest,
    },
    persistence::{
        FinalizeQueryResultSetRecord, QueryResultSetRecord, QueryResultSetStatus, Repository,
    },
};

use super::driver::{cancelled_query_error, QueryExecutionDriver, QueryResultStreamContext};

const EXPORT_WINDOW_SIZE: usize = 1_000;

#[derive(Clone)]
pub(crate) struct QueryService {
    repository: Arc<Repository>,
    connections: ConnectionService,
    diagnostics: DiagnosticsStore,
    driver: Arc<dyn QueryExecutionDriver>,
    jobs: crate::foundation::JobRegistry,
    export_jobs: crate::foundation::JobRegistry,
    active_export_result_sets: Arc<Mutex<HashMap<String, usize>>>,
    tab_jobs: Arc<Mutex<HashMap<String, String>>>,
}

impl QueryService {
    pub(crate) fn new(
        repository: Arc<Repository>,
        connections: ConnectionService,
        diagnostics: DiagnosticsStore,
        driver: Arc<dyn QueryExecutionDriver>,
        jobs: crate::foundation::JobRegistry,
        export_jobs: crate::foundation::JobRegistry,
    ) -> Self {
        Self {
            repository,
            connections,
            diagnostics,
            driver,
            jobs,
            export_jobs,
            active_export_result_sets: Arc::new(Mutex::new(HashMap::new())),
            tab_jobs: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Starts a query execution job for one editor tab.
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
                "Phase 5 only supports running a single selected statement at a time.",
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

        let preserved_result_set_ids = self.active_export_result_set_ids().await;
        if let Err(error) = clear_tab_result_cache(
            self.repository.clone(),
            &request.tab_id,
            preserved_result_set_ids,
        )
        .await
        {
            clear_tab_job(&self.tab_jobs, &request.tab_id, "").await;
            return Err(error);
        }

        let job_id = Uuid::new_v4().to_string();
        let correlation_id = Uuid::new_v4().to_string();
        let result_set_id = Uuid::new_v4().to_string();
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
        let queued_event = QueryExecutionProgressEvent {
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
        };

        if let Some(app) = app.as_ref() {
            if let Err(error) = emit_query_execution_event(app, &queued_event) {
                self.jobs.remove(&job_id).await;
                clear_tab_job(&self.tab_jobs, &request.tab_id, &job_id).await;
                self.diagnostics.record_error(error.clone());
                return Err(error);
            }
        }

        self.record_query_history(&request).await;

        let task_accepted = accepted.clone();
        let jobs = self.jobs.clone();
        let tab_jobs = self.tab_jobs.clone();
        let diagnostics = self.diagnostics.clone();
        let driver = self.driver.clone();
        let repository = self.repository.clone();
        let task_request = request.clone();
        task::spawn(async move {
            let maybe_app = app.clone();
            let stream_context = QueryResultStreamContext {
                repository: repository.clone(),
                app: maybe_app.clone(),
                result_set_id: result_set_id.clone(),
                job_id: task_accepted.job_id.clone(),
                correlation_id: task_accepted.correlation_id.clone(),
                tab_id: task_accepted.tab_id.clone(),
                connection_id: task_accepted.connection_id.clone(),
                sql: task_request.sql.clone(),
                started_at: task_accepted.started_at.clone(),
            };

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
                .run_query(
                    session,
                    task_request.sql.clone(),
                    stream_context.clone(),
                    cancellation,
                )
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
                Err(error) => {
                    if let Err(finalize_error) = finalize_failed_result_set(
                        repository.clone(),
                        maybe_app.clone(),
                        &stream_context,
                        &error,
                    )
                    .await
                    {
                        diagnostics.record_error(finalize_error.clone());
                        error!(
                            ?finalize_error,
                            "failed to finalize cached query result after execution failure"
                        );
                    }

                    (
                        QueryExecutionStatus::Failed,
                        None,
                        Some(error.clone()),
                        0,
                        error.message.clone(),
                    )
                }
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

    /// Cancels an in-flight query execution job.
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

    /// Loads one cached result window for the frontend result grid.
    pub(crate) async fn get_query_result_window(
        &self,
        request: QueryResultWindowRequest,
    ) -> Result<QueryResultWindow, AppError> {
        if request.limit == 0 {
            let error = AppError::retryable(
                "query_result_window_limit_invalid",
                "Result windows require a positive limit.",
                Some(request.result_set_id.clone()),
            );
            self.diagnostics.record_error(error.clone());
            return Err(error);
        }

        let repository = self.repository.clone();
        let result = task::spawn_blocking(move || repository.load_query_result_window(&request))
            .await
            .map_err(|error| {
                AppError::internal(
                    "query_result_window_join_failed",
                    "Failed to join cached query result window loading.",
                    Some(error.to_string()),
                )
            })??;

        Ok(result)
    }

    /// Starts a background CSV export for a completed cached result set.
    pub(crate) async fn start_query_result_export(
        &self,
        app: Option<AppHandle>,
        request: QueryResultExportRequest,
    ) -> Result<QueryResultExportAccepted, AppError> {
        if request.output_path.trim().is_empty() {
            let error = AppError::retryable(
                "query_result_export_path_missing",
                "Export requires a filesystem path.",
                Some(request.result_set_id.clone()),
            );
            self.diagnostics.record_error(error.clone());
            return Err(error);
        }

        let repository = self.repository.clone();
        let result_set = task::spawn_blocking({
            let result_set_id = request.result_set_id.clone();
            move || repository.load_query_result_set(&result_set_id)
        })
        .await
        .map_err(|error| {
            AppError::internal(
                "query_result_export_lookup_join_failed",
                "Failed to join cached query result lookup.",
                Some(error.to_string()),
            )
        })??
        .ok_or_else(|| {
            AppError::retryable(
                "query_result_set_missing",
                "The requested cached result set no longer exists.",
                Some(request.result_set_id.clone()),
            )
        })?;

        if result_set.status != QueryResultSetStatus::Completed {
            let error = AppError::retryable(
                "query_result_export_incomplete",
                "Export requires a completed cached result set.",
                Some(result_set.result_set_id.clone()),
            );
            self.diagnostics.record_error(error.clone());
            return Err(error);
        }

        let job_id = Uuid::new_v4().to_string();
        let correlation_id = Uuid::new_v4().to_string();
        let started_at = iso_timestamp();
        let cancellation = CancellationToken::new();

        let accepted = QueryResultExportAccepted {
            job_id: job_id.clone(),
            correlation_id: correlation_id.clone(),
            result_set_id: request.result_set_id.clone(),
            output_path: request.output_path.clone(),
            started_at: started_at.clone(),
        };

        if let Some(app) = app.as_ref() {
            let queued_event = QueryResultExportProgressEvent {
                job_id: job_id.clone(),
                correlation_id: correlation_id.clone(),
                result_set_id: request.result_set_id.clone(),
                output_path: request.output_path.clone(),
                status: QueryResultExportStatus::Queued,
                rows_written: 0,
                message: "Accepted query result export request.".to_string(),
                started_at: started_at.clone(),
                finished_at: None,
                last_error: None,
            };
            emit_query_result_export_event(app, &queued_event)?;
        }
        self.export_jobs
            .insert(job_id.clone(), cancellation.clone())
            .await;
        self.track_export_result_set(&request.result_set_id).await;

        let diagnostics = self.diagnostics.clone();
        let export_jobs = self.export_jobs.clone();
        let active_export_result_sets = self.active_export_result_sets.clone();
        let export_repository = self.repository.clone();
        let export_request = request.clone();
        let task_accepted = accepted.clone();
        task::spawn(async move {
            let maybe_app = app.clone();
            let export_result = run_query_result_export(
                export_repository,
                maybe_app.clone(),
                task_accepted.clone(),
                result_set,
                export_request,
                cancellation,
            )
            .await;

            if let Err(error) = export_result {
                if let Err(emit_error) = emit_failed_query_result_export_event(
                    maybe_app.as_ref(),
                    &task_accepted,
                    &error,
                    0,
                ) {
                    diagnostics.record_error(emit_error.clone());
                    error!(
                        ?emit_error,
                        "failed to emit failed query result export event"
                    );
                }
                diagnostics.record_error(error.clone());
                error!(?error, "query result export failed");
            }

            export_jobs.remove(&job_id).await;
            release_active_export_result_set(
                &active_export_result_sets,
                &task_accepted.result_set_id,
            )
            .await;
            info!(job_id = %job_id, result_set_id = %task_accepted.result_set_id, "query result export finished");
        });

        Ok(accepted)
    }

    /// Cancels an in-flight cached-result export job.
    pub(crate) async fn cancel_query_result_export(
        &self,
        job_id: String,
    ) -> Result<CancelQueryResultExportResult, AppError> {
        let cancelled = self.export_jobs.cancel(&job_id).await;
        if !cancelled {
            let error = AppError::retryable(
                "query_result_export_job_missing",
                "No active export matched the provided id.",
                Some(job_id.clone()),
            );
            self.diagnostics.record_error(error.clone());
            return Err(error);
        }

        Ok(CancelQueryResultExportResult { job_id })
    }

    #[cfg(test)]
    async fn active_job_for_tab(&self, tab_id: &str) -> Option<String> {
        self.tab_jobs.lock().await.get(tab_id).cloned()
    }

    async fn set_tab_job(&self, tab_id: &str, job_id: &str) {
        self.tab_jobs
            .lock()
            .await
            .insert(tab_id.to_string(), job_id.to_string());
    }

    async fn active_export_result_set_ids(&self) -> Vec<String> {
        self.active_export_result_sets
            .lock()
            .await
            .keys()
            .cloned()
            .collect()
    }

    async fn track_export_result_set(&self, result_set_id: &str) {
        let mut guard = self.active_export_result_sets.lock().await;
        *guard.entry(result_set_id.to_string()).or_insert(0) += 1;
    }

    async fn record_query_history(&self, request: &QueryExecutionRequest) {
        let repository = self.repository.clone();
        let sql = request.sql.clone();
        let connection_id = request.connection_id.clone();

        if let Err(error) =
            task::spawn_blocking(move || repository.record_history_entry(sql, Some(connection_id)))
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
}

async fn clear_tab_result_cache(
    repository: Arc<Repository>,
    tab_id: &str,
    preserved_result_set_ids: Vec<String>,
) -> Result<(), AppError> {
    let tab_id = tab_id.to_string();
    task::spawn_blocking(move || {
        repository.delete_query_result_sets_for_tab_except(&tab_id, &preserved_result_set_ids)
    })
    .await
    .map_err(|error| {
        AppError::internal(
            "query_result_cleanup_join_failed",
            "Failed to join query result cache cleanup.",
            Some(error.to_string()),
        )
    })??;

    Ok(())
}

async fn finalize_failed_result_set(
    repository: Arc<Repository>,
    app: Option<AppHandle>,
    context: &QueryResultStreamContext,
    error: &AppError,
) -> Result<(), AppError> {
    let result_set_id = context.result_set_id.clone();
    let record = task::spawn_blocking(move || repository.load_query_result_set(&result_set_id))
        .await
        .map_err(|join_error| {
            AppError::internal(
                "query_result_failure_lookup_join_failed",
                "Failed to join cached query result failure lookup.",
                Some(join_error.to_string()),
            )
        })??;

    let Some(record) = record else {
        return Ok(());
    };
    if record.status != QueryResultSetStatus::Running {
        return Ok(());
    }

    let repository = context.repository.clone();
    let finalize_record = FinalizeQueryResultSetRecord {
        result_set_id: record.result_set_id.clone(),
        buffered_row_count: record.buffered_row_count,
        total_row_count: None,
        status: QueryResultSetStatus::Failed,
        completed_at: Some(iso_timestamp()),
        last_error: Some(error.clone()),
    };
    task::spawn_blocking(move || repository.finalize_query_result_set(finalize_record))
        .await
        .map_err(|join_error| {
            AppError::internal(
                "query_result_failure_finalize_join_failed",
                "Failed to join cached query result failure finalization.",
                Some(join_error.to_string()),
            )
        })??;

    if let Some(app) = app.as_ref() {
        emit_query_result_stream_event(
            app,
            &QueryResultStreamEvent {
                job_id: context.job_id.clone(),
                correlation_id: context.correlation_id.clone(),
                tab_id: context.tab_id.clone(),
                connection_id: context.connection_id.clone(),
                result_set_id: record.result_set_id,
                status: QueryResultStreamStatus::Failed,
                buffered_row_count: record.buffered_row_count,
                total_row_count: record.total_row_count,
                chunk_row_count: 0,
                columns: None,
                message: error.message.clone(),
                started_at: context.started_at.clone(),
                timestamp: iso_timestamp(),
                last_error: Some(error.clone()),
            },
        )?;
    }

    Ok(())
}

async fn run_query_result_export(
    repository: Arc<Repository>,
    app: Option<AppHandle>,
    accepted: QueryResultExportAccepted,
    result_set: QueryResultSetRecord,
    request: QueryResultExportRequest,
    cancellation: CancellationToken,
) -> Result<(), AppError> {
    if let Some(app) = app.as_ref() {
        emit_query_result_export_event(
            app,
            &QueryResultExportProgressEvent {
                job_id: accepted.job_id.clone(),
                correlation_id: accepted.correlation_id.clone(),
                result_set_id: accepted.result_set_id.clone(),
                output_path: accepted.output_path.clone(),
                status: QueryResultExportStatus::Running,
                rows_written: 0,
                message: "Exporting cached query results to CSV.".to_string(),
                started_at: accepted.started_at.clone(),
                finished_at: None,
                last_error: None,
            },
        )?;
    }

    ensure_parent_directory(Path::new(&request.output_path))?;
    let file = File::create(&request.output_path).map_err(|error| {
        AppError::internal(
            "query_result_export_open_failed",
            "Failed to open the CSV export destination.",
            Some(error.to_string()),
        )
    })?;
    let mut writer = BufWriter::new(file);
    write_csv_row(
        &mut writer,
        result_set
            .columns
            .iter()
            .map(|column| QueryResultCell::String(column.name.clone())),
    )?;

    let mut rows_written = 0_usize;
    let mut offset = 0_usize;
    loop {
        if cancellation.is_cancelled() {
            let cancelled_error = AppError::retryable(
                "query_result_export_cancelled",
                "The CSV export was cancelled.",
                Some(accepted.result_set_id.clone()),
            );
            drop(writer);
            let _ = fs::remove_file(&request.output_path);
            if let Some(app) = app.as_ref() {
                emit_query_result_export_event(
                    app,
                    &QueryResultExportProgressEvent {
                        job_id: accepted.job_id.clone(),
                        correlation_id: accepted.correlation_id.clone(),
                        result_set_id: accepted.result_set_id.clone(),
                        output_path: accepted.output_path.clone(),
                        status: QueryResultExportStatus::Cancelled,
                        rows_written,
                        message: "CSV export cancelled by user.".to_string(),
                        started_at: accepted.started_at.clone(),
                        finished_at: Some(iso_timestamp()),
                        last_error: Some(cancelled_error.clone()),
                    },
                )?;
            }
            return Ok(());
        }

        let window = load_export_window(repository.clone(), &request, offset).await?;
        if window.rows.is_empty() {
            break;
        }

        for row in &window.rows {
            write_csv_row(&mut writer, row.iter().cloned())?;
        }
        writer.flush().map_err(|error| {
            AppError::internal(
                "query_result_export_flush_failed",
                "Failed to flush the CSV export file.",
                Some(error.to_string()),
            )
        })?;

        rows_written += window.rows.len();
        offset += window.rows.len();

        if let Some(app) = app.as_ref() {
            emit_query_result_export_event(
                app,
                &QueryResultExportProgressEvent {
                    job_id: accepted.job_id.clone(),
                    correlation_id: accepted.correlation_id.clone(),
                    result_set_id: accepted.result_set_id.clone(),
                    output_path: accepted.output_path.clone(),
                    status: QueryResultExportStatus::Running,
                    rows_written,
                    message: format!("Wrote {rows_written} rows to the CSV export."),
                    started_at: accepted.started_at.clone(),
                    finished_at: None,
                    last_error: None,
                },
            )?;
        }

        if rows_written >= window.visible_row_count {
            break;
        }
    }

    if let Some(app) = app.as_ref() {
        emit_query_result_export_event(
            app,
            &QueryResultExportProgressEvent {
                job_id: accepted.job_id.clone(),
                correlation_id: accepted.correlation_id.clone(),
                result_set_id: accepted.result_set_id.clone(),
                output_path: accepted.output_path.clone(),
                status: QueryResultExportStatus::Completed,
                rows_written,
                message: format!("Finished CSV export with {rows_written} rows."),
                started_at: accepted.started_at.clone(),
                finished_at: Some(iso_timestamp()),
                last_error: None,
            },
        )?;
    }

    Ok(())
}

fn emit_failed_query_result_export_event(
    app: Option<&AppHandle>,
    accepted: &QueryResultExportAccepted,
    error: &AppError,
    rows_written: usize,
) -> Result<(), AppError> {
    let Some(app) = app else {
        return Ok(());
    };

    emit_query_result_export_event(
        app,
        &QueryResultExportProgressEvent {
            job_id: accepted.job_id.clone(),
            correlation_id: accepted.correlation_id.clone(),
            result_set_id: accepted.result_set_id.clone(),
            output_path: accepted.output_path.clone(),
            status: QueryResultExportStatus::Failed,
            rows_written,
            message: error.message.clone(),
            started_at: accepted.started_at.clone(),
            finished_at: Some(iso_timestamp()),
            last_error: Some(error.clone()),
        },
    )
}

async fn load_export_window(
    repository: Arc<Repository>,
    request: &QueryResultExportRequest,
    offset: usize,
) -> Result<QueryResultWindow, AppError> {
    let window_request = QueryResultWindowRequest {
        result_set_id: request.result_set_id.clone(),
        offset,
        limit: EXPORT_WINDOW_SIZE,
        sort: request.sort.clone(),
        filters: request.filters.clone(),
        quick_filter: request.quick_filter.clone(),
    };

    task::spawn_blocking(move || repository.load_query_result_window(&window_request))
        .await
        .map_err(|error| {
            AppError::internal(
                "query_result_export_window_join_failed",
                "Failed to join cached query result window loading for export.",
                Some(error.to_string()),
            )
        })?
}

fn write_csv_row<I>(writer: &mut BufWriter<File>, cells: I) -> Result<(), AppError>
where
    I: IntoIterator<Item = QueryResultCell>,
{
    let mut first = true;
    for cell in cells {
        if !first {
            writer.write_all(b",").map_err(csv_write_error)?;
        }
        first = false;
        let encoded = csv_field_for_cell(cell);
        writer
            .write_all(encoded.as_bytes())
            .map_err(csv_write_error)?;
    }
    writer.write_all(b"\n").map_err(csv_write_error)?;
    Ok(())
}

fn csv_field_for_cell(cell: QueryResultCell) -> String {
    let mut raw = match cell {
        QueryResultCell::String(value) => value,
        QueryResultCell::Integer(value) => value.to_string(),
        QueryResultCell::Float(value) => value.to_string(),
        QueryResultCell::Boolean(value) => value.to_string(),
        QueryResultCell::Null => String::new(),
    };

    if matches!(raw.chars().next(), Some('=' | '+' | '-' | '@')) {
        raw.insert(0, '\'');
    }

    if raw.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", raw.replace('"', "\"\""))
    } else {
        raw
    }
}

fn csv_write_error(error: std::io::Error) -> AppError {
    AppError::internal(
        "query_result_export_write_failed",
        "Failed to write CSV export data.",
        Some(error.to_string()),
    )
}

async fn clear_tab_job(tab_jobs: &Arc<Mutex<HashMap<String, String>>>, tab_id: &str, job_id: &str) {
    let mut guard = tab_jobs.lock().await;
    if guard.get(tab_id).map(String::as_str) == Some(job_id) {
        guard.remove(tab_id);
    }
}

async fn release_active_export_result_set(
    active_export_result_sets: &Arc<Mutex<HashMap<String, usize>>>,
    result_set_id: &str,
) {
    let mut guard = active_export_result_sets.lock().await;
    let Some(active_count) = guard.get_mut(result_set_id) else {
        return;
    };

    if *active_count <= 1 {
        guard.remove(result_set_id);
    } else {
        *active_count -= 1;
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
            iso_timestamp, AppError, ConnectionSessionStatus, DatabaseEngine,
            DatabaseSessionSnapshot, DiagnosticsStore, QueryExecutionOrigin, QueryExecutionRequest,
            QueryExecutionResult, QueryResultCell, QueryResultColumn,
            QueryResultColumnSemanticType, QueryResultSetSummary, SslMode,
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
            stream_context: QueryResultStreamContext,
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
                    summary: QueryResultSetSummary {
                        result_set_id: stream_context.result_set_id,
                        columns: vec![QueryResultColumn {
                            name: "result".to_string(),
                            postgres_type: "text".to_string(),
                            semantic_type: QueryResultColumnSemanticType::Text,
                            is_nullable: false,
                        }],
                        buffered_row_count: 1,
                        total_row_count: Some(1),
                        status: crate::foundation::QueryResultStatus::Completed,
                    },
                },
                if sql.contains("select") { 7 } else { 3 },
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
        let (service, _, connections) = test_service(
            "rejects-empty-sql.sqlite3",
            Arc::new(FakeQueryDriver::default()),
        );
        connections
            .set_test_active_session(test_session("conn-1"))
            .await;

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
        connections
            .set_test_active_session(test_session("conn-1"))
            .await;

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
        let (service, _, _) = test_service(
            "rejects-no-session.sqlite3",
            Arc::new(FakeQueryDriver::default()),
        );

        let error = service
            .start_query(None, test_request("tab-1", "conn-1", "select 1"))
            .await
            .expect_err("missing session should fail");

        assert_eq!(error.code, "query_no_active_session");
    }

    #[tokio::test]
    async fn rejects_target_mismatch() {
        let (service, _, connections) = test_service(
            "rejects-target-mismatch.sqlite3",
            Arc::new(FakeQueryDriver::default()),
        );
        connections
            .set_test_active_session(test_session("conn-active"))
            .await;

        let error = service
            .start_query(None, test_request("tab-1", "conn-other", "select 1"))
            .await
            .expect_err("mismatch should fail");

        assert_eq!(error.code, "query_tab_target_mismatch");
    }

    #[tokio::test]
    async fn records_query_history_after_accepting_a_query() {
        let (service, repository, connections) = test_service(
            "records-history.sqlite3",
            Arc::new(FakeQueryDriver::default()),
        );
        connections
            .set_test_active_session(test_session("conn-1"))
            .await;

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
        connections
            .set_test_active_session(test_session("conn-1"))
            .await;

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
        connections
            .set_test_active_session(test_session("conn-1"))
            .await;

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
        connections
            .set_test_active_session(test_session("conn-1"))
            .await;

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
        let (service, repository, connections) = test_service(
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
        let result_set_id = uuid::Uuid::new_v4().to_string();
        let (result, _) = driver
            .run_query(
                runtime,
                "select 1 as value".to_string(),
                QueryResultStreamContext {
                    repository,
                    app: None,
                    result_set_id: result_set_id.clone(),
                    job_id: uuid::Uuid::new_v4().to_string(),
                    correlation_id: uuid::Uuid::new_v4().to_string(),
                    tab_id: "tab-1".to_string(),
                    connection_id: saved.summary.id.clone(),
                    sql: "select 1 as value".to_string(),
                    started_at: iso_timestamp(),
                },
                CancellationToken::new(),
            )
            .await
            .expect("query should execute");

        match result {
            QueryExecutionResult::Rows { summary } => {
                assert_eq!(summary.columns[0].name, "value");
                assert_eq!(summary.result_set_id, result_set_id);
                assert_eq!(summary.total_row_count, Some(1));
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

    #[test]
    fn csv_field_for_cell_sanitizes_formula_prefixes_before_escaping() {
        assert_eq!(
            csv_field_for_cell(QueryResultCell::String("=SUM(A1:A2)".to_string())),
            "'=SUM(A1:A2)"
        );
        assert_eq!(
            csv_field_for_cell(QueryResultCell::String("+cmd,calc".to_string())),
            "\"'+cmd,calc\""
        );
        assert_eq!(
            csv_field_for_cell(QueryResultCell::String("plain text".to_string())),
            "plain text"
        );
    }

    async fn save_real_connection(
        connections: &ConnectionService,
    ) -> crate::foundation::ConnectionDetails {
        let host = std::env::var("SPAROW_PG_HOST").expect("SPAROW_PG_HOST is required");
        let port = std::env::var("SPAROW_PG_PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(5432);
        let database = std::env::var("SPAROW_PG_DATABASE").expect("SPAROW_PG_DATABASE is required");
        let username = std::env::var("SPAROW_PG_USERNAME").expect("SPAROW_PG_USERNAME is required");
        let password = std::env::var("SPAROW_PG_PASSWORD").expect("SPAROW_PG_PASSWORD is required");
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
