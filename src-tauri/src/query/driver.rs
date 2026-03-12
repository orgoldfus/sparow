use std::{sync::Arc, time::Instant};

use async_trait::async_trait;
use chrono::{DateTime, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use futures_util::StreamExt;
use postgres_native_tls::MakeTlsConnector;
use tauri::AppHandle;
use tokio::task;
use tokio_postgres::{NoTls, Row};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{
    commands::emit_query_result_stream_event,
    connections::{build_tls_connector, ActiveSessionRuntime},
    foundation::{
        iso_timestamp, AppError, QueryExecutionResult, QueryResultCell, QueryResultColumn,
        QueryResultColumnSemanticType, QueryResultSetSummary, QueryResultStatus,
        QueryResultStreamEvent, QueryResultStreamStatus, SslMode,
    },
    persistence::{
        AppendQueryResultRowsRecord, CreateQueryResultSetRecord, FinalizeQueryResultSetRecord,
        QueryResultSetStatus, Repository,
    },
};

const RESULT_BATCH_SIZE: usize = 250;
const MAX_SAFE_JS_INTEGER: i64 = 9_007_199_254_740_991;

#[derive(Clone)]
pub(crate) struct QueryResultStreamContext {
    pub repository: Arc<Repository>,
    pub app: Option<AppHandle>,
    pub result_set_id: String,
    pub job_id: String,
    pub correlation_id: String,
    pub tab_id: String,
    pub connection_id: String,
    pub sql: String,
    pub started_at: String,
}

#[async_trait]
pub(crate) trait QueryExecutionDriver: Send + Sync {
    async fn run_query(
        &self,
        session: ActiveSessionRuntime,
        sql: String,
        stream_context: QueryResultStreamContext,
        cancellation: CancellationToken,
    ) -> Result<(QueryExecutionResult, u64), AppError>;
}

pub(crate) struct RuntimeQueryExecutionDriver;

#[async_trait]
impl QueryExecutionDriver for RuntimeQueryExecutionDriver {
    async fn run_query(
        &self,
        session: ActiveSessionRuntime,
        sql: String,
        stream_context: QueryResultStreamContext,
        cancellation: CancellationToken,
    ) -> Result<(QueryExecutionResult, u64), AppError> {
        let pool = session.pool.ok_or_else(|| {
            AppError::internal(
                "query_missing_active_pool",
                "The active PostgreSQL session does not have a live runtime pool.",
                Some(session.snapshot.connection_id.clone()),
            )
        })?;

        let client = pool.get().await.map_err(|error| {
            AppError::internal(
                "query_client_checkout_failed",
                "Failed to borrow a PostgreSQL client for query execution.",
                Some(error.to_string()),
            )
        })?;
        let cancel_token = client.cancel_token();
        let start = Instant::now();
        let statement = client.prepare(&sql).await.map_err(normalize_query_error)?;
        let result_columns = statement
            .columns()
            .iter()
            .map(build_query_result_column)
            .collect::<Vec<_>>();

        if result_columns.is_empty() {
            let rows_affected = tokio::select! {
                result = client.execute(&statement, &[]) => result.map_err(normalize_query_error),
                _ = cancellation.cancelled() => {
                    cancel_active_query(&cancel_token, session.ssl_mode).await?;
                    Err(cancelled_query_error())
                }
            }?;

            return Ok((
                QueryExecutionResult::Command {
                    command_tag: command_tag_for(&sql),
                    rows_affected: Some(rows_affected),
                },
                start.elapsed().as_millis() as u64,
            ));
        }

        create_result_set(&stream_context, &result_columns).await?;
        emit_stream_event(
            &stream_context,
            QueryResultStreamEvent {
                job_id: stream_context.job_id.clone(),
                correlation_id: stream_context.correlation_id.clone(),
                tab_id: stream_context.tab_id.clone(),
                connection_id: stream_context.connection_id.clone(),
                result_set_id: stream_context.result_set_id.clone(),
                status: QueryResultStreamStatus::MetadataReady,
                buffered_row_count: 0,
                total_row_count: None,
                chunk_row_count: 0,
                columns: Some(result_columns.clone()),
                message: "Query result metadata is ready.".to_string(),
                started_at: stream_context.started_at.clone(),
                timestamp: iso_timestamp(),
                last_error: None,
            },
        )?;

        let row_stream = client
            .query_raw(&statement, std::iter::empty::<&str>())
            .await
            .map_err(normalize_query_error)?;
        tokio::pin!(row_stream);
        let mut buffered_row_count = 0_usize;
        let mut batch = Vec::with_capacity(RESULT_BATCH_SIZE);

        loop {
            let next_row = tokio::select! {
                next = row_stream.next() => match next {
                    Some(Ok(row)) => Ok(Some(row)),
                    Some(Err(error)) => Err(normalize_query_error(error)),
                    None => Ok(None),
                },
                _ = cancellation.cancelled() => {
                    cancel_active_query(&cancel_token, session.ssl_mode).await?;
                    let cancelled = cancelled_query_error();
                    finalize_result_set(
                        &stream_context,
                        FinalizeQueryResultSetRecord {
                            result_set_id: stream_context.result_set_id.clone(),
                            buffered_row_count,
                            total_row_count: None,
                            status: QueryResultSetStatus::Cancelled,
                            completed_at: Some(iso_timestamp()),
                            last_error: Some(cancelled.clone()),
                        },
                        QueryResultStreamStatus::Cancelled,
                        0,
                        "Query result streaming was cancelled.".to_string(),
                    ).await?;
                    return Err(cancelled);
                }
            }?;

            let Some(row) = next_row else {
                break;
            };

            batch.push(read_query_result_row(&row, &result_columns));
            if batch.len() >= RESULT_BATCH_SIZE {
                buffered_row_count =
                    flush_result_batch(&stream_context, &mut batch, buffered_row_count).await?;
            }
        }

        if !batch.is_empty() {
            buffered_row_count =
                flush_result_batch(&stream_context, &mut batch, buffered_row_count).await?;
        }

        let completed_at = iso_timestamp();
        finalize_result_set(
            &stream_context,
            FinalizeQueryResultSetRecord {
                result_set_id: stream_context.result_set_id.clone(),
                buffered_row_count,
                total_row_count: Some(buffered_row_count),
                status: QueryResultSetStatus::Completed,
                completed_at: Some(completed_at),
                last_error: None,
            },
            QueryResultStreamStatus::Completed,
            0,
            format!("Cached {buffered_row_count} query result rows."),
        )
        .await?;

        Ok((
            QueryExecutionResult::Rows {
                summary: QueryResultSetSummary {
                    result_set_id: stream_context.result_set_id,
                    columns: result_columns,
                    buffered_row_count,
                    total_row_count: Some(buffered_row_count),
                    status: QueryResultStatus::Completed,
                },
            },
            start.elapsed().as_millis() as u64,
        ))
    }
}

async fn create_result_set(
    context: &QueryResultStreamContext,
    columns: &[QueryResultColumn],
) -> Result<(), AppError> {
    let repository = context.repository.clone();
    let record = CreateQueryResultSetRecord {
        result_set_id: context.result_set_id.clone(),
        job_id: context.job_id.clone(),
        tab_id: context.tab_id.clone(),
        connection_id: context.connection_id.clone(),
        sql: context.sql.clone(),
        columns: columns.to_vec(),
        created_at: context.started_at.clone(),
    };

    task::spawn_blocking(move || repository.create_query_result_set(record))
        .await
        .map_err(|error| {
            AppError::internal(
                "query_result_set_create_join_failed",
                "Failed to join query result cache creation.",
                Some(error.to_string()),
            )
        })??;

    Ok(())
}

async fn flush_result_batch(
    context: &QueryResultStreamContext,
    batch: &mut Vec<Vec<QueryResultCell>>,
    buffered_row_count: usize,
) -> Result<usize, AppError> {
    let chunk_row_count = batch.len();
    let next_rows = std::mem::take(batch);
    let updated_row_count = buffered_row_count + chunk_row_count;
    let repository = context.repository.clone();
    let record = AppendQueryResultRowsRecord {
        result_set_id: context.result_set_id.clone(),
        starting_row_index: buffered_row_count,
        rows: next_rows,
        buffered_row_count: updated_row_count,
    };

    task::spawn_blocking(move || repository.append_query_result_rows(record))
        .await
        .map_err(|error| {
            AppError::internal(
                "query_result_batch_join_failed",
                "Failed to join cached query result persistence.",
                Some(error.to_string()),
            )
        })??;

    emit_stream_event(
        context,
        QueryResultStreamEvent {
            job_id: context.job_id.clone(),
            correlation_id: context.correlation_id.clone(),
            tab_id: context.tab_id.clone(),
            connection_id: context.connection_id.clone(),
            result_set_id: context.result_set_id.clone(),
            status: QueryResultStreamStatus::RowsBuffered,
            buffered_row_count: updated_row_count,
            total_row_count: None,
            chunk_row_count,
            columns: None,
            message: format!("Buffered {updated_row_count} rows into the cached result set."),
            started_at: context.started_at.clone(),
            timestamp: iso_timestamp(),
            last_error: None,
        },
    )?;

    Ok(updated_row_count)
}

async fn finalize_result_set(
    context: &QueryResultStreamContext,
    record: FinalizeQueryResultSetRecord,
    stream_status: QueryResultStreamStatus,
    chunk_row_count: usize,
    message: String,
) -> Result<(), AppError> {
    let repository = context.repository.clone();
    let buffered_row_count = record.buffered_row_count;
    let total_row_count = record.total_row_count;
    let last_error = record.last_error.clone();

    task::spawn_blocking(move || repository.finalize_query_result_set(record))
        .await
        .map_err(|error| {
            AppError::internal(
                "query_result_finalize_join_failed",
                "Failed to join cached query result finalization.",
                Some(error.to_string()),
            )
        })??;

    emit_stream_event(
        context,
        QueryResultStreamEvent {
            job_id: context.job_id.clone(),
            correlation_id: context.correlation_id.clone(),
            tab_id: context.tab_id.clone(),
            connection_id: context.connection_id.clone(),
            result_set_id: context.result_set_id.clone(),
            status: stream_status,
            buffered_row_count,
            total_row_count,
            chunk_row_count,
            columns: None,
            message,
            started_at: context.started_at.clone(),
            timestamp: iso_timestamp(),
            last_error,
        },
    )?;

    Ok(())
}

fn emit_stream_event(
    context: &QueryResultStreamContext,
    event: QueryResultStreamEvent,
) -> Result<(), AppError> {
    if let Some(app) = context.app.as_ref() {
        emit_query_result_stream_event(app, &event)?;
    }

    Ok(())
}

fn build_query_result_column(column: &tokio_postgres::Column) -> QueryResultColumn {
    let postgres_type = column.type_().name().to_string();
    QueryResultColumn {
        name: column.name().to_string(),
        semantic_type: semantic_type_for_postgres_type(&postgres_type),
        postgres_type,
        is_nullable: true,
    }
}

fn read_query_result_row(row: &Row, columns: &[QueryResultColumn]) -> Vec<QueryResultCell> {
    columns
        .iter()
        .enumerate()
        .map(|(index, column)| read_query_result_cell(row, index, column.postgres_type.as_str()))
        .collect()
}

fn read_query_result_cell(row: &Row, index: usize, postgres_type: &str) -> QueryResultCell {
    match postgres_type {
        "bool" => match row.try_get::<usize, Option<bool>>(index) {
            Ok(Some(value)) => QueryResultCell::Boolean(value),
            Ok(None) => QueryResultCell::Null,
            Err(_) => QueryResultCell::String(format!("<unsupported:{postgres_type}>")),
        },
        "int2" => integer_cell(
            row.try_get::<usize, Option<i16>>(index)
                .ok()
                .flatten()
                .map(i64::from),
        ),
        "int4" => integer_cell(
            row.try_get::<usize, Option<i32>>(index)
                .ok()
                .flatten()
                .map(i64::from),
        ),
        "int8" => int8_cell(row.try_get::<usize, Option<i64>>(index).ok().flatten()),
        "oid" => integer_cell(
            row.try_get::<usize, Option<u32>>(index)
                .ok()
                .flatten()
                .map(i64::from),
        ),
        "float4" => float_cell(
            row.try_get::<usize, Option<f32>>(index)
                .ok()
                .flatten()
                .map(f64::from),
        ),
        "float8" => float_cell(row.try_get::<usize, Option<f64>>(index).ok().flatten()),
        "numeric" => {
            if let Ok(value) = row.try_get::<usize, Option<String>>(index) {
                return string_like_cell(value);
            }

            QueryResultCell::String(format!("<unsupported:{postgres_type}>"))
        }
        "uuid" => string_like_cell(
            row.try_get::<usize, Option<Uuid>>(index)
                .ok()
                .flatten()
                .map(|value| value.to_string()),
        ),
        "json" | "jsonb" => string_like_cell(
            row.try_get::<usize, Option<serde_json::Value>>(index)
                .ok()
                .flatten()
                .map(|value| value.to_string()),
        ),
        "date" => string_like_cell(
            row.try_get::<usize, Option<NaiveDate>>(index)
                .ok()
                .flatten()
                .map(|value| value.to_string()),
        ),
        "timestamp" => string_like_cell(
            row.try_get::<usize, Option<NaiveDateTime>>(index)
                .ok()
                .flatten()
                .map(|value| value.to_string()),
        ),
        "timestamptz" => string_like_cell(
            row.try_get::<usize, Option<DateTime<Utc>>>(index)
                .ok()
                .flatten()
                .map(|value| value.to_rfc3339()),
        ),
        "timetz" => string_like_cell(
            row.try_get::<usize, Option<DateTime<FixedOffset>>>(index)
                .ok()
                .flatten()
                .map(|value| value.to_rfc3339()),
        ),
        "time" => string_like_cell(
            row.try_get::<usize, Option<NaiveTime>>(index)
                .ok()
                .flatten()
                .map(|value| value.to_string()),
        ),
        "bytea" => string_like_cell(
            row.try_get::<usize, Option<Vec<u8>>>(index)
                .ok()
                .flatten()
                .map(format_bytes),
        ),
        _ => {
            if let Ok(value) = row.try_get::<usize, Option<String>>(index) {
                return string_like_cell(value);
            }

            QueryResultCell::String(format!("<unsupported:{postgres_type}>"))
        }
    }
}

fn integer_cell(value: Option<i64>) -> QueryResultCell {
    match value {
        Some(value) => QueryResultCell::Integer(value),
        None => QueryResultCell::Null,
    }
}

fn int8_cell(value: Option<i64>) -> QueryResultCell {
    match value {
        Some(value) if (-MAX_SAFE_JS_INTEGER..=MAX_SAFE_JS_INTEGER).contains(&value) => {
            QueryResultCell::Integer(value)
        }
        Some(value) => QueryResultCell::String(value.to_string()),
        None => QueryResultCell::Null,
    }
}

fn float_cell(value: Option<f64>) -> QueryResultCell {
    match value {
        Some(value) => QueryResultCell::Float(value),
        None => QueryResultCell::Null,
    }
}

fn string_like_cell(value: Option<String>) -> QueryResultCell {
    match value {
        Some(value) => QueryResultCell::String(value),
        None => QueryResultCell::Null,
    }
}

fn format_bytes(bytes: Vec<u8>) -> String {
    let mut output = String::from("\\x");
    for byte in bytes {
        output.push_str(&format!("{byte:02x}"));
    }
    output
}

fn semantic_type_for_postgres_type(postgres_type: &str) -> QueryResultColumnSemanticType {
    match postgres_type {
        "bool" => QueryResultColumnSemanticType::Boolean,
        "int2" | "int4" | "int8" | "float4" | "float8" | "oid" => {
            QueryResultColumnSemanticType::Number
        }
        "numeric" => QueryResultColumnSemanticType::Text,
        "json" | "jsonb" => QueryResultColumnSemanticType::Json,
        "bytea" => QueryResultColumnSemanticType::Binary,
        "date" | "time" | "timetz" | "timestamp" | "timestamptz" => {
            QueryResultColumnSemanticType::Temporal
        }
        "text" | "varchar" | "bpchar" | "name" | "uuid" => QueryResultColumnSemanticType::Text,
        _ => QueryResultColumnSemanticType::Unknown,
    }
}

fn command_tag_for(sql: &str) -> String {
    sql.split_whitespace()
        .next()
        .map(|keyword| keyword.to_ascii_uppercase())
        .filter(|keyword| !keyword.is_empty())
        .unwrap_or_else(|| "QUERY".to_string())
}

async fn cancel_active_query(
    cancel_token: &tokio_postgres::CancelToken,
    ssl_mode: SslMode,
) -> Result<(), AppError> {
    match ssl_mode {
        SslMode::Disable => cancel_token.cancel_query(NoTls).await.map_err(|error| {
            AppError::internal(
                "query_cancel_failed",
                "Failed to send a PostgreSQL query cancellation request.",
                Some(error.to_string()),
            )
        }),
        SslMode::Prefer | SslMode::Require | SslMode::Insecure => {
            let connector = MakeTlsConnector::new(build_tls_connector(ssl_mode)?);
            cancel_token.cancel_query(connector).await.map_err(|error| {
                AppError::internal(
                    "query_cancel_failed",
                    "Failed to send a PostgreSQL query cancellation request.",
                    Some(error.to_string()),
                )
            })
        }
    }
}

fn normalize_query_error(error: tokio_postgres::Error) -> AppError {
    let detail = error.to_string();

    if detail
        .to_ascii_lowercase()
        .contains("canceling statement due to user request")
    {
        return cancelled_query_error();
    }

    AppError::internal(
        "query_sql_execution_failed",
        "PostgreSQL query execution failed.",
        Some(detail),
    )
}

pub(crate) fn cancelled_query_error() -> AppError {
    AppError::retryable("query_cancelled", "The running query was cancelled.", None)
}
