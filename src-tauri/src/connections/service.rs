use std::{sync::Arc, time::Duration};

use async_trait::async_trait;
use deadpool_postgres::{Manager, ManagerConfig, Pool, RecyclingMethod, Runtime};
use native_tls::TlsConnector;
use postgres_native_tls::MakeTlsConnector;
use tokio::sync::Mutex;
use tokio_postgres::{config::SslMode as PgSslMode, Config, Row};
use tracing::info;

use crate::{
    foundation::{
        iso_timestamp, AppError, ConnectionDetails, ConnectionDraft, ConnectionSessionStatus,
        ConnectionSummary, ConnectionTestResult, ConnectionTestStatus, DatabaseEngine,
        DatabaseSessionSnapshot, DeleteConnectionResult, DisconnectSessionResult,
        SaveConnectionRequest, SslMode, TestConnectionRequest,
    },
    persistence::{PersistedSecretRef, Repository, SaveConnectionRecord, SavedConnectionRecord},
};

use super::secret_store::{SecretStore, CONNECTION_SECRET_SERVICE};

const CONNECT_TIMEOUT_SECONDS: u64 = 10;
const APPLICATION_NAME: &str = "sparow";

struct ActiveSession {
    snapshot: DatabaseSessionSnapshot,
    pool: Option<Pool>,
}

#[derive(Clone)]
pub struct ActiveSessionRuntime {
    pub snapshot: DatabaseSessionSnapshot,
    pub pool: Option<Pool>,
}

#[derive(Clone)]
pub struct ConnectionService {
    repository: Arc<Repository>,
    secret_store: Arc<dyn SecretStore>,
    driver: Arc<dyn PostgresDriver>,
    active_session: Arc<Mutex<Option<ActiveSession>>>,
}

impl ConnectionService {
    pub fn new(
        repository: Arc<Repository>,
        secret_store: Arc<dyn SecretStore>,
        driver: Arc<dyn PostgresDriver>,
    ) -> Self {
        Self {
            repository,
            secret_store,
            driver,
            active_session: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn list_saved_connections(&self) -> Result<Vec<ConnectionSummary>, AppError> {
        let repository = self.repository.clone();
        let records = tokio::task::spawn_blocking(move || repository.list_saved_connections())
            .await
            .map_err(|error| {
                AppError::internal(
                    "join_failed",
                    "Failed to load saved connections.",
                    Some(error.to_string()),
                )
            })??;

        records
            .into_iter()
            .map(|record| self.to_summary(record))
            .collect()
    }

    pub async fn get_saved_connection(&self, id: &str) -> Result<ConnectionDetails, AppError> {
        let repository = self.repository.clone();
        let id_owned = id.to_string();
        let record =
            tokio::task::spawn_blocking(move || repository.get_saved_connection(&id_owned))
                .await
                .map_err(|error| {
                    AppError::internal(
                        "join_failed",
                        "Failed to load the saved connection.",
                        Some(error.to_string()),
                    )
                })??
                .ok_or_else(|| missing_profile_error(id))?;

        let repository = self.repository.clone();
        let id_owned = id.to_string();
        tokio::task::spawn_blocking(move || {
            repository.save_selected_connection_id(Some(&id_owned))
        })
        .await
        .map_err(|error| {
            AppError::internal(
                "join_failed",
                "Failed to persist the selected connection.",
                Some(error.to_string()),
            )
        })??;

        self.to_details(record)
    }

    pub async fn save_connection(
        &self,
        request: SaveConnectionRequest,
    ) -> Result<ConnectionDetails, AppError> {
        let existing_record = match request.id.as_deref() {
            Some(id) => {
                let repository = self.repository.clone();
                let id_owned = id.to_string();
                tokio::task::spawn_blocking(move || repository.get_saved_connection(&id_owned))
                    .await
                    .map_err(|error| {
                        AppError::internal(
                            "join_failed",
                            "Failed to load the saved connection before save.",
                            Some(error.to_string()),
                        )
                    })??
            }
            None => None,
        };

        let record_id = request
            .id
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        let secret_ref = if let Some(password) = request.draft.password.as_deref() {
            if !password.is_empty() {
                self.secret_store.save_password(&record_id, password)?;
                Some(PersistedSecretRef {
                    provider: self.secret_store.provider(),
                    service: CONNECTION_SECRET_SERVICE.to_string(),
                    account: record_id.clone(),
                })
            } else {
                existing_record
                    .as_ref()
                    .and_then(|record| record.secret_ref.clone())
            }
        } else {
            existing_record
                .as_ref()
                .and_then(|record| record.secret_ref.clone())
        };

        let repository = self.repository.clone();
        let save_record = SaveConnectionRecord {
            id: Some(record_id.clone()),
            name: request.draft.name.clone(),
            host: request.draft.host.clone(),
            port: request.draft.port,
            database: request.draft.database.clone(),
            username: request.draft.username.clone(),
            ssl_mode: request.draft.ssl_mode,
            secret_ref,
        };
        let saved_record =
            tokio::task::spawn_blocking(move || repository.save_connection(save_record))
                .await
                .map_err(|error| {
                    AppError::internal(
                        "join_failed",
                        "Failed to save the connection.",
                        Some(error.to_string()),
                    )
                })??;

        let repository = self.repository.clone();
        tokio::task::spawn_blocking(move || {
            repository.save_selected_connection_id(Some(&record_id))
        })
        .await
        .map_err(|error| {
            AppError::internal(
                "join_failed",
                "Failed to persist the selected connection.",
                Some(error.to_string()),
            )
        })??;

        info!(connection_id = %saved_record.id, "saved PostgreSQL connection");
        self.to_details(saved_record)
    }

    pub async fn test_connection(&self, request: TestConnectionRequest) -> ConnectionTestResult {
        let tested_at = iso_timestamp();
        let result = match self
            .resolve_draft_secret(request.connection_id.as_deref(), &request.draft)
            .await
        {
            Ok(password) => {
                self.driver
                    .test_connection(DriverConnectionInput::from_draft(&request.draft, password))
                    .await
            }
            Err(error) => Err(error),
        };

        match result {
            Ok(metadata) => {
                if let Some(connection_id) = request.connection_id.as_deref() {
                    let repository = self.repository.clone();
                    let connection_id_owned = connection_id.to_string();
                    let tested_at_owned = tested_at.clone();
                    let _ = tokio::task::spawn_blocking(move || {
                        repository
                            .set_connection_last_tested_at(&connection_id_owned, &tested_at_owned)
                    })
                    .await;
                }

                ConnectionTestResult {
                    tested_at,
                    status: ConnectionTestStatus::Success,
                    summary_message: "Connection test succeeded.".to_string(),
                    server_version: metadata.server_version,
                    current_database: metadata.current_database,
                    current_user: metadata.current_user,
                    ssl_in_use: metadata.ssl_in_use,
                    round_trip_ms: Some(metadata.round_trip_ms),
                    error: None,
                }
            }
            Err(error) => ConnectionTestResult {
                tested_at,
                status: ConnectionTestStatus::Failure,
                summary_message: error.message.clone(),
                server_version: None,
                current_database: None,
                current_user: None,
                ssl_in_use: None,
                round_trip_ms: None,
                error: Some(error),
            },
        }
    }

    pub async fn connect_saved_connection(
        &self,
        id: &str,
    ) -> Result<DatabaseSessionSnapshot, AppError> {
        let record = self.load_saved_record(id).await?;
        let password = self.load_saved_secret(&record)?;
        let established = self
            .driver
            .connect(DriverConnectionInput::from_record(&record, password))
            .await?;

        self.disconnect_active_connection().await?;

        let connected_at = iso_timestamp();
        let snapshot = DatabaseSessionSnapshot {
            connection_id: record.id.clone(),
            name: record.name.clone(),
            engine: DatabaseEngine::Postgresql,
            database: record.database.clone(),
            username: record.username.clone(),
            host: record.host.clone(),
            port: record.port,
            connected_at: connected_at.clone(),
            server_version: established.metadata.server_version,
            ssl_in_use: established.metadata.ssl_in_use,
            status: ConnectionSessionStatus::Connected,
        };

        let repository = self.repository.clone();
        let connection_id = record.id.clone();
        tokio::task::spawn_blocking(move || {
            repository.set_connection_last_connected_at(&connection_id, &connected_at)?;
            repository.save_selected_connection_id(Some(&connection_id))?;
            Ok::<(), AppError>(())
        })
        .await
        .map_err(|error| {
            AppError::internal(
                "join_failed",
                "Failed to persist connection state.",
                Some(error.to_string()),
            )
        })??;

        let mut guard = self.active_session.lock().await;
        *guard = Some(ActiveSession {
            snapshot: snapshot.clone(),
            pool: established.pool,
        });

        info!(connection_id = %snapshot.connection_id, "connected PostgreSQL session");
        Ok(snapshot)
    }

    pub async fn disconnect_active_connection(&self) -> Result<DisconnectSessionResult, AppError> {
        let mut guard = self.active_session.lock().await;
        let previous = guard.take().map(|session| session.snapshot.connection_id);

        Ok(DisconnectSessionResult {
            connection_id: previous,
        })
    }

    pub async fn delete_saved_connection(
        &self,
        id: &str,
    ) -> Result<DeleteConnectionResult, AppError> {
        let record = self.load_saved_record(id).await?;

        let disconnected = {
            let active_id = self
                .active_session
                .lock()
                .await
                .as_ref()
                .map(|session| session.snapshot.connection_id.clone());
            if active_id.as_deref() == Some(id) {
                self.disconnect_active_connection()
                    .await?
                    .connection_id
                    .is_some()
            } else {
                false
            }
        };

        if let Some(secret_ref) = &record.secret_ref {
            self.secret_store.delete_password(&secret_ref.account)?;
        }

        let repository = self.repository.clone();
        let id_owned = id.to_string();
        tokio::task::spawn_blocking(move || {
            let deleted = repository.delete_saved_connection(&id_owned)?;
            if deleted {
                let current_selected = repository.load_selected_connection_id()?;
                if current_selected.as_deref() == Some(&id_owned) {
                    repository.save_selected_connection_id(None)?;
                }
            }
            Ok::<bool, AppError>(deleted)
        })
        .await
        .map_err(|error| {
            AppError::internal(
                "join_failed",
                "Failed to delete the saved connection.",
                Some(error.to_string()),
            )
        })??;

        Ok(DeleteConnectionResult {
            id: id.to_string(),
            disconnected,
        })
    }

    pub async fn selected_connection_id(&self) -> Result<Option<String>, AppError> {
        let repository = self.repository.clone();
        tokio::task::spawn_blocking(move || repository.load_selected_connection_id())
            .await
            .map_err(|error| {
                AppError::internal(
                    "join_failed",
                    "Failed to load the selected connection.",
                    Some(error.to_string()),
                )
            })?
    }

    pub async fn active_session_snapshot(&self) -> Option<DatabaseSessionSnapshot> {
        self.active_session
            .lock()
            .await
            .as_ref()
            .map(|session| session.snapshot.clone())
    }

    pub async fn active_session_runtime(
        &self,
        connection_id: &str,
    ) -> Result<ActiveSessionRuntime, AppError> {
        let guard = self.active_session.lock().await;
        let session = guard.as_ref().ok_or_else(|| {
            AppError::retryable(
                "schema_no_active_session",
                "Schema browsing requires an active PostgreSQL session.",
                None,
            )
        })?;

        if session.snapshot.connection_id != connection_id {
            return Err(AppError::retryable(
                "schema_wrong_connection_selected",
                "Schema browsing only supports the currently active saved connection.",
                Some(connection_id.to_string()),
            ));
        }

        Ok(ActiveSessionRuntime {
            snapshot: session.snapshot.clone(),
            pool: session.pool.clone(),
        })
    }

    #[cfg(test)]
    pub async fn set_test_active_session(&self, runtime: ActiveSessionRuntime) {
        let mut guard = self.active_session.lock().await;
        *guard = Some(ActiveSession {
            snapshot: runtime.snapshot,
            pool: runtime.pool,
        });
    }

    fn to_summary(&self, record: SavedConnectionRecord) -> Result<ConnectionSummary, AppError> {
        let has_stored_secret = match &record.secret_ref {
            Some(secret_ref) => self
                .secret_store
                .load_password(&secret_ref.account)?
                .is_some(),
            None => false,
        };

        Ok(ConnectionSummary {
            id: record.id,
            engine: parse_database_engine(&record.engine)?,
            name: record.name,
            host: record.host,
            port: record.port,
            database: record.database,
            username: record.username,
            ssl_mode: record.ssl_mode,
            has_stored_secret,
            secret_provider: record
                .secret_ref
                .as_ref()
                .map(|secret_ref| secret_ref.provider),
            last_tested_at: record.last_tested_at,
            last_connected_at: record.last_connected_at,
            updated_at: record.updated_at,
        })
    }

    fn to_details(&self, record: SavedConnectionRecord) -> Result<ConnectionDetails, AppError> {
        Ok(ConnectionDetails {
            summary: self.to_summary(record.clone())?,
            created_at: record.created_at,
        })
    }

    async fn load_saved_record(&self, id: &str) -> Result<SavedConnectionRecord, AppError> {
        let repository = self.repository.clone();
        let id_owned = id.to_string();
        tokio::task::spawn_blocking(move || repository.get_saved_connection(&id_owned))
            .await
            .map_err(|error| {
                AppError::internal(
                    "join_failed",
                    "Failed to load the saved connection.",
                    Some(error.to_string()),
                )
            })??
            .ok_or_else(|| missing_profile_error(id))
    }

    fn load_saved_secret(&self, record: &SavedConnectionRecord) -> Result<String, AppError> {
        match &record.secret_ref {
            Some(secret_ref) => self
                .secret_store
                .load_password(&secret_ref.account)?
                .ok_or_else(|| {
                    AppError::retryable(
                        "missing_secret",
                        "The saved connection password is missing from secret storage.",
                        Some(record.id.clone()),
                    )
                }),
            None => Ok(String::new()),
        }
    }

    async fn resolve_draft_secret(
        &self,
        connection_id: Option<&str>,
        draft: &ConnectionDraft,
    ) -> Result<String, AppError> {
        if let Some(password) = draft.password.as_deref() {
            if !password.is_empty() {
                return Ok(password.to_string());
            }
        }

        if let Some(connection_id) = connection_id {
            let record = self.load_saved_record(connection_id).await?;
            return self.load_saved_secret(&record);
        }

        Ok(String::new())
    }
}

fn missing_profile_error(id: &str) -> AppError {
    AppError::retryable(
        "connection_profile_not_found",
        "The requested saved connection could not be found.",
        Some(id.to_string()),
    )
}

fn parse_database_engine(value: &str) -> Result<DatabaseEngine, AppError> {
    match value {
        "postgresql" => Ok(DatabaseEngine::Postgresql),
        other => Err(AppError::internal(
            "invalid_database_engine",
            "An unsupported database engine was loaded from local storage.",
            Some(other.to_string()),
        )),
    }
}

#[derive(Clone)]
pub struct DriverConnectionInput {
    host: String,
    port: u16,
    database: String,
    username: String,
    ssl_mode: SslMode,
    password: Option<String>,
}

impl DriverConnectionInput {
    fn from_draft(draft: &ConnectionDraft, password: String) -> Self {
        Self {
            host: draft.host.clone(),
            port: draft.port,
            database: draft.database.clone(),
            username: draft.username.clone(),
            ssl_mode: draft.ssl_mode,
            password: if password.is_empty() {
                None
            } else {
                Some(password)
            },
        }
    }

    fn from_record(record: &SavedConnectionRecord, password: String) -> Self {
        Self {
            host: record.host.clone(),
            port: record.port,
            database: record.database.clone(),
            username: record.username.clone(),
            ssl_mode: record.ssl_mode,
            password: if password.is_empty() {
                None
            } else {
                Some(password)
            },
        }
    }

    fn to_pg_config(&self) -> Config {
        let mut config = Config::new();
        config.host(&self.host);
        config.port(self.port);
        config.user(&self.username);
        if let Some(password) = self.password.as_deref() {
            config.password(password);
        }
        config.dbname(&self.database);
        config.application_name(APPLICATION_NAME);
        config.connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECONDS));
        config.ssl_mode(match self.ssl_mode {
            SslMode::Disable => PgSslMode::Disable,
            SslMode::Prefer => PgSslMode::Prefer,
            SslMode::Require => PgSslMode::Require,
        });
        config
    }
}

pub struct DriverConnectionMetadata {
    server_version: Option<String>,
    current_database: Option<String>,
    current_user: Option<String>,
    ssl_in_use: Option<bool>,
    round_trip_ms: u64,
}

pub struct EstablishedSession {
    metadata: DriverConnectionMetadata,
    pool: Option<Pool>,
}

#[async_trait]
pub trait PostgresDriver: Send + Sync {
    async fn test_connection(
        &self,
        input: DriverConnectionInput,
    ) -> Result<DriverConnectionMetadata, AppError>;
    async fn connect(&self, input: DriverConnectionInput) -> Result<EstablishedSession, AppError>;
}

pub struct RuntimePostgresDriver;

#[async_trait]
impl PostgresDriver for RuntimePostgresDriver {
    async fn test_connection(
        &self,
        input: DriverConnectionInput,
    ) -> Result<DriverConnectionMetadata, AppError> {
        let start = std::time::Instant::now();
        let config = input.to_pg_config();
        match input.ssl_mode {
            SslMode::Disable => {
                let (client, connection) = config
                    .connect(tokio_postgres::NoTls)
                    .await
                    .map_err(|error| normalize_pg_error("connect", &error))?;
                tokio::spawn(async move {
                    if let Err(error) = connection.await {
                        tracing::error!(?error, "temporary PostgreSQL test connection failed");
                    }
                });

                query_connection_metadata(&client, start.elapsed().as_millis() as u64).await
            }
            SslMode::Prefer | SslMode::Require => {
                let connector = MakeTlsConnector::new(build_tls_connector(input.ssl_mode)?);
                let (client, connection) = config
                    .connect(connector)
                    .await
                    .map_err(|error| normalize_pg_error("connect", &error))?;
                tokio::spawn(async move {
                    if let Err(error) = connection.await {
                        tracing::error!(?error, "temporary PostgreSQL test connection failed");
                    }
                });

                query_connection_metadata(&client, start.elapsed().as_millis() as u64).await
            }
        }
    }

    async fn connect(&self, input: DriverConnectionInput) -> Result<EstablishedSession, AppError> {
        let start = std::time::Instant::now();
        let config = input.to_pg_config();
        let pool = create_pool(&config, input.ssl_mode)?;
        let client = pool
            .get()
            .await
            .map_err(|error| normalize_driver_error("connect", error.to_string()))?;
        let row = client
            .query_one("select current_database(), current_user, version()", &[])
            .await
            .map_err(|error| normalize_driver_error("connect", error.to_string()))?;
        let ssl_row = client
            .query_one(
                "select coalesce((select ssl from pg_stat_ssl where pid = pg_backend_pid()), false)",
                &[],
            )
            .await
            .map_err(|error| normalize_driver_error("connect", error.to_string()))?;

        let metadata = DriverConnectionMetadata {
            current_database: row.get::<_, Option<String>>(0),
            current_user: row.get::<_, Option<String>>(1),
            server_version: row.get::<_, Option<String>>(2),
            ssl_in_use: ssl_row.get::<_, Option<bool>>(0),
            round_trip_ms: start.elapsed().as_millis() as u64,
        };

        Ok(EstablishedSession {
            metadata,
            pool: Some(pool),
        })
    }
}

async fn query_connection_metadata<C>(
    client: &C,
    round_trip_ms: u64,
) -> Result<DriverConnectionMetadata, AppError>
where
    C: MetadataClient + Sync,
{
    let row = client.query_metadata_row().await?;
    let ssl_row = client.query_ssl_row().await?;

    Ok(DriverConnectionMetadata {
        current_database: row.get::<_, Option<String>>(0),
        current_user: row.get::<_, Option<String>>(1),
        server_version: row.get::<_, Option<String>>(2),
        ssl_in_use: ssl_row.get::<_, Option<bool>>(0),
        round_trip_ms,
    })
}

#[async_trait]
trait MetadataClient {
    async fn query_metadata_row(&self) -> Result<Row, AppError>;
    async fn query_ssl_row(&self) -> Result<Row, AppError>;
}

#[async_trait]
impl MetadataClient for tokio_postgres::Client {
    async fn query_metadata_row(&self) -> Result<Row, AppError> {
        self.query_one("select current_database(), current_user, version()", &[])
            .await
            .map_err(|error| normalize_pg_error("query_metadata", &error))
    }

    async fn query_ssl_row(&self) -> Result<Row, AppError> {
        self.query_one(
            "select coalesce((select ssl from pg_stat_ssl where pid = pg_backend_pid()), false)",
            &[],
        )
        .await
        .map_err(|error| normalize_pg_error("query_ssl_state", &error))
    }
}

#[async_trait]
impl MetadataClient for deadpool_postgres::Client {
    async fn query_metadata_row(&self) -> Result<Row, AppError> {
        self.query_one("select current_database(), current_user, version()", &[])
            .await
            .map_err(|error| normalize_pg_error("query_metadata", &error))
    }

    async fn query_ssl_row(&self) -> Result<Row, AppError> {
        self.query_one(
            "select coalesce((select ssl from pg_stat_ssl where pid = pg_backend_pid()), false)",
            &[],
        )
        .await
        .map_err(|error| normalize_pg_error("query_ssl_state", &error))
    }
}

fn create_pool(config: &Config, ssl_mode: SslMode) -> Result<Pool, AppError> {
    let manager_config = ManagerConfig {
        recycling_method: RecyclingMethod::Fast,
    };

    let pool = match ssl_mode {
        SslMode::Disable => {
            let manager =
                Manager::from_config(config.clone(), tokio_postgres::NoTls, manager_config);
            Pool::builder(manager)
                .max_size(4)
                .runtime(Runtime::Tokio1)
                .build()
                .map_err(|error| {
                    AppError::internal(
                        "connection_pool_build_failed",
                        "Failed to create the PostgreSQL pool.",
                        Some(error.to_string()),
                    )
                })?
        }
        SslMode::Prefer | SslMode::Require => {
            let connector = MakeTlsConnector::new(build_tls_connector(ssl_mode)?);
            let manager = Manager::from_config(config.clone(), connector, manager_config);
            Pool::builder(manager)
                .max_size(4)
                .runtime(Runtime::Tokio1)
                .build()
                .map_err(|error| {
                    AppError::internal(
                        "connection_pool_build_failed",
                        "Failed to create the PostgreSQL pool.",
                        Some(error.to_string()),
                    )
                })?
        }
    };

    Ok(pool)
}

fn build_tls_connector(ssl_mode: SslMode) -> Result<TlsConnector, AppError> {
    let mut builder = TlsConnector::builder();

    if matches!(ssl_mode, SslMode::Prefer | SslMode::Require) {
        // Phase 2 only exposes basic SSL modes and does not yet allow user-supplied CA bundles.
        // Accepting provider-managed certificate and hostname mismatches keeps managed services
        // reachable until explicit certificate controls land in a later phase.
        builder.danger_accept_invalid_certs(true);
        builder.danger_accept_invalid_hostnames(true);
    }

    builder.build().map_err(|error| {
        AppError::internal(
            "connection_tls_init_failed",
            "Failed to initialize the TLS connector.",
            Some(error.to_string()),
        )
    })
}

fn normalize_pg_error(operation: &str, error: &tokio_postgres::Error) -> AppError {
    if let Some(db_error) = error.as_db_error() {
        let code = db_error.code().code();
        if code == "28P01" || code == "28000" {
            return AppError::retryable(
                "invalid_credentials",
                "PostgreSQL rejected the provided credentials.",
                Some(error.to_string()),
            );
        }
    }

    normalize_driver_error(operation, error.to_string())
}

fn normalize_driver_error(operation: &str, detail: String) -> AppError {
    let lowercase = detail.to_lowercase();
    if lowercase.contains("timeout") {
        return AppError::retryable(
            "connection_timeout",
            "The PostgreSQL connection attempt timed out.",
            Some(detail),
        );
    }
    if lowercase.contains("ssl") || lowercase.contains("tls") || lowercase.contains("certificate") {
        return AppError::retryable(
            "ssl_failure",
            "PostgreSQL TLS negotiation failed.",
            Some(detail),
        );
    }
    if lowercase.contains("authentication") || lowercase.contains("password") {
        return AppError::retryable(
            "invalid_credentials",
            "PostgreSQL rejected the provided credentials.",
            Some(detail),
        );
    }
    if lowercase.contains("refused")
        || lowercase.contains("network")
        || lowercase.contains("unreachable")
        || lowercase.contains("dns")
        || lowercase.contains("host")
    {
        return AppError::retryable(
            "network_unreachable",
            "The PostgreSQL server could not be reached.",
            Some(detail),
        );
    }

    AppError::internal(
        &format!("connection_{operation}_failed"),
        "The PostgreSQL operation failed.",
        Some(detail),
    )
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use async_trait::async_trait;

    use super::{
        build_tls_connector, normalize_driver_error, ConnectionService, DriverConnectionInput,
        DriverConnectionMetadata, EstablishedSession, PostgresDriver,
    };
    use crate::{
        connections::MemorySecretStore,
        foundation::{
            ConnectionDraft, ConnectionSessionStatus, ConnectionTestStatus, SaveConnectionRequest,
            SslMode, TestConnectionRequest,
        },
        persistence::Repository,
    };

    #[derive(Default)]
    struct MockPostgresDriver;

    #[async_trait]
    impl PostgresDriver for MockPostgresDriver {
        async fn test_connection(
            &self,
            input: DriverConnectionInput,
        ) -> Result<DriverConnectionMetadata, crate::foundation::AppError> {
            Ok(DriverConnectionMetadata {
                server_version: Some("PostgreSQL mock".to_string()),
                current_database: Some(input.database),
                current_user: Some(input.username),
                ssl_in_use: Some(matches!(input.ssl_mode, SslMode::Prefer | SslMode::Require)),
                round_trip_ms: 5,
            })
        }

        async fn connect(
            &self,
            input: DriverConnectionInput,
        ) -> Result<EstablishedSession, crate::foundation::AppError> {
            Ok(EstablishedSession {
                metadata: DriverConnectionMetadata {
                    server_version: Some("PostgreSQL mock".to_string()),
                    current_database: Some(input.database),
                    current_user: Some(input.username),
                    ssl_in_use: Some(false),
                    round_trip_ms: 6,
                },
                pool: None,
            })
        }
    }

    fn test_database_path(name: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join("sparow-connection-service-tests");
        std::fs::create_dir_all(&root).expect("failed to create test directory");
        root.join(name)
    }

    fn test_service(name: &str) -> ConnectionService {
        let database_path = test_database_path(name);
        let _ = std::fs::remove_file(&database_path);
        let repository =
            Arc::new(Repository::new(database_path).expect("repository should initialize"));
        ConnectionService::new(
            repository,
            Arc::new(MemorySecretStore::default()),
            Arc::new(MockPostgresDriver),
        )
    }

    #[tokio::test]
    async fn saves_and_loads_connection_details() {
        let service = test_service("save-and-load.sqlite3");
        let saved = service
            .save_connection(SaveConnectionRequest {
                id: None,
                draft: ConnectionDraft {
                    name: "Local".to_string(),
                    host: "127.0.0.1".to_string(),
                    port: 5432,
                    database: "app_dev".to_string(),
                    username: "sparow".to_string(),
                    ssl_mode: SslMode::Prefer,
                    password: Some("secret".to_string()),
                },
            })
            .await
            .expect("save should succeed");

        assert_eq!(saved.summary.name, "Local");

        let fetched = service
            .get_saved_connection(&saved.summary.id)
            .await
            .expect("get should succeed");
        assert!(fetched.summary.has_stored_secret);
    }

    #[tokio::test]
    async fn tests_saved_connection_without_retyping_password() {
        let service = test_service("test-with-stored-secret.sqlite3");
        let saved = service
            .save_connection(SaveConnectionRequest {
                id: None,
                draft: ConnectionDraft {
                    name: "Local".to_string(),
                    host: "127.0.0.1".to_string(),
                    port: 5432,
                    database: "app_dev".to_string(),
                    username: "sparow".to_string(),
                    ssl_mode: SslMode::Prefer,
                    password: Some("secret".to_string()),
                },
            })
            .await
            .expect("save should succeed");

        let result = service
            .test_connection(TestConnectionRequest {
                connection_id: Some(saved.summary.id),
                draft: ConnectionDraft {
                    name: "Local".to_string(),
                    host: "127.0.0.1".to_string(),
                    port: 5432,
                    database: "app_dev".to_string(),
                    username: "sparow".to_string(),
                    ssl_mode: SslMode::Prefer,
                    password: None,
                },
            })
            .await;

        assert!(matches!(result.status, ConnectionTestStatus::Success));
    }

    #[tokio::test]
    async fn connect_replaces_active_session() {
        let service = test_service("connect-replaces-active.sqlite3");
        let first = service
            .save_connection(SaveConnectionRequest {
                id: None,
                draft: ConnectionDraft {
                    name: "First".to_string(),
                    host: "127.0.0.1".to_string(),
                    port: 5432,
                    database: "first".to_string(),
                    username: "sparow".to_string(),
                    ssl_mode: SslMode::Disable,
                    password: Some("secret".to_string()),
                },
            })
            .await
            .expect("first save should succeed");
        let second = service
            .save_connection(SaveConnectionRequest {
                id: None,
                draft: ConnectionDraft {
                    name: "Second".to_string(),
                    host: "127.0.0.1".to_string(),
                    port: 5432,
                    database: "second".to_string(),
                    username: "sparow".to_string(),
                    ssl_mode: SslMode::Disable,
                    password: Some("secret".to_string()),
                },
            })
            .await
            .expect("second save should succeed");

        let first_session = service
            .connect_saved_connection(&first.summary.id)
            .await
            .expect("first connect should succeed");
        assert!(matches!(
            first_session.status,
            ConnectionSessionStatus::Connected
        ));

        let second_session = service
            .connect_saved_connection(&second.summary.id)
            .await
            .expect("second connect should succeed");

        assert_eq!(second_session.connection_id, second.summary.id);
        assert_eq!(
            service
                .active_session_snapshot()
                .await
                .expect("session should exist")
                .connection_id,
            second.summary.id
        );
    }

    #[tokio::test]
    async fn save_without_password_keeps_existing_secret() {
        let service = test_service("preserve-secret-on-update.sqlite3");
        let saved = service
            .save_connection(SaveConnectionRequest {
                id: None,
                draft: ConnectionDraft {
                    name: "Local".to_string(),
                    host: "127.0.0.1".to_string(),
                    port: 5432,
                    database: "app_dev".to_string(),
                    username: "sparow".to_string(),
                    ssl_mode: SslMode::Prefer,
                    password: Some("secret".to_string()),
                },
            })
            .await
            .expect("initial save should succeed");

        let updated = service
            .save_connection(SaveConnectionRequest {
                id: Some(saved.summary.id.clone()),
                draft: ConnectionDraft {
                    name: "Local staging".to_string(),
                    host: "127.0.0.1".to_string(),
                    port: 5432,
                    database: "app_dev".to_string(),
                    username: "sparow".to_string(),
                    ssl_mode: SslMode::Prefer,
                    password: None,
                },
            })
            .await
            .expect("update save should succeed");

        assert_eq!(updated.summary.name, "Local staging");
        assert!(updated.summary.has_stored_secret);

        let test_result = service
            .test_connection(TestConnectionRequest {
                connection_id: Some(saved.summary.id),
                draft: ConnectionDraft {
                    name: updated.summary.name,
                    host: updated.summary.host,
                    port: updated.summary.port,
                    database: updated.summary.database,
                    username: updated.summary.username,
                    ssl_mode: updated.summary.ssl_mode,
                    password: None,
                },
            })
            .await;

        assert!(matches!(test_result.status, ConnectionTestStatus::Success));
    }

    #[test]
    fn tls_failures_are_normalized_consistently() {
        let error = normalize_driver_error(
            "connect",
            "error performing TLS handshake: certificate verify failed".to_string(),
        );

        assert_eq!(error.code, "ssl_failure");
        assert_eq!(error.message, "PostgreSQL TLS negotiation failed.");
    }

    #[test]
    fn tls_connector_initializes_for_basic_ssl_modes() {
        build_tls_connector(SslMode::Prefer).expect("prefer TLS connector should build");
        build_tls_connector(SslMode::Require).expect("require TLS connector should build");
    }

    #[tokio::test]
    #[ignore = "requires explicit PostgreSQL environment variables"]
    async fn postgres_connection_smoke() {
        let service = ConnectionService::new(
            Arc::new(
                Repository::new(test_database_path("postgres-smoke.sqlite3"))
                    .expect("repository should initialize"),
            ),
            Arc::new(MemorySecretStore::default()),
            Arc::new(super::RuntimePostgresDriver),
        );

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
            _ => SslMode::Prefer,
        };

        let saved = service
            .save_connection(SaveConnectionRequest {
                id: None,
                draft: ConnectionDraft {
                    name: "Smoke".to_string(),
                    host,
                    port,
                    database,
                    username,
                    ssl_mode,
                    password: Some(password.clone()),
                },
            })
            .await
            .expect("save should succeed");

        let test_result = service
            .test_connection(TestConnectionRequest {
                connection_id: Some(saved.summary.id.clone()),
                draft: ConnectionDraft {
                    name: saved.summary.name.clone(),
                    host: saved.summary.host.clone(),
                    port: saved.summary.port,
                    database: saved.summary.database.clone(),
                    username: saved.summary.username.clone(),
                    ssl_mode: saved.summary.ssl_mode,
                    password: None,
                },
            })
            .await;
        assert!(matches!(test_result.status, ConnectionTestStatus::Success));

        let session = service
            .connect_saved_connection(&saved.summary.id)
            .await
            .expect("connect should succeed");
        assert_eq!(session.connection_id, saved.summary.id);

        let disconnected = service
            .disconnect_active_connection()
            .await
            .expect("disconnect should succeed");
        assert_eq!(
            disconnected.connection_id.as_deref(),
            Some(saved.summary.id.as_str())
        );

        let deleted = service
            .delete_saved_connection(&saved.summary.id)
            .await
            .expect("delete should succeed");
        assert_eq!(deleted.id, saved.summary.id);
    }
}
