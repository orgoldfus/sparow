use std::sync::Arc;

use tokio::task;

use crate::{
    foundation::{
        AppError, DeleteSavedQueryResult, DiagnosticsStore, ListQueryHistoryRequest,
        ListQueryHistoryResult, ListSavedQueriesRequest, ListSavedQueriesResult,
        SaveSavedQueryRequest, SavedQuery,
    },
    persistence::{Repository, SaveSavedQueryRecord},
};

#[derive(Clone)]
pub(crate) struct ProductivityService {
    repository: Arc<Repository>,
    diagnostics: DiagnosticsStore,
}

impl ProductivityService {
    pub(crate) fn new(repository: Arc<Repository>, diagnostics: DiagnosticsStore) -> Self {
        Self {
            repository,
            diagnostics,
        }
    }

    pub(crate) async fn list_query_history(
        &self,
        request: ListQueryHistoryRequest,
    ) -> Result<ListQueryHistoryResult, AppError> {
        if request.limit == 0 {
            return Err(AppError::internal(
                "query_history_invalid_limit",
                "Query history requests must ask for at least one row.",
                None,
            ));
        }

        let repository = self.repository.clone();
        let search_query = request.search_query.clone();
        let connection_id = request.connection_id.clone();
        let offset = request.offset;
        let limit = request.limit;
        let mut entries = task::spawn_blocking(move || {
            repository.list_query_history(
                &search_query,
                connection_id.as_deref(),
                limit + 1,
                offset,
            )
        })
        .await
        .map_err(|error| {
            AppError::internal(
                "query_history_join_failed",
                "Failed to join the query-history task.",
                Some(error.to_string()),
            )
        })??;

        let has_more = entries.len() > limit;
        entries.truncate(limit);

        Ok(ListQueryHistoryResult { entries, has_more })
    }

    pub(crate) async fn list_saved_queries(
        &self,
        request: ListSavedQueriesRequest,
    ) -> Result<ListSavedQueriesResult, AppError> {
        if request.limit == 0 {
            return Err(AppError::internal(
                "saved_queries_invalid_limit",
                "Saved-query requests must ask for at least one row.",
                None,
            ));
        }

        let repository = self.repository.clone();
        let search_query = request.search_query.clone();
        let connection_id = request.connection_id.clone();
        let offset = request.offset;
        let limit = request.limit;
        let mut entries = task::spawn_blocking(move || {
            repository.list_saved_queries(
                &search_query,
                connection_id.as_deref(),
                limit + 1,
                offset,
            )
        })
        .await
        .map_err(|error| {
            AppError::internal(
                "saved_queries_join_failed",
                "Failed to join the saved-query task.",
                Some(error.to_string()),
            )
        })??;

        let has_more = entries.len() > limit;
        entries.truncate(limit);

        Ok(ListSavedQueriesResult { entries, has_more })
    }

    pub(crate) async fn save_saved_query(
        &self,
        request: SaveSavedQueryRequest,
    ) -> Result<SavedQuery, AppError> {
        let title = request.title.trim().to_string();
        if title.is_empty() {
            return Err(AppError::internal(
                "saved_query_empty_title",
                "Saved queries require a title.",
                None,
            ));
        }

        let sql = request.sql.trim().to_string();
        if sql.is_empty() {
            return Err(AppError::internal(
                "saved_query_empty_sql",
                "Saved queries require SQL text.",
                None,
            ));
        }

        let connection_profile_id = normalize_optional_string(request.connection_profile_id);
        if let Some(connection_id) = connection_profile_id.as_deref() {
            self.ensure_connection_exists(connection_id).await?;
        }

        if let Some(saved_query_id) = request.id.as_deref() {
            self.ensure_saved_query_exists(saved_query_id).await?;
        }

        let repository = self.repository.clone();
        let saved_query = task::spawn_blocking(move || {
            repository.save_saved_query(SaveSavedQueryRecord {
                id: request.id,
                title,
                sql,
                tags: normalize_tags(request.tags),
                connection_profile_id,
            })
        })
        .await
        .map_err(|error| {
            AppError::internal(
                "saved_query_join_failed",
                "Failed to join the saved-query save task.",
                Some(error.to_string()),
            )
        })??;

        Ok(saved_query)
    }

    pub(crate) async fn delete_saved_query(
        &self,
        id: String,
    ) -> Result<DeleteSavedQueryResult, AppError> {
        self.ensure_saved_query_exists(&id).await?;

        let repository = self.repository.clone();
        let deleted = task::spawn_blocking({
            let id = id.clone();
            move || repository.delete_saved_query(&id)
        })
        .await
        .map_err(|error| {
            AppError::internal(
                "saved_query_delete_join_failed",
                "Failed to join the saved-query delete task.",
                Some(error.to_string()),
            )
        })??;

        if !deleted {
            return Err(AppError::internal(
                "saved_query_missing",
                "The saved query no longer exists.",
                Some(id),
            ));
        }

        Ok(DeleteSavedQueryResult { id })
    }

    async fn ensure_connection_exists(&self, id: &str) -> Result<(), AppError> {
        let repository = self.repository.clone();
        let connection_id = id.to_string();
        let exists = task::spawn_blocking(move || repository.get_saved_connection(&connection_id))
            .await
            .map_err(|error| {
                AppError::internal(
                    "saved_query_connection_join_failed",
                    "Failed to join saved-query connection validation.",
                    Some(error.to_string()),
                )
            })??;

        if exists.is_none() {
            let error = AppError::internal(
                "saved_query_invalid_connection",
                "The saved-query connection reference is no longer valid.",
                Some(id.to_string()),
            );
            self.diagnostics.record_error(error.clone());
            return Err(error);
        }

        Ok(())
    }

    async fn ensure_saved_query_exists(&self, id: &str) -> Result<(), AppError> {
        let repository = self.repository.clone();
        let saved_query_id = id.to_string();
        let exists = task::spawn_blocking(move || repository.get_saved_query(&saved_query_id))
            .await
            .map_err(|error| {
                AppError::internal(
                    "saved_query_lookup_join_failed",
                    "Failed to join the saved-query lookup task.",
                    Some(error.to_string()),
                )
            })??;

        if exists.is_none() {
            let error = AppError::internal(
                "saved_query_missing",
                "The saved query no longer exists.",
                Some(id.to_string()),
            );
            self.diagnostics.record_error(error.clone());
            return Err(error);
        }

        Ok(())
    }
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value.and_then(|entry| {
        let trimmed = entry.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();
    for tag in tags {
        let trimmed = tag.trim();
        if trimmed.is_empty() {
            continue;
        }

        if normalized
            .iter()
            .any(|existing: &String| existing.eq_ignore_ascii_case(trimmed))
        {
            continue;
        }

        normalized.push(trimmed.to_string());
    }

    normalized
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::{
        foundation::{DiagnosticsStore, SaveSavedQueryRequest},
        persistence::{Repository, SaveConnectionRecord},
    };

    use super::ProductivityService;

    fn test_database_path(name: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join("sparow-phase6-productivity-tests");
        std::fs::create_dir_all(&root).expect("failed to create test directory");
        root.join(name)
    }

    fn create_service(name: &str) -> ProductivityService {
        let database_path = test_database_path(name);
        let _ = std::fs::remove_file(&database_path);
        let repository = Arc::new(Repository::new(database_path).expect("repository should initialize"));
        ProductivityService::new(repository, DiagnosticsStore::new())
    }

    async fn seed_connection(service: &ProductivityService, id: &str) {
        service
            .repository
            .save_connection(SaveConnectionRecord {
                id: Some(id.to_string()),
                name: "Local".to_string(),
                host: "127.0.0.1".to_string(),
                port: 5432,
                database: "app_dev".to_string(),
                username: "sparow".to_string(),
                ssl_mode: crate::foundation::SslMode::Prefer,
                secret_ref: None,
            })
            .expect("connection seed should succeed");
    }

    #[tokio::test]
    async fn rejects_saved_queries_with_missing_connections() {
        let service = create_service("missing-connection.sqlite3");
        let error = service
            .save_saved_query(SaveSavedQueryRequest {
                id: None,
                title: "Users".to_string(),
                sql: "select * from users".to_string(),
                tags: vec![],
                connection_profile_id: Some("conn-missing".to_string()),
            })
            .await
            .expect_err("save should fail");

        assert_eq!(error.code, "saved_query_invalid_connection");
    }

    #[tokio::test]
    async fn saves_lists_and_deletes_saved_queries() {
        let service = create_service("saved-query-roundtrip.sqlite3");
        seed_connection(&service, "conn-local-postgres").await;

        let saved = service
            .save_saved_query(SaveSavedQueryRequest {
                id: None,
                title: "Users".to_string(),
                sql: "select * from users".to_string(),
                tags: vec!["users".to_string(), "ops".to_string(), "users".to_string()],
                connection_profile_id: Some("conn-local-postgres".to_string()),
            })
            .await
            .expect("save should succeed");

        assert_eq!(saved.tags, vec!["users".to_string(), "ops".to_string()]);

        let listed = service
            .list_saved_queries(crate::foundation::ListSavedQueriesRequest {
                search_query: "users".to_string(),
                connection_id: Some("conn-local-postgres".to_string()),
                limit: 10,
                offset: 0,
            })
            .await
            .expect("list should succeed");

        assert_eq!(listed.entries.len(), 1);
        assert!(!listed.has_more);

        let deleted = service
            .delete_saved_query(saved.id.clone())
            .await
            .expect("delete should succeed");

        assert_eq!(deleted.id, saved.id);
    }
}
