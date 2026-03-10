use std::time::Instant;

use async_trait::async_trait;
use postgres_native_tls::MakeTlsConnector;
use tokio_postgres::{NoTls, SimpleQueryMessage};
use tokio_util::sync::CancellationToken;

use crate::{
    connections::{build_tls_connector, ActiveSessionRuntime},
    foundation::{AppError, QueryExecutionResult, QueryResultColumn, SslMode},
};

const PREVIEW_ROW_LIMIT: usize = 200;

#[async_trait]
pub(crate) trait QueryExecutionDriver: Send + Sync {
    async fn run_query(
        &self,
        session: ActiveSessionRuntime,
        sql: String,
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

        let execute = async {
            let statement = client.prepare(&sql).await.map_err(normalize_query_error)?;
            let result_columns = statement
                .columns()
                .iter()
                .map(|column| QueryResultColumn {
                    name: column.name().to_string(),
                    postgres_type: column.type_().name().to_string(),
                })
                .collect::<Vec<_>>();
            let messages = client
                .simple_query(&sql)
                .await
                .map_err(normalize_query_error)?;

            if result_columns.is_empty() {
                let rows_affected = extract_rows_affected(&messages);
                Ok(QueryExecutionResult::Command {
                    command_tag: command_tag_for(&sql),
                    rows_affected,
                })
            } else {
                Ok(QueryExecutionResult::Rows {
                    columns: result_columns,
                    preview_rows: collect_preview_rows(&messages),
                    preview_row_count: count_row_messages(&messages),
                    truncated: count_row_messages(&messages) > PREVIEW_ROW_LIMIT,
                })
            }
        };

        tokio::pin!(execute);

        let result = tokio::select! {
            result = &mut execute => result,
            _ = cancellation.cancelled() => {
                cancel_active_query(&cancel_token, session.ssl_mode).await?;
                Err(cancelled_query_error())
            }
        }?;

        Ok((result, start.elapsed().as_millis() as u64))
    }
}

fn collect_preview_rows(messages: &[SimpleQueryMessage]) -> Vec<Vec<Option<String>>> {
    let mut preview_rows = Vec::new();

    for message in messages {
        if let SimpleQueryMessage::Row(row) = message {
            if preview_rows.len() >= PREVIEW_ROW_LIMIT {
                continue;
            }

            let values = row
                .columns()
                .iter()
                .enumerate()
                .map(|(index, _)| row.get(index).map(str::to_string))
                .collect::<Vec<_>>();
            preview_rows.push(values);
        }
    }

    preview_rows
}

fn count_row_messages(messages: &[SimpleQueryMessage]) -> usize {
    messages
        .iter()
        .filter(|message| matches!(message, SimpleQueryMessage::Row(_)))
        .count()
}

fn extract_rows_affected(messages: &[SimpleQueryMessage]) -> Option<u64> {
    messages.iter().rev().find_map(|message| match message {
        SimpleQueryMessage::CommandComplete(rows) => Some(*rows as u64),
        _ => None,
    })
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
