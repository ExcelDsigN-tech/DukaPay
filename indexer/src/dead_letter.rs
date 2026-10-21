//! Durable NDJSON storage for events that exhaust their processing retries.

use crate::rpc::RawEvent;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

#[derive(Deserialize, Serialize)]
struct DeadLetterRecord {
    event_id: String,
    contract_id: String,
    ledger: u32,
    attempts: u32,
    error: String,
    event: RawEvent,
}

#[derive(Clone)]
pub struct DeadLetterQueue {
    path: String,
    recorded_events: Arc<Mutex<HashSet<String>>>,
}

impl DeadLetterQueue {
    pub async fn new(path: impl Into<String>) -> Result<Self> {
        let path = path.into();
        let mut recorded_events = HashSet::new();
        match tokio::fs::read(&path).await {
            Ok(contents) => {
                for line in contents.split(|byte| *byte == b'\n') {
                    if let Ok(record) = serde_json::from_slice::<DeadLetterRecord>(line) {
                        recorded_events.insert(event_key(&record.contract_id, &record.event_id));
                    }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }

        Ok(Self {
            path,
            recorded_events: Arc::new(Mutex::new(recorded_events)),
        })
    }

    pub async fn push(&self, event: &RawEvent, error: &str, attempts: u32) -> Result<bool> {
        let key = event_key(&event.contract_id, &event.id);
        let mut recorded_events = self.recorded_events.lock().await;
        if recorded_events.contains(&key) {
            return Ok(false);
        }

        let record = DeadLetterRecord {
            event_id: event.id.clone(),
            contract_id: event.contract_id.clone(),
            ledger: event.ledger,
            attempts,
            error: error.to_string(),
            event: event.clone(),
        };
        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .await?;
        file.write_all(&serde_json::to_vec(&record)?).await?;
        file.write_all(b"\n").await?;
        file.sync_all().await?;
        recorded_events.insert(key);
        Ok(true)
    }
}

fn event_key(contract_id: &str, event_id: &str) -> String {
    format!("{contract_id}:{event_id}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rpc::RawEvent;
    use tempfile::NamedTempFile;

    fn fake_event(id: &str, contract_id: &str, ledger: u32) -> RawEvent {
        RawEvent {
            kind: "contract".to_string(),
            ledger,
            ledger_closed_at: "2026-01-01T00:00:00Z".to_string(),
            contract_id: contract_id.to_string(),
            id: id.to_string(),
            paging_token: String::new(),
            topic: vec![],
            value: serde_json::Value::Null,
            tx_hash: String::new(),
        }
    }

    // ── Push and read back ────────────────────────────────────────────────────

    #[tokio::test]
    async fn push_and_read_back() {
        let tmp = NamedTempFile::new().unwrap();
        let path = tmp.path().to_str().unwrap().to_string();
        drop(tmp);

        let dlq = DeadLetterQueue::new(&path).await.unwrap();
        let event = fake_event("ev1", "CABC", 100);

        let new = dlq.push(&event, "decode failed", 3).await.unwrap();
        assert!(new, "first push should return true");

        // Reload from disk and verify the record is there.
        let dlq2 = DeadLetterQueue::new(&path).await.unwrap();
        // Attempting to push the same event on the reloaded queue returns false
        // because recorded_events is populated from the file.
        let duplicate = dlq2.push(&event, "decode failed", 3).await.unwrap();
        assert!(
            !duplicate,
            "same event read back from disk should be a duplicate"
        );

        let _ = tokio::fs::remove_file(&path).await;
    }

    // ── Duplicate event key ───────────────────────────────────────────────────

    #[tokio::test]
    async fn duplicate_event_key_is_deduplicated() {
        let tmp = NamedTempFile::new().unwrap();
        let path = tmp.path().to_str().unwrap().to_string();
        drop(tmp);

        let dlq = DeadLetterQueue::new(&path).await.unwrap();
        let event = fake_event("ev2", "CABC", 200);

        let first = dlq.push(&event, "err", 1).await.unwrap();
        let second = dlq.push(&event, "err again", 2).await.unwrap();

        assert!(first);
        assert!(!second, "duplicate push should return false");

        let _ = tokio::fs::remove_file(&path).await;
    }

    // ── Missing file ──────────────────────────────────────────────────────────

    #[tokio::test]
    async fn new_with_missing_file_starts_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("missing_dlq.ndjson");
        let path = path.to_str().unwrap().to_string();
        // File doesn't exist yet — new() should start with an empty set.

        let dlq = DeadLetterQueue::new(&path).await.unwrap();
        let event = fake_event("ev3", "CABC", 300);
        let new = dlq.push(&event, "err", 1).await.unwrap();
        assert!(new);
    }

    // ── Different contracts are independent ───────────────────────────────────

    #[tokio::test]
    async fn different_contracts_are_independent() {
        let tmp = NamedTempFile::new().unwrap();
        let path = tmp.path().to_str().unwrap().to_string();
        drop(tmp);

        let dlq = DeadLetterQueue::new(&path).await.unwrap();

        // Same event_id but different contract_id → distinct keys.
        let ev_a = fake_event("shared-id", "CABC", 1);
        let ev_b = fake_event("shared-id", "CDEF", 2);

        assert!(dlq.push(&ev_a, "err", 1).await.unwrap());
        assert!(dlq.push(&ev_b, "err", 1).await.unwrap());

        let _ = tokio::fs::remove_file(&path).await;
    }
}
