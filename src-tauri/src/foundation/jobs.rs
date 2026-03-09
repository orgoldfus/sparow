use std::{collections::HashMap, sync::Arc};

use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Default)]
pub struct JobRegistry {
    tokens: Arc<Mutex<HashMap<String, CancellationToken>>>,
}

impl JobRegistry {
    pub async fn insert(&self, job_id: String, token: CancellationToken) {
        self.tokens.lock().await.insert(job_id, token);
    }

    pub async fn cancel(&self, job_id: &str) -> bool {
        let mut guard = self.tokens.lock().await;
        if let Some(token) = guard.remove(job_id) {
            token.cancel();
            return true;
        }

        false
    }

    pub async fn remove(&self, job_id: &str) {
        self.tokens.lock().await.remove(job_id);
    }
}
