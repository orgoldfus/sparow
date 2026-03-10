use std::time::Duration;

use async_trait::async_trait;
use deadpool_postgres::{Manager, ManagerConfig, Pool, PoolError, RecyclingMethod, Runtime};
use native_tls::TlsConnector;
use postgres_native_tls::MakeTlsConnector;
use tokio_postgres::{config::SslMode as PgSslMode, Config, Row};

use crate::{
    foundation::{AppError, ConnectionDraft, SslMode},
    persistence::SavedConnectionRecord,
};

const CONNECT_TIMEOUT_SECONDS: u64 = 10;
const APPLICATION_NAME: &str = "sparow";

#[derive(Clone)]
pub(crate) struct DriverConnectionInput {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) database: String,
    pub(crate) username: String,
    pub(crate) ssl_mode: SslMode,
    pub(crate) password: Option<String>,
}

impl DriverConnectionInput {
    pub(crate) fn from_draft(draft: &ConnectionDraft, password: String) -> Self {
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

    pub(crate) fn from_record(record: &SavedConnectionRecord, password: String) -> Self {
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
            SslMode::Insecure => PgSslMode::Require,
        });
        config
    }
}

pub(crate) struct DriverConnectionMetadata {
    pub(crate) server_version: Option<String>,
    pub(crate) current_database: Option<String>,
    pub(crate) current_user: Option<String>,
    pub(crate) ssl_in_use: Option<bool>,
    pub(crate) round_trip_ms: u64,
}

pub(crate) struct EstablishedSession {
    pub(crate) metadata: DriverConnectionMetadata,
    pub(crate) pool: Option<Pool>,
}

#[async_trait]
pub(crate) trait PostgresDriver: Send + Sync {
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
            SslMode::Prefer | SslMode::Require | SslMode::Insecure => {
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
            .map_err(|error| normalize_pool_error("connect", error))?;
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
        SslMode::Prefer | SslMode::Require | SslMode::Insecure => {
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

pub(crate) fn build_tls_connector(ssl_mode: SslMode) -> Result<TlsConnector, AppError> {
    let mut builder = TlsConnector::builder();

    if matches!(ssl_mode, SslMode::Insecure) {
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

fn normalize_pool_error(operation: &str, error: PoolError) -> AppError {
    match error {
        PoolError::Backend(backend_error) => normalize_pg_error(operation, &backend_error),
        other => normalize_driver_error(operation, other.to_string()),
    }
}

pub(crate) fn normalize_driver_error(operation: &str, detail: String) -> AppError {
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
