use std::path::PathBuf;

use rusqlite::{params, Connection};

use crate::foundation::{ensure_parent_directory, AppError};

const MIGRATION_0001: &str = include_str!("migrations/0001_init.sql");

#[derive(Debug, Clone, Copy)]
pub struct SampleCounts {
    pub history_entries: usize,
    pub saved_queries: usize,
    pub schema_cache_entries: usize,
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
        let connection = self.open()?;
        connection
            .execute(
                "insert into query_history (id, sql, connection_profile_id, created_at) values (?1, ?2, ?3, datetime('now'))",
                params![uuid::Uuid::new_v4().to_string(), sql, Option::<String>::None],
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

    fn apply_migrations(&self) -> Result<(), AppError> {
        let connection = self.open()?;
        connection.execute_batch(
            "create table if not exists migration_state (
                version text primary key,
                applied_at text not null
            );",
        ).map_err(|error| AppError::internal("migration_table_failed", "Failed to create the migration state table.", Some(error.to_string())))?;

        let already_applied: bool = connection
            .query_row(
                "select exists(select 1 from migration_state where version = ?1)",
                params!["0001_init"],
                |row| row.get(0),
            )
            .map_err(|error| {
                AppError::internal(
                    "migration_lookup_failed",
                    "Failed to inspect migration state.",
                    Some(error.to_string()),
                )
            })?;

        if !already_applied {
            connection
                .execute_batch(MIGRATION_0001)
                .map_err(|error| {
                    AppError::internal(
                        "migration_apply_failed",
                        "Failed to apply the initial SQLite migration.",
                        Some(error.to_string()),
                    )
                })?;

            connection
                .execute(
                    "insert into migration_state (version, applied_at) values (?1, datetime('now'))",
                    params!["0001_init"],
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
        let count: i64 = connection.query_row(&query, [], |row| row.get(0)).map_err(|error| {
            AppError::internal("count_rows_failed", "Failed to count repository rows.", Some(error.to_string()))
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

#[cfg(test)]
mod tests {
    use super::Repository;

    fn test_database_path(name: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join("sparow-phase1-tests");
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
        repository.record_history("select 'roundtrip';".to_string()).expect("history insert should succeed");

        let counts = repository.sample_counts().expect("counts should load");
        assert_eq!(counts.history_entries, 1);
    }
}
