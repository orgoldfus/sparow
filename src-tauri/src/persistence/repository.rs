use std::path::PathBuf;

use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::foundation::{
    ensure_parent_directory, AppError, QueryResultCell, QueryResultColumn, QueryResultFilter,
    QueryResultFilterMode, QueryResultSort, QueryResultSortDirection, QueryResultWindow,
    QueryResultWindowRequest, SchemaNode, SchemaScopeKind, SecretProvider, SslMode,
};

const MIGRATIONS: [(&str, &str); 4] = [
    ("0001_init", include_str!("migrations/0001_init.sql")),
    (
        "0002_connection_management",
        include_str!("migrations/0002_connection_management.sql"),
    ),
    (
        "0003_schema_browser",
        include_str!("migrations/0003_schema_browser.sql"),
    ),
    (
        "0004_result_viewer",
        include_str!("migrations/0004_result_viewer.sql"),
    ),
];

const SELECTED_CONNECTION_ID_KEY: &str = "connections.selectedConnectionId";
const ROOT_SCOPE_PATH: &str = "";

#[derive(Debug, Clone, Copy)]
pub struct SampleCounts {
    pub history_entries: usize,
    pub saved_queries: usize,
    pub schema_cache_entries: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedSecretRef {
    pub provider: SecretProvider,
    pub service: String,
    pub account: String,
}

#[derive(Debug, Clone)]
pub struct SavedConnectionRecord {
    pub id: String,
    pub engine: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub ssl_mode: SslMode,
    pub secret_ref: Option<PersistedSecretRef>,
    pub created_at: String,
    pub updated_at: String,
    pub last_tested_at: Option<String>,
    pub last_connected_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SaveConnectionRecord {
    pub id: Option<String>,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub ssl_mode: SslMode,
    pub secret_ref: Option<PersistedSecretRef>,
}

#[derive(Debug, Clone)]
pub struct CachedSchemaScopeRecord {
    pub refreshed_at: Option<String>,
    pub refresh_status: Option<String>,
    pub nodes: Vec<SchemaNode>,
}

#[derive(Debug, Clone)]
pub struct ReplaceSchemaScopeRecord {
    pub connection_id: String,
    pub scope_kind: SchemaScopeKind,
    pub scope_path: Option<String>,
    pub refreshed_at: String,
    pub refresh_status: String,
    pub nodes: Vec<SchemaNode>,
}

#[derive(Debug, Clone)]
pub struct CreateQueryResultSetRecord {
    pub result_set_id: String,
    pub job_id: String,
    pub tab_id: String,
    pub connection_id: String,
    pub sql: String,
    pub columns: Vec<QueryResultColumn>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct AppendQueryResultRowsRecord {
    pub result_set_id: String,
    pub starting_row_index: usize,
    pub rows: Vec<Vec<QueryResultCell>>,
    pub buffered_row_count: usize,
}

#[derive(Debug, Clone)]
pub struct FinalizeQueryResultSetRecord {
    pub result_set_id: String,
    pub buffered_row_count: usize,
    pub total_row_count: Option<usize>,
    pub status: QueryResultSetStatus,
    pub completed_at: Option<String>,
    pub last_error: Option<AppError>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueryResultSetStatus {
    Running,
    Completed,
    Cancelled,
    Failed,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct QueryResultSetRecord {
    pub result_set_id: String,
    pub job_id: String,
    pub tab_id: String,
    pub connection_id: String,
    pub sql: String,
    pub columns: Vec<QueryResultColumn>,
    pub buffered_row_count: usize,
    pub total_row_count: Option<usize>,
    pub status: QueryResultSetStatus,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub last_error: Option<AppError>,
}

#[derive(Debug, Clone)]
pub struct Repository {
    database_path: PathBuf,
}

impl Repository {
    pub fn new(database_path: PathBuf) -> Result<Self, AppError> {
        ensure_parent_directory(&database_path)?;

        let repository = Self { database_path };
        repository.apply_migrations()?;
        Ok(repository)
    }

    pub fn seed_phase_one(&self) -> Result<(), AppError> {
        self.save_setting("phase1.bootstrap", "created")?;
        if self.sample_counts()?.history_entries == 0 {
            self.record_history("-- seeded phase-1 history entry\nselect 1;".to_string())?;
        }

        Ok(())
    }

    pub fn sample_counts(&self) -> Result<SampleCounts, AppError> {
        let connection = self.open()?;

        Ok(SampleCounts {
            history_entries: self.count_rows(&connection, "query_history")?,
            saved_queries: self.count_rows(&connection, "saved_queries")?,
            schema_cache_entries: self.count_rows(&connection, "schema_cache")?,
        })
    }

    pub fn record_history(&self, sql: String) -> Result<(), AppError> {
        self.record_history_entry(sql, None)
    }

    pub fn record_history_entry(
        &self,
        sql: String,
        connection_profile_id: Option<String>,
    ) -> Result<(), AppError> {
        let connection = self.open()?;
        connection
            .execute(
                "insert into query_history (id, sql, connection_profile_id, created_at) values (?1, ?2, ?3, datetime('now'))",
                params![uuid::Uuid::new_v4().to_string(), sql, connection_profile_id],
            )
            .map_err(|error| {
                AppError::internal(
                    "query_history_insert_failed",
                    "Failed to insert a query history entry.",
                    Some(error.to_string()),
                )
            })?;

        Ok(())
    }

    pub fn list_saved_connections(&self) -> Result<Vec<SavedConnectionRecord>, AppError> {
        let connection = self.open()?;
        let mut statement = connection
            .prepare(
                "select
                    id,
                    engine,
                    name,
                    host,
                    port,
                    database_name,
                    username,
                    ssl_mode,
                    secret_ref_json,
                    created_at,
                    updated_at,
                    last_tested_at,
                    last_connected_at
                 from saved_connections
                 order by lower(name), id",
            )
            .map_err(|error| {
                AppError::internal(
                    "saved_connections_prepare_failed",
                    "Failed to prepare the saved connections query.",
                    Some(error.to_string()),
                )
            })?;

        let rows = statement
            .query_map([], Self::read_saved_connection)
            .map_err(|error| {
                AppError::internal(
                    "saved_connections_query_failed",
                    "Failed to load saved connections.",
                    Some(error.to_string()),
                )
            })?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|error| {
            AppError::internal(
                "saved_connections_row_failed",
                "Failed to decode a saved connection record.",
                Some(error.to_string()),
            )
        })
    }

    pub fn get_saved_connection(
        &self,
        id: &str,
    ) -> Result<Option<SavedConnectionRecord>, AppError> {
        let connection = self.open()?;
        connection
            .query_row(
                "select
                    id,
                    engine,
                    name,
                    host,
                    port,
                    database_name,
                    username,
                    ssl_mode,
                    secret_ref_json,
                    created_at,
                    updated_at,
                    last_tested_at,
                    last_connected_at
                 from saved_connections
                 where id = ?1",
                params![id],
                Self::read_saved_connection,
            )
            .optional()
            .map_err(|error| {
                AppError::internal(
                    "saved_connection_query_failed",
                    "Failed to load the saved connection.",
                    Some(error.to_string()),
                )
            })
    }

    pub fn save_connection(
        &self,
        record: SaveConnectionRecord,
    ) -> Result<SavedConnectionRecord, AppError> {
        let connection = self.open()?;
        let id = record
            .id
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let secret_ref_json = record
            .secret_ref
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|error| {
                AppError::internal(
                    "secret_ref_serialize_failed",
                    "Failed to serialize the connection secret reference.",
                    Some(error.to_string()),
                )
            })?;

        connection
            .execute(
                "insert into saved_connections (
                    id,
                    engine,
                    name,
                    host,
                    port,
                    database_name,
                    username,
                    ssl_mode,
                    secret_ref_json,
                    created_at,
                    updated_at,
                    last_tested_at,
                    last_connected_at
                 ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, datetime('now'), datetime('now'), null, null)
                 on conflict(id) do update set
                    engine = excluded.engine,
                    name = excluded.name,
                    host = excluded.host,
                    port = excluded.port,
                    database_name = excluded.database_name,
                    username = excluded.username,
                    ssl_mode = excluded.ssl_mode,
                    secret_ref_json = excluded.secret_ref_json,
                    updated_at = datetime('now')",
                params![
                    id,
                    record.engine_or_default(),
                    record.name,
                    record.host,
                    i64::from(record.port),
                    record.database,
                    record.username,
                    record.ssl_mode.as_str(),
                    secret_ref_json,
                ],
            )
            .map_err(|error| {
                AppError::internal(
                    "saved_connection_upsert_failed",
                    "Failed to save the connection metadata.",
                    Some(error.to_string()),
                )
            })?;

        self.get_saved_connection(&id)?.ok_or_else(|| {
            AppError::internal(
                "saved_connection_missing_after_save",
                "The saved connection could not be reloaded after save.",
                Some(id),
            )
        })
    }

    pub fn set_connection_last_tested_at(&self, id: &str, tested_at: &str) -> Result<(), AppError> {
        self.update_saved_connection_timestamp("last_tested_at", id, tested_at)
    }

    pub fn set_connection_last_connected_at(
        &self,
        id: &str,
        connected_at: &str,
    ) -> Result<(), AppError> {
        self.update_saved_connection_timestamp("last_connected_at", id, connected_at)
    }

    pub fn delete_saved_connection(&self, id: &str) -> Result<bool, AppError> {
        let connection = self.open()?;
        let deleted = connection
            .execute("delete from saved_connections where id = ?1", params![id])
            .map_err(|error| {
                AppError::internal(
                    "saved_connection_delete_failed",
                    "Failed to delete the saved connection.",
                    Some(error.to_string()),
                )
            })?;

        Ok(deleted > 0)
    }

    pub fn load_selected_connection_id(&self) -> Result<Option<String>, AppError> {
        self.load_setting(SELECTED_CONNECTION_ID_KEY)
    }

    pub fn save_selected_connection_id(&self, connection_id: Option<&str>) -> Result<(), AppError> {
        match connection_id {
            Some(connection_id) => self.save_setting(SELECTED_CONNECTION_ID_KEY, connection_id),
            None => self.delete_setting(SELECTED_CONNECTION_ID_KEY),
        }
    }

    pub fn replace_schema_scope(
        &self,
        record: ReplaceSchemaScopeRecord,
    ) -> Result<CachedSchemaScopeRecord, AppError> {
        let mut connection = self.open()?;
        let transaction = connection.transaction().map_err(|error| {
            AppError::internal(
                "schema_cache_transaction_failed",
                "Failed to start a schema cache transaction.",
                Some(error.to_string()),
            )
        })?;
        let persisted_scope_path = persist_scope_path(record.scope_path.as_deref());
        let persisted_parent_path = record.scope_path.clone();

        transaction
            .execute(
                "with recursive descendant_paths(path) as (
                    select object_path
                    from schema_cache
                    where connection_profile_id = ?1 and coalesce(parent_path, '') = ?2
                    union
                    select schema_cache.object_path
                    from schema_cache
                    join descendant_paths on coalesce(schema_cache.parent_path, '') = descendant_paths.path
                    where schema_cache.connection_profile_id = ?1
                 )
                 delete from schema_cache_scopes
                 where connection_profile_id = ?1
                   and (
                     scope_path = ?2
                     or scope_path in (select path from descendant_paths)
                   )",
                params![record.connection_id, persisted_scope_path],
            )
            .map_err(|error| {
                AppError::internal(
                    "schema_scope_delete_failed",
                    "Failed to replace cached schema scope metadata.",
                    Some(error.to_string()),
                )
            })?;

        transaction
            .execute(
                "with recursive descendant_paths(path) as (
                    select object_path
                    from schema_cache
                    where connection_profile_id = ?1 and coalesce(parent_path, '') = ?2
                    union
                    select schema_cache.object_path
                    from schema_cache
                    join descendant_paths on coalesce(schema_cache.parent_path, '') = descendant_paths.path
                    where schema_cache.connection_profile_id = ?1
                 )
                 delete from schema_cache
                 where connection_profile_id = ?1
                   and (
                     coalesce(parent_path, '') = ?2
                     or coalesce(parent_path, '') in (select path from descendant_paths)
                   )",
                params![record.connection_id, persisted_scope_path],
            )
            .map_err(|error| {
                AppError::internal(
                    "schema_cache_delete_failed",
                    "Failed to replace cached schema nodes.",
                    Some(error.to_string()),
                )
            })?;

        for (position, node) in record.nodes.iter().enumerate() {
            let payload_json = serde_json::to_string(node).map_err(|error| {
                AppError::internal(
                    "schema_cache_serialize_failed",
                    "Failed to serialize a schema node for cache storage.",
                    Some(error.to_string()),
                )
            })?;
            let base = node.base();

            transaction
                .execute(
                    "insert into schema_cache (
                        id,
                        connection_profile_id,
                        object_kind,
                        object_path,
                        payload_json,
                        refreshed_at,
                        display_name,
                        parent_path,
                        schema_name,
                        relation_name,
                        position,
                        has_children
                     ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                    params![
                        &base.id,
                        &record.connection_id,
                        node.kind_name(),
                        &base.path,
                        payload_json,
                        &base.refreshed_at,
                        &base.name,
                        &persisted_parent_path,
                        &base.schema_name,
                        &base.relation_name,
                        position as i64,
                        if base.has_children { 1_i64 } else { 0_i64 },
                    ],
                )
                .map_err(|error| {
                    AppError::internal(
                        "schema_cache_insert_failed",
                        "Failed to write schema nodes into cache.",
                        Some(error.to_string()),
                    )
                })?;
        }

        transaction
            .execute(
                "insert into schema_cache_scopes (
                    connection_profile_id,
                    scope_path,
                    scope_kind,
                    refreshed_at,
                    refresh_status
                 ) values (?1, ?2, ?3, ?4, ?5)
                 on conflict(connection_profile_id, scope_path) do update set
                    scope_kind = excluded.scope_kind,
                    refreshed_at = excluded.refreshed_at,
                    refresh_status = excluded.refresh_status",
                params![
                    &record.connection_id,
                    persisted_scope_path,
                    schema_scope_kind_as_str(record.scope_kind),
                    &record.refreshed_at,
                    &record.refresh_status,
                ],
            )
            .map_err(|error| {
                AppError::internal(
                    "schema_scope_upsert_failed",
                    "Failed to write schema scope metadata.",
                    Some(error.to_string()),
                )
            })?;

        transaction.commit().map_err(|error| {
            AppError::internal(
                "schema_cache_commit_failed",
                "Failed to commit schema cache changes.",
                Some(error.to_string()),
            )
        })?;

        self.load_schema_scope(&record.connection_id, record.scope_path.as_deref())
    }

    pub fn record_schema_scope_failure(
        &self,
        connection_id: &str,
        scope_kind: SchemaScopeKind,
        scope_path: Option<&str>,
        refreshed_at: &str,
    ) -> Result<(), AppError> {
        let connection = self.open()?;
        connection
            .execute(
                "insert into schema_cache_scopes (
                    connection_profile_id,
                    scope_path,
                    scope_kind,
                    refreshed_at,
                    refresh_status
                 ) values (?1, ?2, ?3, ?4, 'failed')
                 on conflict(connection_profile_id, scope_path) do update set
                    scope_kind = excluded.scope_kind,
                    refreshed_at = excluded.refreshed_at,
                    refresh_status = excluded.refresh_status",
                params![
                    connection_id,
                    persist_scope_path(scope_path),
                    schema_scope_kind_as_str(scope_kind),
                    refreshed_at,
                ],
            )
            .map_err(|error| {
                AppError::internal(
                    "schema_scope_failure_upsert_failed",
                    "Failed to persist schema scope failure metadata.",
                    Some(error.to_string()),
                )
            })?;

        Ok(())
    }

    pub fn load_schema_scope(
        &self,
        connection_id: &str,
        scope_path: Option<&str>,
    ) -> Result<CachedSchemaScopeRecord, AppError> {
        let connection = self.open()?;
        let persisted_scope_path = persist_scope_path(scope_path);

        let scope_row: Option<(String, String)> = connection
            .query_row(
                "select refreshed_at, refresh_status
                 from schema_cache_scopes
                 where connection_profile_id = ?1 and scope_path = ?2",
                params![connection_id, persisted_scope_path],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|error| {
                AppError::internal(
                    "schema_scope_read_failed",
                    "Failed to read schema scope metadata.",
                    Some(error.to_string()),
                )
            })?;

        let mut statement = connection
            .prepare(
                "select payload_json
                 from schema_cache
                 where connection_profile_id = ?1 and coalesce(parent_path, '') = ?2
                 order by position asc, lower(display_name) asc, id asc",
            )
            .map_err(|error| {
                AppError::internal(
                    "schema_cache_prepare_failed",
                    "Failed to prepare schema cache query.",
                    Some(error.to_string()),
                )
            })?;

        let rows = statement
            .query_map(params![connection_id, persisted_scope_path], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|error| {
                AppError::internal(
                    "schema_cache_query_failed",
                    "Failed to read cached schema nodes.",
                    Some(error.to_string()),
                )
            })?;

        let nodes = rows
            .map(|row| {
                let payload = row?;
                serde_json::from_str::<SchemaNode>(&payload).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        0,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })
            })
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| {
                AppError::internal(
                    "schema_cache_decode_failed",
                    "Failed to decode cached schema nodes.",
                    Some(error.to_string()),
                )
            })?;

        Ok(CachedSchemaScopeRecord {
            refreshed_at: scope_row
                .as_ref()
                .map(|(refreshed_at, _)| refreshed_at.clone()),
            refresh_status: scope_row
                .as_ref()
                .map(|(_, refresh_status)| refresh_status.clone()),
            nodes,
        })
    }

    pub fn search_schema_nodes(
        &self,
        connection_id: &str,
        query: &str,
        limit: usize,
    ) -> Result<Vec<SchemaNode>, AppError> {
        let connection = self.open()?;
        let mut statement = connection
            .prepare(
                "select payload_json
                 from schema_cache
                 where connection_profile_id = ?1
                   and (
                     lower(display_name) like ?2
                     or lower(object_path) like ?2
                   )
                 order by lower(display_name) asc, position asc, id asc
                 limit ?3",
            )
            .map_err(|error| {
                AppError::internal(
                    "schema_search_prepare_failed",
                    "Failed to prepare schema search query.",
                    Some(error.to_string()),
                )
            })?;

        let needle = format!("%{}%", query.trim().to_lowercase());
        let rows = statement
            .query_map(params![connection_id, needle, limit as i64], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|error| {
                AppError::internal(
                    "schema_search_query_failed",
                    "Failed to search cached schema nodes.",
                    Some(error.to_string()),
                )
            })?;

        rows.map(|row| {
            let payload = row.map_err(|error| {
                AppError::internal(
                    "schema_search_row_failed",
                    "Failed to read a schema search row.",
                    Some(error.to_string()),
                )
            })?;
            serde_json::from_str::<SchemaNode>(&payload).map_err(|error| {
                AppError::internal(
                    "schema_search_decode_failed",
                    "Failed to decode a cached schema search row.",
                    Some(error.to_string()),
                )
            })
        })
        .collect()
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn clear_schema_cache_for_connection(&self, connection_id: &str) -> Result<(), AppError> {
        let mut connection = self.open()?;
        let transaction = connection.transaction().map_err(|error| {
            AppError::internal(
                "schema_cache_clear_transaction_failed",
                "Failed to start schema cache clear transaction.",
                Some(error.to_string()),
            )
        })?;

        transaction
            .execute(
                "delete from schema_cache where connection_profile_id = ?1",
                params![connection_id],
            )
            .map_err(|error| {
                AppError::internal(
                    "schema_cache_clear_failed",
                    "Failed to clear cached schema nodes.",
                    Some(error.to_string()),
                )
            })?;
        transaction
            .execute(
                "delete from schema_cache_scopes where connection_profile_id = ?1",
                params![connection_id],
            )
            .map_err(|error| {
                AppError::internal(
                    "schema_scope_clear_failed",
                    "Failed to clear schema scope metadata.",
                    Some(error.to_string()),
                )
            })?;

        transaction.commit().map_err(|error| {
            AppError::internal(
                "schema_cache_clear_commit_failed",
                "Failed to commit schema cache clear operation.",
                Some(error.to_string()),
            )
        })?;

        Ok(())
    }

    pub fn create_query_result_set(
        &self,
        record: CreateQueryResultSetRecord,
    ) -> Result<QueryResultSetRecord, AppError> {
        let connection = self.open()?;
        let columns_json = serde_json::to_string(&record.columns).map_err(|error| {
            AppError::internal(
                "query_result_columns_serialize_failed",
                "Failed to serialize query result columns.",
                Some(error.to_string()),
            )
        })?;

        connection
            .execute(
                "insert into query_result_sets (
                    result_set_id,
                    job_id,
                    tab_id,
                    connection_profile_id,
                    sql,
                    columns_json,
                    buffered_row_count,
                    total_row_count,
                    status,
                    created_at,
                    completed_at,
                    last_error_json
                 ) values (?1, ?2, ?3, ?4, ?5, ?6, 0, null, 'running', ?7, null, null)",
                params![
                    record.result_set_id,
                    record.job_id,
                    record.tab_id,
                    record.connection_id,
                    record.sql,
                    columns_json,
                    record.created_at,
                ],
            )
            .map_err(|error| {
                AppError::internal(
                    "query_result_set_insert_failed",
                    "Failed to create query result metadata.",
                    Some(error.to_string()),
                )
            })?;

        self.load_query_result_set(&record.result_set_id)?.ok_or_else(|| {
            AppError::internal(
                "query_result_set_missing_after_create",
                "The query result metadata could not be reloaded after creation.",
                Some(record.result_set_id),
            )
        })
    }

    pub fn append_query_result_rows(
        &self,
        record: AppendQueryResultRowsRecord,
    ) -> Result<(), AppError> {
        let mut connection = self.open()?;
        let transaction = connection.transaction().map_err(|error| {
            AppError::internal(
                "query_result_rows_transaction_failed",
                "Failed to start a query result cache transaction.",
                Some(error.to_string()),
            )
        })?;

        for (offset, row) in record.rows.iter().enumerate() {
            let row_json = serde_json::to_string(row).map_err(|error| {
                AppError::internal(
                    "query_result_row_serialize_failed",
                    "Failed to serialize a cached query result row.",
                    Some(error.to_string()),
                )
            })?;
            transaction
                .execute(
                    "insert into query_result_rows (result_set_id, row_index, row_json)
                     values (?1, ?2, ?3)",
                    params![
                        &record.result_set_id,
                        (record.starting_row_index + offset) as i64,
                        row_json,
                    ],
                )
                .map_err(|error| {
                    AppError::internal(
                        "query_result_row_insert_failed",
                        "Failed to write cached query result rows.",
                        Some(error.to_string()),
                    )
                })?;
        }

        transaction
            .execute(
                "update query_result_sets
                 set buffered_row_count = ?2
                 where result_set_id = ?1",
                params![&record.result_set_id, record.buffered_row_count as i64],
            )
            .map_err(|error| {
                AppError::internal(
                    "query_result_set_buffer_update_failed",
                    "Failed to update buffered query result counts.",
                    Some(error.to_string()),
                )
            })?;

        transaction.commit().map_err(|error| {
            AppError::internal(
                "query_result_rows_commit_failed",
                "Failed to commit cached query result rows.",
                Some(error.to_string()),
            )
        })?;

        Ok(())
    }

    pub fn finalize_query_result_set(
        &self,
        record: FinalizeQueryResultSetRecord,
    ) -> Result<(), AppError> {
        let connection = self.open()?;
        let last_error_json = record
            .last_error
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|error| {
                AppError::internal(
                    "query_result_error_serialize_failed",
                    "Failed to serialize query result failure metadata.",
                    Some(error.to_string()),
                )
            })?;

        connection
            .execute(
                "update query_result_sets
                 set buffered_row_count = ?2,
                     total_row_count = ?3,
                     status = ?4,
                     completed_at = ?5,
                     last_error_json = ?6
                 where result_set_id = ?1",
                params![
                    record.result_set_id,
                    record.buffered_row_count as i64,
                    record.total_row_count.map(|value| value as i64),
                    query_result_set_status_as_str(record.status),
                    record.completed_at,
                    last_error_json,
                ],
            )
            .map_err(|error| {
                AppError::internal(
                    "query_result_set_finalize_failed",
                    "Failed to finalize cached query result metadata.",
                    Some(error.to_string()),
                )
            })?;

        Ok(())
    }

    pub fn load_query_result_set(
        &self,
        result_set_id: &str,
    ) -> Result<Option<QueryResultSetRecord>, AppError> {
        let connection = self.open()?;
        connection
            .query_row(
                "select
                    result_set_id,
                    job_id,
                    tab_id,
                    connection_profile_id,
                    sql,
                    columns_json,
                    buffered_row_count,
                    total_row_count,
                    status,
                    created_at,
                    completed_at,
                    last_error_json
                 from query_result_sets
                 where result_set_id = ?1",
                params![result_set_id],
                Self::read_query_result_set,
            )
            .optional()
            .map_err(|error| {
                AppError::internal(
                    "query_result_set_read_failed",
                    "Failed to read cached query result metadata.",
                    Some(error.to_string()),
                )
            })
    }

    pub fn delete_query_result_set(&self, result_set_id: &str) -> Result<(), AppError> {
        let mut connection = self.open()?;
        let transaction = connection.transaction().map_err(|error| {
            AppError::internal(
                "query_result_delete_transaction_failed",
                "Failed to start a query result delete transaction.",
                Some(error.to_string()),
            )
        })?;

        transaction
            .execute(
                "delete from query_result_rows where result_set_id = ?1",
                params![result_set_id],
            )
            .map_err(|error| {
                AppError::internal(
                    "query_result_rows_delete_failed",
                    "Failed to delete cached query result rows.",
                    Some(error.to_string()),
                )
            })?;

        transaction
            .execute(
                "delete from query_result_sets where result_set_id = ?1",
                params![result_set_id],
            )
            .map_err(|error| {
                AppError::internal(
                    "query_result_set_delete_failed",
                    "Failed to delete cached query result metadata.",
                    Some(error.to_string()),
                )
            })?;

        transaction.commit().map_err(|error| {
            AppError::internal(
                "query_result_delete_commit_failed",
                "Failed to commit query result deletion.",
                Some(error.to_string()),
            )
        })?;

        Ok(())
    }

    pub fn delete_query_result_sets_for_tab(&self, tab_id: &str) -> Result<(), AppError> {
        let connection = self.open()?;
        let mut statement = connection
            .prepare("select result_set_id from query_result_sets where tab_id = ?1")
            .map_err(|error| {
                AppError::internal(
                    "query_result_tab_prepare_failed",
                    "Failed to prepare query result lookup for a tab.",
                    Some(error.to_string()),
                )
            })?;

        let result_set_ids = statement
            .query_map(params![tab_id], |row| row.get::<_, String>(0))
            .map_err(|error| {
                AppError::internal(
                    "query_result_tab_query_failed",
                    "Failed to load cached query results for a tab.",
                    Some(error.to_string()),
                )
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| {
                AppError::internal(
                    "query_result_tab_row_failed",
                    "Failed to decode a cached query result id.",
                    Some(error.to_string()),
                )
            })?;

        for result_set_id in result_set_ids {
            self.delete_query_result_set(&result_set_id)?;
        }

        Ok(())
    }

    pub fn purge_query_result_cache(&self) -> Result<(), AppError> {
        let mut connection = self.open()?;
        let transaction = connection.transaction().map_err(|error| {
            AppError::internal(
                "query_result_purge_transaction_failed",
                "Failed to start a query result purge transaction.",
                Some(error.to_string()),
            )
        })?;

        transaction
            .execute("delete from query_result_rows", [])
            .map_err(|error| {
                AppError::internal(
                    "query_result_rows_purge_failed",
                    "Failed to purge cached query result rows.",
                    Some(error.to_string()),
                )
            })?;
        transaction
            .execute("delete from query_result_sets", [])
            .map_err(|error| {
                AppError::internal(
                    "query_result_sets_purge_failed",
                    "Failed to purge cached query result metadata.",
                    Some(error.to_string()),
                )
            })?;

        transaction.commit().map_err(|error| {
            AppError::internal(
                "query_result_purge_commit_failed",
                "Failed to commit query result purge.",
                Some(error.to_string()),
            )
        })?;

        Ok(())
    }

    pub fn load_query_result_window(
        &self,
        request: &QueryResultWindowRequest,
    ) -> Result<QueryResultWindow, AppError> {
        let connection = self.open()?;
        let result_set = self
            .load_query_result_set(&request.result_set_id)?
            .ok_or_else(|| {
                AppError::retryable(
                    "query_result_set_missing",
                    "The requested cached result set no longer exists.",
                    Some(request.result_set_id.clone()),
                )
            })?;

        let (where_sql, where_params) =
            build_query_result_filter_clause(&result_set.columns, &request.quick_filter, &request.filters);
        let count_sql = format!(
            "select count(*) from query_result_rows where result_set_id = ?{where_sql}"
        );

        let mut count_params = vec![rusqlite::types::Value::from(request.result_set_id.clone())];
        count_params.extend(where_params.clone());
        let visible_row_count: i64 = connection
            .query_row(&count_sql, params_from_iter(count_params), |row| row.get(0))
            .map_err(|error| {
                AppError::internal(
                    "query_result_window_count_failed",
                    "Failed to count cached query result rows.",
                    Some(error.to_string()),
                )
            })?;

        let order_sql = build_query_result_order_clause(&result_set.columns, request.sort.as_ref());
        let window_sql = format!(
            "select row_json
             from query_result_rows
             where result_set_id = ?{where_sql}
             {order_sql}
             limit ? offset ?"
        );
        let mut window_params = vec![rusqlite::types::Value::from(request.result_set_id.clone())];
        window_params.extend(where_params);
        window_params.push(rusqlite::types::Value::from(request.limit as i64));
        window_params.push(rusqlite::types::Value::from(request.offset as i64));

        let mut statement = connection.prepare(&window_sql).map_err(|error| {
            AppError::internal(
                "query_result_window_prepare_failed",
                "Failed to prepare the cached result window query.",
                Some(error.to_string()),
            )
        })?;

        let rows = statement
            .query_map(params_from_iter(window_params), |row| row.get::<_, String>(0))
            .map_err(|error| {
                AppError::internal(
                    "query_result_window_query_failed",
                    "Failed to read cached query result rows.",
                    Some(error.to_string()),
                )
            })?
            .map(|row| {
                let payload = row?;
                serde_json::from_str::<Vec<QueryResultCell>>(&payload).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        0,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })
            })
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| {
                AppError::internal(
                    "query_result_window_decode_failed",
                    "Failed to decode cached query result rows.",
                    Some(error.to_string()),
                )
            })?;

        Ok(QueryResultWindow {
            result_set_id: result_set.result_set_id,
            offset: request.offset,
            limit: request.limit,
            rows,
            visible_row_count: visible_row_count as usize,
            buffered_row_count: result_set.buffered_row_count,
            total_row_count: result_set.total_row_count,
            is_complete: result_set.status == QueryResultSetStatus::Completed,
            sort: request.sort.clone(),
            filters: request.filters.clone(),
            quick_filter: request.quick_filter.clone(),
        })
    }

    fn read_query_result_set(row: &rusqlite::Row<'_>) -> rusqlite::Result<QueryResultSetRecord> {
        let columns_json: String = row.get(5)?;
        let status_text: String = row.get(8)?;
        let last_error_json: Option<String> = row.get(11)?;
        let columns = serde_json::from_str::<Vec<QueryResultColumn>>(&columns_json).map_err(
            |error| {
                rusqlite::Error::FromSqlConversionFailure(
                    5,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            },
        )?;
        let status = query_result_set_status_from_str(&status_text).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                8,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
            )
        })?;
        let last_error = last_error_json
            .as_deref()
            .map(serde_json::from_str::<AppError>)
            .transpose()
            .map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    11,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?;

        Ok(QueryResultSetRecord {
            result_set_id: row.get(0)?,
            job_id: row.get(1)?,
            tab_id: row.get(2)?,
            connection_id: row.get(3)?,
            sql: row.get(4)?,
            columns,
            buffered_row_count: row.get::<_, i64>(6)? as usize,
            total_row_count: row.get::<_, Option<i64>>(7)?.map(|value| value as usize),
            status,
            created_at: row.get(9)?,
            completed_at: row.get(10)?,
            last_error,
        })
    }

    fn read_saved_connection(row: &rusqlite::Row<'_>) -> rusqlite::Result<SavedConnectionRecord> {
        let secret_ref_json: Option<String> = row.get(8)?;
        let ssl_mode_text: String = row.get(7)?;
        let ssl_mode = SslMode::from_str(&ssl_mode_text).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                7,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
            )
        })?;

        let secret_ref = secret_ref_json
            .as_deref()
            .map(serde_json::from_str::<PersistedSecretRef>)
            .transpose()
            .map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    8,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?;

        Ok(SavedConnectionRecord {
            id: row.get(0)?,
            engine: row.get(1)?,
            name: row.get(2)?,
            host: row.get(3)?,
            port: row.get::<_, i64>(4)? as u16,
            database: row.get(5)?,
            username: row.get(6)?,
            ssl_mode,
            secret_ref,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
            last_tested_at: row.get(11)?,
            last_connected_at: row.get(12)?,
        })
    }

    fn update_saved_connection_timestamp(
        &self,
        column: &str,
        id: &str,
        value: &str,
    ) -> Result<(), AppError> {
        let connection = self.open()?;
        let statement = format!(
            "update saved_connections set {column} = ?1, updated_at = datetime('now') where id = ?2"
        );

        connection
            .execute(&statement, params![value, id])
            .map_err(|error| {
                AppError::internal(
                    "saved_connection_timestamp_update_failed",
                    "Failed to update saved connection metadata.",
                    Some(error.to_string()),
                )
            })?;

        Ok(())
    }

    fn load_setting(&self, key: &str) -> Result<Option<String>, AppError> {
        let connection = self.open()?;
        connection
            .query_row(
                "select value from app_settings where key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| {
                AppError::internal(
                    "app_setting_read_failed",
                    "Failed to read an app setting.",
                    Some(error.to_string()),
                )
            })
    }

    fn save_setting(&self, key: &str, value: &str) -> Result<(), AppError> {
        let connection = self.open()?;
        connection
            .execute(
                "insert into app_settings (key, value, updated_at) values (?1, ?2, datetime('now'))
                 on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at",
                params![key, value],
            )
            .map_err(|error| {
                AppError::internal(
                    "app_setting_upsert_failed",
                    "Failed to save an app setting.",
                    Some(error.to_string()),
                )
            })?;

        Ok(())
    }

    fn delete_setting(&self, key: &str) -> Result<(), AppError> {
        let connection = self.open()?;
        connection
            .execute("delete from app_settings where key = ?1", params![key])
            .map_err(|error| {
                AppError::internal(
                    "app_setting_delete_failed",
                    "Failed to delete an app setting.",
                    Some(error.to_string()),
                )
            })?;

        Ok(())
    }

    fn apply_migrations(&self) -> Result<(), AppError> {
        let connection = self.open()?;
        connection
            .execute_batch(
                "create table if not exists migration_state (
                    version text primary key,
                    applied_at text not null
                );",
            )
            .map_err(|error| {
                AppError::internal(
                    "migration_table_failed",
                    "Failed to create the migration state table.",
                    Some(error.to_string()),
                )
            })?;

        for (version, sql) in MIGRATIONS {
            let already_applied: bool = connection
                .query_row(
                    "select exists(select 1 from migration_state where version = ?1)",
                    params![version],
                    |row| row.get(0),
                )
                .map_err(|error| {
                    AppError::internal(
                        "migration_lookup_failed",
                        "Failed to inspect migration state.",
                        Some(error.to_string()),
                    )
                })?;

            if already_applied {
                continue;
            }

            connection.execute_batch(sql).map_err(|error| {
                AppError::internal(
                    "migration_apply_failed",
                    "Failed to apply a SQLite migration.",
                    Some(error.to_string()),
                )
            })?;

            connection
                .execute(
                    "insert into migration_state (version, applied_at) values (?1, datetime('now'))",
                    params![version],
                )
                .map_err(|error| {
                    AppError::internal(
                        "migration_record_failed",
                        "Failed to record migration state.",
                        Some(error.to_string()),
                    )
                })?;
        }

        Ok(())
    }

    fn count_rows(&self, connection: &Connection, table: &str) -> Result<usize, AppError> {
        let query = format!("select count(*) from {table}");
        let count: i64 = connection
            .query_row(&query, [], |row| row.get(0))
            .map_err(|error| {
                AppError::internal(
                    "count_rows_failed",
                    "Failed to count repository rows.",
                    Some(error.to_string()),
                )
            })?;

        Ok(count as usize)
    }

    fn open(&self) -> Result<Connection, AppError> {
        ensure_parent_directory(&self.database_path)?;

        Connection::open(&self.database_path).map_err(|error| {
            AppError::internal(
                "sqlite_open_failed",
                "Failed to open the local SQLite store.",
                Some(error.to_string()),
            )
        })
    }
}

impl SaveConnectionRecord {
    fn engine_or_default(&self) -> &str {
        "postgresql"
    }
}

trait SchemaNodePersistenceExt {
    fn kind_name(&self) -> &'static str;
}

impl SchemaNodePersistenceExt for SchemaNode {
    fn kind_name(&self) -> &'static str {
        match self.kind() {
            crate::foundation::SchemaNodeKind::Schema => "schema",
            crate::foundation::SchemaNodeKind::Table => "table",
            crate::foundation::SchemaNodeKind::View => "view",
            crate::foundation::SchemaNodeKind::Column => "column",
            crate::foundation::SchemaNodeKind::Index => "index",
        }
    }
}

fn persist_scope_path(scope_path: Option<&str>) -> &str {
    scope_path.unwrap_or(ROOT_SCOPE_PATH)
}

fn schema_scope_kind_as_str(value: SchemaScopeKind) -> &'static str {
    match value {
        SchemaScopeKind::Root => "root",
        SchemaScopeKind::Schema => "schema",
        SchemaScopeKind::Table => "table",
        SchemaScopeKind::View => "view",
    }
}

fn query_result_set_status_as_str(value: QueryResultSetStatus) -> &'static str {
    match value {
        QueryResultSetStatus::Running => "running",
        QueryResultSetStatus::Completed => "completed",
        QueryResultSetStatus::Cancelled => "cancelled",
        QueryResultSetStatus::Failed => "failed",
    }
}

fn query_result_set_status_from_str(value: &str) -> Result<QueryResultSetStatus, String> {
    match value {
        "running" => Ok(QueryResultSetStatus::Running),
        "completed" => Ok(QueryResultSetStatus::Completed),
        "cancelled" => Ok(QueryResultSetStatus::Cancelled),
        "failed" => Ok(QueryResultSetStatus::Failed),
        other => Err(format!("Unsupported query result status '{other}'.")),
    }
}

fn build_query_result_filter_clause(
    columns: &[QueryResultColumn],
    quick_filter: &str,
    filters: &[QueryResultFilter],
) -> (String, Vec<rusqlite::types::Value>) {
    let mut clauses = Vec::new();
    let mut values = Vec::new();

    if !quick_filter.trim().is_empty() && !columns.is_empty() {
        let normalized = format!("%{}%", quick_filter.trim().to_lowercase());
        let expressions = columns
            .iter()
            .enumerate()
            .map(|(index, _)| {
                format!(
                    "coalesce(lower(cast(json_extract(row_json, '$[{index}]') as text)), '') like ?"
                )
            })
            .collect::<Vec<_>>();
        clauses.push(format!(" and ({})", expressions.join(" or ")));
        for _ in 0..columns.len() {
            values.push(rusqlite::types::Value::from(normalized.clone()));
        }
    }

    for filter in filters {
        if !filter.value.trim().is_empty() {
            let path = format!("$[{}]", filter.column_index);
            let clause = match filter.mode {
                QueryResultFilterMode::Contains => {
                    " and coalesce(lower(cast(json_extract(row_json, ? ) as text)), '') like ?"
                }
            };
            clauses.push(clause.to_string());
            values.push(rusqlite::types::Value::from(path));
            values.push(rusqlite::types::Value::from(format!(
                "%{}%",
                filter.value.trim().to_lowercase()
            )));
        }
    }

    (clauses.join(""), values)
}

fn build_query_result_order_clause(
    columns: &[QueryResultColumn],
    sort: Option<&QueryResultSort>,
) -> String {
    let Some(sort) = sort else {
        return "order by row_index asc".to_string();
    };

    let Some(column) = columns.get(sort.column_index) else {
        return "order by row_index asc".to_string();
    };

    let direction = match sort.direction {
        QueryResultSortDirection::Asc => "asc",
        QueryResultSortDirection::Desc => "desc",
    };
    let path = format!("$[{}]", sort.column_index);
    let value_expression = match column.semantic_type {
        crate::foundation::QueryResultColumnSemanticType::Number => {
            format!("cast(json_extract(row_json, '{path}') as real)")
        }
        crate::foundation::QueryResultColumnSemanticType::Boolean => {
            format!("cast(json_extract(row_json, '{path}') as integer)")
        }
        _ => format!("lower(cast(json_extract(row_json, '{path}') as text))"),
    };

    format!("order by {value_expression} {direction}, row_index asc")
}

#[cfg(test)]
mod tests {
    use super::{PersistedSecretRef, ReplaceSchemaScopeRecord, Repository, SaveConnectionRecord};
    use crate::foundation::{SchemaNode, SchemaNodeBase, SchemaScopeKind, SecretProvider, SslMode};

    fn test_database_path(name: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join("sparow-phase2-tests");
        std::fs::create_dir_all(&root).expect("failed to create test directory");
        root.join(name)
    }

    #[test]
    fn applies_migrations_and_counts_seed_data() {
        let database_path = test_database_path("foundation-counts.sqlite3");
        let _ = std::fs::remove_file(&database_path);
        let repository = Repository::new(database_path).expect("repository should initialize");
        repository.seed_phase_one().expect("seed should succeed");

        let counts = repository.sample_counts().expect("counts should load");
        assert!(counts.history_entries >= 1);
    }

    #[test]
    fn records_history_entries() {
        let database_path = test_database_path("history-roundtrip.sqlite3");
        let _ = std::fs::remove_file(&database_path);
        let repository = Repository::new(database_path).expect("repository should initialize");
        repository
            .record_history("select 'roundtrip';".to_string())
            .expect("history insert should succeed");

        let counts = repository.sample_counts().expect("counts should load");
        assert_eq!(counts.history_entries, 1);
    }

    #[test]
    fn saves_and_loads_connections_with_secret_refs() {
        let database_path = test_database_path("saved-connections.sqlite3");
        let _ = std::fs::remove_file(&database_path);
        let repository = Repository::new(database_path).expect("repository should initialize");

        let saved = repository
            .save_connection(SaveConnectionRecord {
                id: None,
                name: "Local".to_string(),
                host: "127.0.0.1".to_string(),
                port: 5432,
                database: "app_dev".to_string(),
                username: "sparow".to_string(),
                ssl_mode: SslMode::Prefer,
                secret_ref: Some(PersistedSecretRef {
                    provider: SecretProvider::Memory,
                    service: "sparow.tests".to_string(),
                    account: "conn-1".to_string(),
                }),
            })
            .expect("save should succeed");

        let loaded = repository
            .get_saved_connection(&saved.id)
            .expect("load should succeed")
            .expect("saved connection should exist");

        assert_eq!(loaded.database, "app_dev");
        assert_eq!(loaded.secret_ref, saved.secret_ref);
        assert_eq!(
            repository
                .list_saved_connections()
                .expect("list should succeed")
                .len(),
            1
        );
    }

    #[test]
    fn persists_selected_connection_id() {
        let database_path = test_database_path("selected-connection.sqlite3");
        let _ = std::fs::remove_file(&database_path);
        let repository = Repository::new(database_path).expect("repository should initialize");

        repository
            .save_selected_connection_id(Some("conn-123"))
            .expect("save should succeed");
        assert_eq!(
            repository
                .load_selected_connection_id()
                .expect("load should succeed")
                .as_deref(),
            Some("conn-123")
        );

        repository
            .save_selected_connection_id(None)
            .expect("delete should succeed");
        assert_eq!(
            repository
                .load_selected_connection_id()
                .expect("load should succeed"),
            None
        );
    }

    #[test]
    fn replaces_and_loads_schema_scope_rows() {
        let database_path = test_database_path("schema-cache-scope.sqlite3");
        let _ = std::fs::remove_file(&database_path);
        let repository = Repository::new(database_path).expect("repository should initialize");

        let replaced = repository
            .replace_schema_scope(ReplaceSchemaScopeRecord {
                connection_id: "conn-1".to_string(),
                scope_kind: SchemaScopeKind::Schema,
                scope_path: Some("schema/public".to_string()),
                refreshed_at: "2026-03-09T18:15:00.000Z".to_string(),
                refresh_status: "fresh".to_string(),
                nodes: vec![SchemaNode::Table {
                    base: SchemaNodeBase {
                        id: "table/public/users".to_string(),
                        connection_id: "conn-1".to_string(),
                        name: "users".to_string(),
                        path: "table/public/users".to_string(),
                        parent_path: Some("schema/public".to_string()),
                        schema_name: "public".to_string(),
                        relation_name: Some("users".to_string()),
                        has_children: true,
                        refreshed_at: "2026-03-09T18:15:00.000Z".to_string(),
                    },
                }],
            })
            .expect("schema scope should replace");

        assert_eq!(replaced.nodes.len(), 1);
        assert_eq!(
            replaced.refreshed_at.as_deref(),
            Some("2026-03-09T18:15:00.000Z")
        );
        assert_eq!(replaced.refresh_status.as_deref(), Some("fresh"));
    }

    #[test]
    fn loads_failed_schema_scope_metadata_for_empty_scope() {
        let database_path = test_database_path("schema-cache-failure.sqlite3");
        let _ = std::fs::remove_file(&database_path);
        let repository = Repository::new(database_path).expect("repository should initialize");

        repository
            .record_schema_scope_failure(
                "conn-1",
                SchemaScopeKind::Table,
                Some("table/public/users"),
                "2026-03-09T18:15:00.000Z",
            )
            .expect("failure metadata should store");

        let loaded = repository
            .load_schema_scope("conn-1", Some("table/public/users"))
            .expect("schema scope should load");

        assert_eq!(
            loaded.refreshed_at.as_deref(),
            Some("2026-03-09T18:15:00.000Z")
        );
        assert_eq!(loaded.refresh_status.as_deref(), Some("failed"));
        assert!(loaded.nodes.is_empty());
    }

    #[test]
    fn searches_schema_nodes_per_connection() {
        let database_path = test_database_path("schema-cache-search.sqlite3");
        let _ = std::fs::remove_file(&database_path);
        let repository = Repository::new(database_path).expect("repository should initialize");

        repository
            .replace_schema_scope(sample_schema_scope("conn-1"))
            .expect("scope should store");
        repository
            .replace_schema_scope(sample_schema_scope("conn-2"))
            .expect("scope should store");

        let results = repository
            .search_schema_nodes("conn-1", "email", 10)
            .expect("search should succeed");

        assert_eq!(results.len(), 1);
        match &results[0] {
            SchemaNode::Column { base, .. } => assert_eq!(base.connection_id, "conn-1"),
            other => panic!("expected column node, got {other:?}"),
        }
    }

    #[test]
    fn clears_schema_cache_for_one_connection() {
        let database_path = test_database_path("schema-cache-clear.sqlite3");
        let _ = std::fs::remove_file(&database_path);
        let repository = Repository::new(database_path).expect("repository should initialize");

        repository
            .replace_schema_scope(sample_schema_scope("conn-1"))
            .expect("scope should store");
        repository
            .replace_schema_scope(sample_schema_scope("conn-2"))
            .expect("scope should store");

        repository
            .clear_schema_cache_for_connection("conn-1")
            .expect("clear should succeed");

        let conn1 = repository
            .load_schema_scope("conn-1", Some("table/public/users"))
            .expect("conn1 scope should load");
        let conn2 = repository
            .load_schema_scope("conn-2", Some("table/public/users"))
            .expect("conn2 scope should load");

        assert!(conn1.nodes.is_empty());
        assert_eq!(conn2.nodes.len(), 1);
    }

    #[test]
    fn replaces_schema_scope_by_clearing_descendant_cache_rows() {
        let database_path = test_database_path("schema-cache-subtree.sqlite3");
        let _ = std::fs::remove_file(&database_path);
        let repository = Repository::new(database_path).expect("repository should initialize");

        repository
            .replace_schema_scope(ReplaceSchemaScopeRecord {
                connection_id: "conn-1".to_string(),
                scope_kind: SchemaScopeKind::Schema,
                scope_path: Some("schema/public".to_string()),
                refreshed_at: "2026-03-09T18:15:00.000Z".to_string(),
                refresh_status: "fresh".to_string(),
                nodes: vec![SchemaNode::Table {
                    base: SchemaNodeBase {
                        id: "table/public/users".to_string(),
                        connection_id: "conn-1".to_string(),
                        name: "users".to_string(),
                        path: "table/public/users".to_string(),
                        parent_path: Some("schema/public".to_string()),
                        schema_name: "public".to_string(),
                        relation_name: Some("users".to_string()),
                        has_children: true,
                        refreshed_at: "2026-03-09T18:15:00.000Z".to_string(),
                    },
                }],
            })
            .expect("schema scope should store");

        repository
            .replace_schema_scope(sample_schema_scope("conn-1"))
            .expect("table scope should store");

        repository
            .replace_schema_scope(ReplaceSchemaScopeRecord {
                connection_id: "conn-1".to_string(),
                scope_kind: SchemaScopeKind::Schema,
                scope_path: Some("schema/public".to_string()),
                refreshed_at: "2026-03-09T18:30:00.000Z".to_string(),
                refresh_status: "fresh".to_string(),
                nodes: Vec::new(),
            })
            .expect("schema scope replacement should clear descendants");

        let table_scope = repository
            .load_schema_scope("conn-1", Some("table/public/users"))
            .expect("descendant scope should load after replacement");
        let search_results = repository
            .search_schema_nodes("conn-1", "email", 10)
            .expect("search should succeed");

        assert!(table_scope.nodes.is_empty());
        assert!(table_scope.refreshed_at.is_none());
        assert!(table_scope.refresh_status.is_none());
        assert!(search_results.is_empty());
    }

    fn sample_schema_scope(connection_id: &str) -> ReplaceSchemaScopeRecord {
        ReplaceSchemaScopeRecord {
            connection_id: connection_id.to_string(),
            scope_kind: SchemaScopeKind::Table,
            scope_path: Some("table/public/users".to_string()),
            refreshed_at: "2026-03-09T18:15:00.000Z".to_string(),
            refresh_status: "fresh".to_string(),
            nodes: vec![SchemaNode::Column {
                base: SchemaNodeBase {
                    id: format!("column/public/users/email/{connection_id}"),
                    connection_id: connection_id.to_string(),
                    name: "email".to_string(),
                    path: format!("column/public/users/email/{connection_id}"),
                    parent_path: Some("table/public/users".to_string()),
                    schema_name: "public".to_string(),
                    relation_name: Some("users".to_string()),
                    has_children: false,
                    refreshed_at: "2026-03-09T18:15:00.000Z".to_string(),
                },
                data_type: "text".to_string(),
                is_nullable: false,
                ordinal_position: 3,
            }],
        }
    }
}
