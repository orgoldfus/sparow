use std::time::Instant;

use async_trait::async_trait;
use chrono::{DateTime, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use deadpool_postgres::Client;
use futures_util::StreamExt;
use postgres_native_tls::MakeTlsConnector;
use tokio_postgres::{types::ToSql, NoTls, Row};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{
    connections::{build_tls_connector, ActiveSessionRuntime},
    foundation::{
        AppError, QueryResultCell, QueryResultColumn, QueryResultColumnSemanticType,
        QueryResultFilter, QueryResultFilterMode, QueryResultSort, QueryResultSortDirection,
        QueryResultWindow, QueryResultWindowRequest, SslMode,
    },
};

use super::result_store::{
    replayable_page_range_for_window, ReplayablePageRange, ReplayableQueryResultHandle,
};

const MAX_SAFE_JS_INTEGER: i64 = 9_007_199_254_740_991;
pub(crate) const REPLAYABLE_PAGE_SIZE: usize = 300;
const REPLAYABLE_PREFETCH_PAGE_MARGIN: usize = 1;

enum ReplayQueryParam {
    Text(String),
    Integer(i64),
}

impl ReplayQueryParam {
    fn as_tosql(&self) -> &(dyn ToSql + Sync) {
        match self {
            Self::Text(value) => value,
            Self::Integer(value) => value,
        }
    }
}

pub(crate) struct ReplayableRowBatchRequest<'a> {
    pub sql: &'a str,
    pub columns: &'a [QueryResultColumn],
    pub sort: Option<&'a QueryResultSort>,
    pub quick_filter: &'a str,
    pub filters: &'a [QueryResultFilter],
    pub offset: usize,
    pub limit: usize,
}

pub(crate) enum ExecutedQueryResult {
    Command {
        command_tag: String,
        rows_affected: Option<u64>,
    },
    ReplayableRows {
        columns: Vec<QueryResultColumn>,
        initial_rows: Vec<Vec<QueryResultCell>>,
        has_more_rows: bool,
    },
    BufferedRows {
        columns: Vec<QueryResultColumn>,
        rows: Vec<Vec<QueryResultCell>>,
    },
}

#[async_trait]
pub(crate) trait QueryExecutionDriver: Send + Sync {
    async fn run_query(
        &self,
        session: ActiveSessionRuntime,
        sql: String,
        cancellation: CancellationToken,
    ) -> Result<(ExecutedQueryResult, u64), AppError>;
}

pub(crate) struct RuntimeQueryExecutionDriver;

#[async_trait]
impl QueryExecutionDriver for RuntimeQueryExecutionDriver {
    async fn run_query(
        &self,
        session: ActiveSessionRuntime,
        sql: String,
        cancellation: CancellationToken,
    ) -> Result<(ExecutedQueryResult, u64), AppError> {
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
                ExecutedQueryResult::Command {
                    command_tag: command_tag_for(&sql),
                    rows_affected: Some(rows_affected),
                },
                start.elapsed().as_millis() as u64,
            ));
        }

        let result = if is_replayable_sql(&sql) {
            let initial_rows = tokio::select! {
                result = query_replayable_row_batch(
                    &client,
                    ReplayableRowBatchRequest {
                        sql: &sql,
                        columns: &result_columns,
                        sort: None,
                        quick_filter: "",
                        filters: &[],
                        offset: 0,
                        limit: REPLAYABLE_PAGE_SIZE + 1,
                    },
                ) => result,
                _ = cancellation.cancelled() => {
                    cancel_active_query(&cancel_token, session.ssl_mode).await?;
                    Err(cancelled_query_error())
                }
            }?;
            let (initial_rows, has_more_rows) =
                split_replayable_batch(initial_rows, REPLAYABLE_PAGE_SIZE);

            ExecutedQueryResult::ReplayableRows {
                columns: result_columns,
                initial_rows,
                has_more_rows,
            }
        } else {
            let row_stream = tokio::select! {
                result = client.query_raw(&statement, std::iter::empty::<&str>()) => {
                    result.map_err(normalize_query_error)
                }
                _ = cancellation.cancelled() => {
                    cancel_active_query(&cancel_token, session.ssl_mode).await?;
                    Err(cancelled_query_error())
                }
            }?;
            tokio::pin!(row_stream);

            let mut rows = Vec::new();
            loop {
                let next_row = tokio::select! {
                    next = row_stream.next() => match next {
                        Some(Ok(row)) => Ok(Some(row)),
                        Some(Err(error)) => Err(normalize_query_error(error)),
                        None => Ok(None),
                    },
                    _ = cancellation.cancelled() => {
                        cancel_active_query(&cancel_token, session.ssl_mode).await?;
                        Err(cancelled_query_error())
                    }
                }?;

                let Some(row) = next_row else {
                    break;
                };
                rows.push(read_query_result_row(&row, &result_columns));
            }

            ExecutedQueryResult::BufferedRows {
                columns: result_columns,
                rows,
            }
        };

        Ok((result, start.elapsed().as_millis() as u64))
    }
}

pub(crate) async fn load_replayable_query_result_window(
    session: ActiveSessionRuntime,
    handle: &ReplayableQueryResultHandle,
    request: &QueryResultWindowRequest,
) -> Result<QueryResultWindow, AppError> {
    let descriptor_signature = super::result_store::build_replayable_descriptor_signature(
        request.sort.as_ref(),
        &request.filters,
        &request.quick_filter,
    );
    let count_signature = super::result_store::build_replayable_count_signature(
        &request.filters,
        &request.quick_filter,
    );
    let anchor_page_range =
        replayable_page_range_for_window(request.offset, request.limit, handle.page_size());
    let fetch_page_range = anchor_page_range.with_margin(REPLAYABLE_PREFETCH_PAGE_MARGIN);
    let _guard = handle.lock_query().await;

    let snapshot = handle.cache_snapshot();
    if snapshot.descriptor_signature != descriptor_signature {
        let (rows, has_more_rows_after_batch) =
            query_replayable_page_range(&session, handle, request, fetch_page_range).await?;
        handle.replace_cached_page_batch(
            descriptor_signature.clone(),
            count_signature,
            fetch_page_range.start,
            rows,
            has_more_rows_after_batch,
        );
    } else {
        for missing_range in missing_page_ranges(&snapshot.cached_page_indexes, fetch_page_range) {
            let (rows, has_more_rows_after_batch) =
                query_replayable_page_range(&session, handle, request, missing_range).await?;
            if !handle.store_cached_page_batch(
                &descriptor_signature,
                missing_range.start,
                rows,
                has_more_rows_after_batch,
                anchor_page_range,
            ) {
                continue;
            }
        }
    }

    Ok(handle.load_window(request))
}

async fn query_replayable_page_range(
    session: &ActiveSessionRuntime,
    handle: &ReplayableQueryResultHandle,
    request: &QueryResultWindowRequest,
    page_range: ReplayablePageRange,
) -> Result<(Vec<Vec<QueryResultCell>>, bool), AppError> {
    let page_count = page_range.end.saturating_sub(page_range.start) + 1;
    let batch_size = page_count.saturating_mul(handle.page_size());
    let rows = query_replayable_row_batch(
        &checkout_replayable_client(session).await?,
        ReplayableRowBatchRequest {
            sql: &handle.sql,
            columns: &handle.columns,
            sort: request.sort.as_ref(),
            quick_filter: &request.quick_filter,
            filters: &request.filters,
            offset: page_range.start.saturating_mul(handle.page_size()),
            limit: batch_size + 1,
        },
    )
    .await?;

    Ok(split_replayable_batch(rows, batch_size))
}

fn missing_page_ranges(
    cached_page_indexes: &[usize],
    required_range: ReplayablePageRange,
) -> Vec<ReplayablePageRange> {
    let mut missing_ranges = Vec::new();
    let mut range_start = None;

    for page_index in required_range.start..=required_range.end {
        let is_cached = cached_page_indexes.binary_search(&page_index).is_ok();
        match (is_cached, range_start) {
            (false, None) => range_start = Some(page_index),
            (true, Some(start)) => {
                missing_ranges.push(ReplayablePageRange {
                    start,
                    end: page_index.saturating_sub(1),
                });
                range_start = None;
            }
            _ => {}
        }
    }

    if let Some(start) = range_start {
        missing_ranges.push(ReplayablePageRange {
            start,
            end: required_range.end,
        });
    }

    missing_ranges
}

pub(crate) async fn count_replayable_query_rows(
    session: ActiveSessionRuntime,
    handle: &ReplayableQueryResultHandle,
    quick_filter: &str,
    filters: &[QueryResultFilter],
) -> Result<usize, AppError> {
    let client = checkout_replayable_client(&session).await?;
    count_replayable_query_rows_with_client(
        &client,
        &handle.sql,
        &handle.columns,
        quick_filter,
        filters,
    )
    .await
}

async fn count_replayable_query_rows_with_client(
    client: &Client,
    sql: &str,
    columns: &[QueryResultColumn],
    quick_filter: &str,
    filters: &[QueryResultFilter],
) -> Result<usize, AppError> {
    let mut params = Vec::new();
    let where_clause = build_replayable_where_clause(columns, quick_filter, filters, &mut params);
    let query = format!(
        "select count(*) from ({}) as sparow_source{where_clause}",
        trimmed_statement(sql)
    );
    let count = query_single_i64(client, &query, &params)
        .await
        .map_err(|error| {
            AppError::internal(
                "query_result_count_failed",
                "Failed to count PostgreSQL query result rows.",
                Some(error.to_string()),
            )
        })?;

    Ok(count.max(0) as usize)
}

pub(crate) async fn query_replayable_row_batch(
    client: &Client,
    request: ReplayableRowBatchRequest<'_>,
) -> Result<Vec<Vec<QueryResultCell>>, AppError> {
    let mut params = Vec::new();
    let where_clause = build_replayable_where_clause(
        request.columns,
        request.quick_filter,
        request.filters,
        &mut params,
    );
    let order_clause = build_replayable_order_clause(request.columns, request.sort);
    let limit_placeholder = push_integer_param(&mut params, request.limit as i64);
    let offset_placeholder = push_integer_param(&mut params, request.offset as i64);
    let query = format!(
        "select * from ({}) as sparow_source{where_clause}{order_clause} limit {limit_placeholder} offset {offset_placeholder}",
        trimmed_statement(request.sql)
    );

    let rows = query_rows(client, &query, &params).await.map_err(|error| {
        AppError::internal(
            "query_result_window_query_failed",
            "Failed to read PostgreSQL query result rows.",
            Some(error.to_string()),
        )
    })?;

    Ok(rows
        .iter()
        .map(|row| read_query_result_row(row, request.columns))
        .collect())
}

fn split_replayable_batch(
    mut rows: Vec<Vec<QueryResultCell>>,
    keep_limit: usize,
) -> (Vec<Vec<QueryResultCell>>, bool) {
    let has_more_rows = rows.len() > keep_limit;
    rows.truncate(keep_limit);
    (rows, has_more_rows)
}

pub(crate) async fn checkout_replayable_client(
    session: &ActiveSessionRuntime,
) -> Result<Client, AppError> {
    let pool = session.pool.clone().ok_or_else(|| {
        AppError::internal(
            "query_missing_active_pool",
            "The active PostgreSQL session does not have a live runtime pool.",
            Some(session.snapshot.connection_id.clone()),
        )
    })?;

    pool.get().await.map_err(|error| {
        AppError::internal(
            "query_client_checkout_failed",
            "Failed to borrow a PostgreSQL client for query execution.",
            Some(error.to_string()),
        )
    })
}

async fn query_single_i64(
    client: &Client,
    query: &str,
    params: &[ReplayQueryParam],
) -> Result<i64, tokio_postgres::Error> {
    let param_refs = params
        .iter()
        .map(ReplayQueryParam::as_tosql)
        .collect::<Vec<_>>();

    client
        .query_one(query, &param_refs)
        .await
        .map(|row| row.get(0))
}

async fn query_rows(
    client: &Client,
    query: &str,
    params: &[ReplayQueryParam],
) -> Result<Vec<Row>, tokio_postgres::Error> {
    let param_refs = params
        .iter()
        .map(ReplayQueryParam::as_tosql)
        .collect::<Vec<_>>();

    client.query(query, &param_refs).await
}

fn build_replayable_where_clause(
    columns: &[QueryResultColumn],
    quick_filter: &str,
    filters: &[QueryResultFilter],
    params: &mut Vec<ReplayQueryParam>,
) -> String {
    let mut clauses = Vec::new();
    let normalized_quick_filter = quick_filter.trim().to_lowercase();

    if !normalized_quick_filter.is_empty() && !columns.is_empty() {
        let quick_filter_pattern = format!("%{normalized_quick_filter}%");
        let expressions = columns
            .iter()
            .map(|column| {
                let placeholder = push_text_param(params, quick_filter_pattern.clone());
                format!(
                    "lower(coalesce({}, '')) like {placeholder}",
                    replayable_text_expression(&column.name)
                )
            })
            .collect::<Vec<_>>();
        clauses.push(format!("({})", expressions.join(" or ")));
    }

    for filter in filters {
        if filter.value.trim().is_empty() {
            continue;
        }

        let Some(column) = columns.get(filter.column_index) else {
            continue;
        };
        let placeholder =
            push_text_param(params, format!("%{}%", filter.value.trim().to_lowercase()));
        match filter.mode {
            QueryResultFilterMode::Contains => clauses.push(format!(
                "lower(coalesce({}, '')) like {placeholder}",
                replayable_text_expression(&column.name)
            )),
        }
    }

    if clauses.is_empty() {
        String::new()
    } else {
        format!(" where {}", clauses.join(" and "))
    }
}

fn build_replayable_order_clause(
    columns: &[QueryResultColumn],
    sort: Option<&QueryResultSort>,
) -> String {
    let Some(sort) = sort else {
        return String::new();
    };
    let Some(column) = columns.get(sort.column_index) else {
        return String::new();
    };

    let direction = match sort.direction {
        QueryResultSortDirection::Asc => "asc",
        QueryResultSortDirection::Desc => "desc",
    };
    let expression = match column.semantic_type {
        QueryResultColumnSemanticType::Number => {
            format!(
                "cast(nullif({}, '') as double precision)",
                replayable_text_expression(&column.name)
            )
        }
        QueryResultColumnSemanticType::Boolean => {
            format!(
                "cast(nullif({}, '') as boolean)",
                replayable_text_expression(&column.name)
            )
        }
        _ => format!(
            "lower(coalesce({}, ''))",
            replayable_text_expression(&column.name)
        ),
    };

    format!(" order by {expression} {direction} nulls last, to_jsonb(sparow_source)::text asc")
}

fn replayable_text_expression(column_name: &str) -> String {
    format!(
        "to_jsonb(sparow_source) ->> {}",
        sql_string_literal(column_name)
    )
}

fn push_text_param(params: &mut Vec<ReplayQueryParam>, value: String) -> String {
    params.push(ReplayQueryParam::Text(value));
    format!("${}", params.len())
}

fn push_integer_param(params: &mut Vec<ReplayQueryParam>, value: i64) -> String {
    params.push(ReplayQueryParam::Integer(value));
    format!("${}", params.len())
}

fn sql_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn trimmed_statement(sql: &str) -> String {
    sql.trim().trim_end_matches(';').trim().to_string()
}

fn is_replayable_sql(sql: &str) -> bool {
    matches!(
        leading_sql_keyword(sql).as_deref(),
        Some("SELECT" | "WITH" | "VALUES" | "TABLE")
    )
}

fn leading_sql_keyword(sql: &str) -> Option<String> {
    let mut remaining = sql.trim_start();
    loop {
        if let Some(stripped) = remaining.strip_prefix("--") {
            remaining = stripped
                .split_once('\n')
                .map(|(_, rest)| rest)
                .unwrap_or("");
            remaining = remaining.trim_start();
            continue;
        }

        if let Some(stripped) = remaining.strip_prefix("/*") {
            remaining = stripped
                .split_once("*/")
                .map(|(_, rest)| rest)
                .unwrap_or("");
            remaining = remaining.trim_start();
            continue;
        }

        break;
    }

    remaining
        .split_whitespace()
        .next()
        .map(|keyword| keyword.to_ascii_uppercase())
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

pub(crate) fn read_query_result_row(
    row: &Row,
    columns: &[QueryResultColumn],
) -> Vec<QueryResultCell> {
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
        Some(value) if value.is_finite() => QueryResultCell::Float(value),
        Some(value) => QueryResultCell::String(value.to_string()),
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
    leading_sql_keyword(sql).unwrap_or_else(|| "QUERY".to_string())
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
