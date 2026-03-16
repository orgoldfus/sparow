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
    commands::{emit_query_execution_event, emit_query_result_export_event},
    connections::ConnectionService,
    foundation::{
        ensure_parent_directory, iso_timestamp, AppError, CancelQueryExecutionResult,
        CancelQueryResultExportResult, DiagnosticsStore, QueryExecutionAccepted,
        QueryExecutionProgressEvent, QueryExecutionRequest, QueryExecutionResult,
        QueryExecutionStatus, QueryResultCell, QueryResultColumn, QueryResultExportAccepted,
        QueryResultExportProgressEvent, QueryResultExportRequest, QueryResultExportStatus,
        QueryResultWindow, QueryResultWindowRequest,
    },
    persistence::Repository,
};

use super::{
    driver::{
        cancelled_query_error, load_replayable_query_result_window, ExecutedQueryResult,
        QueryExecutionDriver,
    },
    result_store::{
        BufferedQueryResultHandle, QueryResultHandle, QueryResultStore, ReplayableQueryResultHandle,
    },
};

const EXPORT_WINDOW_SIZE: usize = 1_000;
const MAX_BUFFERED_RESULT_ROWS: usize = 20_000;
const MAX_BUFFERED_RESULT_BYTES: usize = 32 * 1024 * 1024;

struct BufferedResultMetrics {
    row_count: usize,
    estimated_bytes: usize,
}

struct QueryResultExportWriteResult {
    rows_written: usize,
    writer: BufWriter<File>,
    was_cancelled: bool,
}

impl QueryResultExportWriteResult {
    fn completed(rows_written: usize, writer: BufWriter<File>) -> Self {
        Self {
            rows_written,
            writer,
            was_cancelled: false,
        }
    }

    fn cancelled(rows_written: usize, writer: BufWriter<File>) -> Self {
        Self {
            rows_written,
            writer,
            was_cancelled: true,
        }
    }
}

#[derive(Clone)]
pub(crate) struct QueryService {
    repository: Arc<Repository>,
    connections: ConnectionService,
    diagnostics: DiagnosticsStore,
    driver: Arc<dyn QueryExecutionDriver>,
    results: QueryResultStore,
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
            results: QueryResultStore::default(),
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
        self.results
            .clear_tab_except(&request.tab_id, &preserved_result_set_ids)
            .await;

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
        let results = self.results.clone();
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
                Ok((result, elapsed_ms)) => {
                    match store_query_result(&results, &task_request, &result_set_id, result).await
                    {
                        Ok(result) => (
                            QueryExecutionStatus::Completed,
                            Some(result),
                            None,
                            elapsed_ms,
                            "Query completed.".to_string(),
                        ),
                        Err(error) => (
                            QueryExecutionStatus::Failed,
                            None,
                            Some(error.clone()),
                            elapsed_ms,
                            error.message.clone(),
                        ),
                    }
                }
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
            info!(
                job_id = %task_accepted.job_id,
                tab_id = %task_accepted.tab_id,
                "query job finished"
            );
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

    /// Loads one result window for the frontend result grid.
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

        let handle = self
            .results
            .load(&request.result_set_id)
            .await
            .ok_or_else(|| {
                AppError::retryable(
                    "query_result_set_missing",
                    "The requested query result no longer exists.",
                    Some(request.result_set_id.clone()),
                )
            })?;

        match handle.as_ref() {
            QueryResultHandle::Replayable(handle) => {
                let session = self
                    .connections
                    .active_session_runtime(handle.connection_id.as_str())
                    .await
                    .map_err(map_session_error)?;
                load_replayable_query_result_window(session, handle, &request).await
            }
            QueryResultHandle::Buffered(handle) => Ok(handle.load_window(&request)),
        }
    }

    /// Starts a background CSV export for a completed query result.
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

        let handle = self
            .results
            .load(&request.result_set_id)
            .await
            .ok_or_else(|| {
                AppError::retryable(
                    "query_result_set_missing",
                    "The requested query result no longer exists.",
                    Some(request.result_set_id.clone()),
                )
            })?;

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
        let connections = self.connections.clone();
        let export_jobs = self.export_jobs.clone();
        let active_export_result_sets = self.active_export_result_sets.clone();
        let export_request = request.clone();
        let task_accepted = accepted.clone();
        task::spawn(async move {
            let maybe_app = app.clone();
            let export_result = run_query_result_export(
                connections,
                maybe_app.clone(),
                task_accepted.clone(),
                handle,
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
            info!(
                job_id = %job_id,
                result_set_id = %task_accepted.result_set_id,
                "query result export finished"
            );
        });

        Ok(accepted)
    }

    /// Cancels an in-flight query-result export job.
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

async fn store_query_result(
    results: &QueryResultStore,
    request: &QueryExecutionRequest,
    result_set_id: &str,
    result: ExecutedQueryResult,
) -> Result<QueryExecutionResult, AppError> {
    match result {
        ExecutedQueryResult::Command {
            command_tag,
            rows_affected,
        } => Ok(QueryExecutionResult::Command {
            command_tag,
            rows_affected,
        }),
        ExecutedQueryResult::ReplayableRows {
            columns,
            initial_total_row_count,
        } => {
            let handle = results
                .insert(QueryResultHandle::Replayable(ReplayableQueryResultHandle {
                    result_set_id: result_set_id.to_string(),
                    tab_id: request.tab_id.clone(),
                    connection_id: request.connection_id.clone(),
                    sql: request.sql.clone(),
                    columns,
                    initial_total_row_count,
                }))
                .await;

            Ok(QueryExecutionResult::Rows {
                summary: handle.summary(),
            })
        }
        ExecutedQueryResult::BufferedRows { columns, rows } => {
            enforce_buffered_result_limits(&columns, &rows)?;
            let handle = results
                .insert(QueryResultHandle::Buffered(BufferedQueryResultHandle {
                    result_set_id: result_set_id.to_string(),
                    tab_id: request.tab_id.clone(),
                    columns,
                    rows,
                }))
                .await;

            Ok(QueryExecutionResult::Rows {
                summary: handle.summary(),
            })
        }
    }
}

async fn run_query_result_export(
    connections: ConnectionService,
    app: Option<AppHandle>,
    accepted: QueryResultExportAccepted,
    handle: Arc<QueryResultHandle>,
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
                message: "Exporting query results to CSV.".to_string(),
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
        handle
            .columns()
            .iter()
            .map(|column| QueryResultCell::String(column.name.clone())),
    )?;

    let mut export_result = match handle.as_ref() {
        QueryResultHandle::Replayable(handle) => {
            export_replayable_rows(
                &connections,
                &accepted,
                handle,
                &request,
                &app,
                writer,
                &cancellation,
            )
            .await?
        }
        QueryResultHandle::Buffered(handle) => {
            export_buffered_rows(&accepted, handle, &request, &app, writer, &cancellation).await?
        }
    };

    if export_result.was_cancelled {
        cancel_query_result_export(
            &accepted,
            &request,
            app.as_ref(),
            export_result.rows_written,
            export_result.writer,
        )?;
        return Ok(());
    }

    flush_export_writer(&mut export_result.writer)?;
    let rows_written = export_result.rows_written;

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

async fn export_replayable_rows(
    connections: &ConnectionService,
    accepted: &QueryResultExportAccepted,
    handle: &ReplayableQueryResultHandle,
    request: &QueryResultExportRequest,
    app: &Option<AppHandle>,
    mut writer: BufWriter<File>,
    cancellation: &CancellationToken,
) -> Result<QueryResultExportWriteResult, AppError> {
    let session = connections
        .active_session_runtime(handle.connection_id.as_str())
        .await
        .map_err(map_session_error)?;
    let mut rows_written = 0_usize;
    let mut offset = 0_usize;

    loop {
        if cancellation.is_cancelled() {
            return Ok(QueryResultExportWriteResult::cancelled(
                rows_written,
                writer,
            ));
        }

        let window = load_replayable_query_result_window(
            session.clone(),
            handle,
            &QueryResultWindowRequest {
                result_set_id: handle.result_set_id.clone(),
                offset,
                limit: EXPORT_WINDOW_SIZE,
                sort: request.sort.clone(),
                filters: request.filters.clone(),
                quick_filter: request.quick_filter.clone(),
            },
        )
        .await?;

        if window.rows.is_empty() {
            break;
        }

        for row in &window.rows {
            write_csv_row(&mut writer, row.iter().cloned())?;
        }
        flush_export_writer(&mut writer)?;

        rows_written += window.rows.len();
        offset += window.rows.len();
        emit_running_export_progress(app.as_ref(), accepted, rows_written)?;

        if rows_written >= window.visible_row_count {
            break;
        }
    }

    Ok(QueryResultExportWriteResult::completed(
        rows_written,
        writer,
    ))
}

async fn export_buffered_rows(
    accepted: &QueryResultExportAccepted,
    handle: &BufferedQueryResultHandle,
    request: &QueryResultExportRequest,
    app: &Option<AppHandle>,
    mut writer: BufWriter<File>,
    cancellation: &CancellationToken,
) -> Result<QueryResultExportWriteResult, AppError> {
    let rows = handle.rows_for_export(
        request.sort.as_ref(),
        &request.filters,
        &request.quick_filter,
    );
    let mut rows_written = 0_usize;

    for batch in rows.chunks(EXPORT_WINDOW_SIZE) {
        if cancellation.is_cancelled() {
            return Ok(QueryResultExportWriteResult::cancelled(
                rows_written,
                writer,
            ));
        }

        for row in batch {
            write_csv_row(&mut writer, row.iter().cloned())?;
        }
        flush_export_writer(&mut writer)?;

        rows_written += batch.len();
        emit_running_export_progress(app.as_ref(), accepted, rows_written)?;
    }

    Ok(QueryResultExportWriteResult::completed(
        rows_written,
        writer,
    ))
}

fn emit_running_export_progress(
    app: Option<&AppHandle>,
    accepted: &QueryResultExportAccepted,
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
            status: QueryResultExportStatus::Running,
            rows_written,
            message: format!("Wrote {rows_written} rows to the CSV export."),
            started_at: accepted.started_at.clone(),
            finished_at: None,
            last_error: None,
        },
    )
}

fn cancel_query_result_export(
    accepted: &QueryResultExportAccepted,
    request: &QueryResultExportRequest,
    app: Option<&AppHandle>,
    rows_written: usize,
    writer: BufWriter<File>,
) -> Result<usize, AppError> {
    let cancelled_error = AppError::retryable(
        "query_result_export_cancelled",
        "The CSV export was cancelled.",
        Some(accepted.result_set_id.clone()),
    );
    let file = writer
        .into_inner()
        .map_err(|error| csv_write_error(error.into_error()))?;
    drop(file);
    let _ = fs::remove_file(&request.output_path);

    if let Some(app) = app {
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
                last_error: Some(cancelled_error),
            },
        )?;
    }

    Ok(rows_written)
}

fn enforce_buffered_result_limits(
    columns: &[QueryResultColumn],
    rows: &[Vec<QueryResultCell>],
) -> Result<(), AppError> {
    let metrics = buffered_result_metrics(columns, rows);
    if metrics.row_count <= MAX_BUFFERED_RESULT_ROWS
        && metrics.estimated_bytes <= MAX_BUFFERED_RESULT_BYTES
    {
        return Ok(());
    }

    Err(AppError::retryable(
        "query_result_buffer_limit_exceeded",
        "This non-replayable query returned too much data to keep in memory.",
        Some(format!(
            "Buffered fallback estimated {} rows and {} bytes; limit is {} rows or {} bytes. Add a LIMIT clause or re-run a replayable SELECT.",
            metrics.row_count,
            metrics.estimated_bytes,
            MAX_BUFFERED_RESULT_ROWS,
            MAX_BUFFERED_RESULT_BYTES,
        )),
    ))
}

fn buffered_result_metrics(
    columns: &[QueryResultColumn],
    rows: &[Vec<QueryResultCell>],
) -> BufferedResultMetrics {
    let estimated_bytes = columns
        .iter()
        .map(approximate_query_result_column_bytes)
        .sum::<usize>()
        + rows
            .iter()
            .map(|row| {
                row.iter()
                    .map(approximate_query_result_cell_bytes)
                    .sum::<usize>()
            })
            .sum::<usize>();

    BufferedResultMetrics {
        row_count: rows.len(),
        estimated_bytes,
    }
}

fn approximate_query_result_column_bytes(column: &QueryResultColumn) -> usize {
    column.name.len()
        + column.postgres_type.len()
        + std::mem::size_of_val(&column.semantic_type)
        + std::mem::size_of_val(&column.is_nullable)
}

fn approximate_query_result_cell_bytes(cell: &QueryResultCell) -> usize {
    match cell {
        QueryResultCell::String(value) => value.len(),
        QueryResultCell::Integer(_) => std::mem::size_of::<i64>(),
        QueryResultCell::Float(_) => std::mem::size_of::<f64>(),
        QueryResultCell::Boolean(_) => std::mem::size_of::<bool>(),
        QueryResultCell::Null => 0,
    }
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
    let raw = match cell {
        QueryResultCell::String(mut value) => {
            if matches!(value.chars().next(), Some('=' | '+' | '-' | '@')) {
                value.insert(0, '\'');
            }
            value
        }
        QueryResultCell::Integer(value) => value.to_string(),
        QueryResultCell::Float(value) => value.to_string(),
        QueryResultCell::Boolean(value) => value.to_string(),
        QueryResultCell::Null => String::new(),
    };

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

fn flush_export_writer(writer: &mut BufWriter<File>) -> Result<(), AppError> {
    writer.flush().map_err(|error| {
        AppError::internal(
            "query_result_export_flush_failed",
            "Failed to flush the CSV export file.",
            Some(error.to_string()),
        )
    })
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
            "Query results require an active PostgreSQL connection.",
            error.detail,
        ),
        "schema_wrong_connection_selected" => AppError::retryable(
            "query_tab_target_mismatch",
            "This query result targets a different saved connection than the active PostgreSQL session.",
            error.detail,
        ),
        _ => error,
    }
}

#[cfg(test)]
mod tests {
    use std::{
        path::{Path, PathBuf},
        sync::Arc,
        time::Duration,
    };

    use async_trait::async_trait;
    use tokio::time::{sleep, timeout};
    use tokio_util::sync::CancellationToken;

    use crate::{
        connections::{ActiveSessionRuntime, ConnectionService, MemorySecretStore},
        foundation::{
            iso_timestamp, AppError, ConnectionSessionStatus, DatabaseEngine,
            DatabaseSessionSnapshot, DiagnosticsStore, QueryExecutionOrigin, QueryExecutionRequest,
            QueryResultCell, QueryResultColumn, QueryResultColumnSemanticType,
            QueryResultExportAccepted, QueryResultExportRequest, SslMode,
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
        ) -> Result<(ExecutedQueryResult, u64), AppError> {
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
                ExecutedQueryResult::BufferedRows {
                    columns: vec![test_result_column()],
                    rows: vec![vec![QueryResultCell::String(sql)]],
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

    fn test_result_column() -> QueryResultColumn {
        QueryResultColumn {
            name: "result".to_string(),
            postgres_type: "text".to_string(),
            semantic_type: QueryResultColumnSemanticType::Text,
            is_nullable: false,
        }
    }

    fn test_export_request(path: &Path) -> QueryResultExportRequest {
        QueryResultExportRequest {
            result_set_id: "result-set-1".to_string(),
            output_path: path.to_string_lossy().into_owned(),
            sort: None,
            filters: Vec::new(),
            quick_filter: String::new(),
        }
    }

    fn test_export_accepted(path: &Path) -> QueryResultExportAccepted {
        QueryResultExportAccepted {
            job_id: "job-1".to_string(),
            correlation_id: "corr-1".to_string(),
            result_set_id: "result-set-1".to_string(),
            output_path: path.to_string_lossy().into_owned(),
            started_at: iso_timestamp(),
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
        assert_eq!(csv_field_for_cell(QueryResultCell::Integer(-1)), "-1");
        assert_eq!(csv_field_for_cell(QueryResultCell::Float(-1.5)), "-1.5");
    }

    #[tokio::test]
    async fn rejects_buffered_results_that_exceed_row_limit() {
        let error = store_query_result(
            &QueryResultStore::default(),
            &test_request("tab-1", "conn-1", "select 1"),
            "result-set-1",
            ExecutedQueryResult::BufferedRows {
                columns: vec![test_result_column()],
                rows: vec![vec![QueryResultCell::Null]; MAX_BUFFERED_RESULT_ROWS + 1],
            },
        )
        .await
        .expect_err("oversized buffered result should fail");

        assert_eq!(error.code, "query_result_buffer_limit_exceeded");
    }

    #[test]
    fn rejects_buffered_results_that_exceed_byte_limit() {
        let error = enforce_buffered_result_limits(
            &[test_result_column()],
            &[vec![QueryResultCell::String(
                "x".repeat(MAX_BUFFERED_RESULT_BYTES + 1),
            )]],
        )
        .expect_err("oversized buffered payload should fail");

        assert_eq!(error.code, "query_result_buffer_limit_exceeded");
    }

    #[test]
    fn cancelled_export_removes_the_partial_file() {
        let output_path = test_database_path("cancelled-export.csv");
        let _ = std::fs::remove_file(&output_path);
        let file = File::create(&output_path).expect("export file should open");
        let mut writer = BufWriter::new(file);
        write_csv_row(
            &mut writer,
            [QueryResultCell::String("partial".to_string())],
        )
        .expect("partial row should write");

        cancel_query_result_export(
            &test_export_accepted(&output_path),
            &test_export_request(&output_path),
            None,
            0,
            writer,
        )
        .expect("cancel should succeed");

        assert!(
            !output_path.exists(),
            "cancelled export should remove the partial file"
        );
    }
}
