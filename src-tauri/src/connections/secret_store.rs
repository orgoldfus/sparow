use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use keyring::Entry;

use crate::foundation::{AppError, SecretProvider};

pub const CONNECTION_SECRET_SERVICE: &str = "sparow.postgresql.connection";

pub trait SecretStore: Send + Sync {
    fn provider(&self) -> SecretProvider;
    fn save_password(&self, account: &str, password: &str) -> Result<(), AppError>;
    fn load_password(&self, account: &str) -> Result<Option<String>, AppError>;
    fn delete_password(&self, account: &str) -> Result<(), AppError>;
}

pub fn default_secret_store() -> Arc<dyn SecretStore> {
    if cfg!(test) {
        Arc::new(MemorySecretStore::default())
    } else {
        Arc::new(KeyringSecretStore::new(CONNECTION_SECRET_SERVICE))
    }
}

#[derive(Debug)]
pub struct KeyringSecretStore {
    service: String,
}

impl KeyringSecretStore {
    pub fn new(service: &str) -> Self {
        Self {
            service: service.to_string(),
        }
    }

    fn entry(&self, account: &str) -> Result<Entry, AppError> {
        Entry::new(&self.service, account).map_err(|error| {
            AppError::internal(
                "secret_store_entry_failed",
                "Failed to open the OS keychain entry.",
                Some(error.to_string()),
            )
        })
    }
}

impl SecretStore for KeyringSecretStore {
    fn provider(&self) -> SecretProvider {
        SecretProvider::OsKeychain
    }

    fn save_password(&self, account: &str, password: &str) -> Result<(), AppError> {
        self.entry(account)?
            .set_password(password)
            .map_err(|error| {
                AppError::internal(
                    "secret_store_write_failed",
                    "Failed to save the connection password in the OS keychain.",
                    Some(error.to_string()),
                )
            })
    }

    fn load_password(&self, account: &str) -> Result<Option<String>, AppError> {
        match self.entry(account)?.get_password() {
            Ok(password) => Ok(Some(password)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(AppError::internal(
                "secret_store_read_failed",
                "Failed to read the connection password from the OS keychain.",
                Some(error.to_string()),
            )),
        }
    }

    fn delete_password(&self, account: &str) -> Result<(), AppError> {
        match self.entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(AppError::internal(
                "secret_store_delete_failed",
                "Failed to delete the connection password from the OS keychain.",
                Some(error.to_string()),
            )),
        }
    }
}

#[derive(Debug, Default, Clone)]
pub struct MemorySecretStore {
    entries: Arc<Mutex<HashMap<String, String>>>,
}

impl SecretStore for MemorySecretStore {
    fn provider(&self) -> SecretProvider {
        SecretProvider::Memory
    }

    fn save_password(&self, account: &str, password: &str) -> Result<(), AppError> {
        let mut guard = self.entries.lock().expect("secret store lock poisoned");
        guard.insert(account.to_string(), password.to_string());
        Ok(())
    }

    fn load_password(&self, account: &str) -> Result<Option<String>, AppError> {
        let guard = self.entries.lock().expect("secret store lock poisoned");
        Ok(guard.get(account).cloned())
    }

    fn delete_password(&self, account: &str) -> Result<(), AppError> {
        let mut guard = self.entries.lock().expect("secret store lock poisoned");
        let _ = guard.remove(account);
        Ok(())
    }
}
