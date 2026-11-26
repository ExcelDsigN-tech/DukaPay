//! Output sinks for decoded events. Downstream consumers (the TypeScript backend,
//! analytics, alerting) read from here instead of hammering the RPC directly.

use crate::config::SinkBackend;
use anyhow::Result;
use serde::Serialize;
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

/// Normalised event shape written to the sink. Intentionally close to the
/// TypeScript `SorobanRawEvent` so the existing backend consumer needs no
/// remapping.
#[derive(Debug, Clone, Serialize)]
pub struct DecodedEvent {
    pub id: String,
    pub paging_token: String,
    pub contract_id: String,
    pub event_type: String,
    pub ledger: u32,
    pub ledger_closed_at: String,
    pub tx_hash: String,
    pub topics: Vec<String>,
    pub value: serde_json::Value,
    /// Shard that produced this event; lets consumers dedupe across replicas.
    pub shard: u32,
}

#[derive(Clone)]
pub enum Sink {
    Stdout,
    File(Arc<Mutex<tokio::fs::File>>),
    #[cfg(feature = "kafka")]
    Kafka {
        producer: Arc<rdkafka::producer::FutureProducer>,
        topic: String,
    },
}

impl Sink {
    pub async fn connect(backend: &SinkBackend) -> Result<Self> {
        match backend {
            SinkBackend::Stdout => Ok(Sink::Stdout),
            SinkBackend::File { path } => {
                let f = tokio::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(path)
                    .await?;
                Ok(Sink::File(Arc::new(Mutex::new(f))))
            }
            #[cfg(feature = "kafka")]
            SinkBackend::Kafka { brokers, topic } => {
                use rdkafka::config::ClientConfig;
                let producer = ClientConfig::new()
                    .set("bootstrap.servers", brokers)
                    .set("message.timeout.ms", "10000")
                    .set("compression.type", "lz4")
                    .set("enable.idempotence", "true")
                    .create()?;
                Ok(Sink::Kafka {
                    producer: Arc::new(producer),
                    topic: topic.clone(),
                })
            }
            #[cfg(not(feature = "kafka"))]
            SinkBackend::Kafka { .. } => {
                anyhow::bail!("kafka sink requested but binary built without the `kafka` feature")
            }
        }
    }

    pub async fn emit(&self, event: &DecodedEvent) -> Result<()> {
        let line = serde_json::to_string(event)?;
        match self {
            Sink::Stdout => {
                write_line(&mut tokio::io::stdout(), &line).await?;
            }
            Sink::File(f) => {
                let mut f = f.lock().await;
                write_line(&mut *f, &line).await?;
            }
            #[cfg(feature = "kafka")]
            Sink::Kafka { producer, topic } => {
                use rdkafka::producer::FutureRecord;
                let key = event.contract_id.clone();
                producer
                    .send(
                        FutureRecord::to(topic).key(&key).payload(&line),
                        std::time::Duration::from_secs(10),
                    )
                    .await
                    .map_err(|(e, _)| anyhow::anyhow!("kafka send: {e}"))?;
            }
        }
        Ok(())
    }
}

async fn write_line(writer: &mut (impl AsyncWriteExt + Unpin), line: &str) -> Result<()> {
    writer.write_all(line.as_bytes()).await?;
    writer.write_all(b"\n").await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event() -> DecodedEvent {
        DecodedEvent {
            id: "event-1".to_string(),
            paging_token: "page-1".to_string(),
            contract_id: "CTEST".to_string(),
            event_type: "LoanCreated".to_string(),
            ledger: 42,
            ledger_closed_at: "2026-11-25T00:00:00Z".to_string(),
            tx_hash: "tx-hash".to_string(),
            topics: vec!["AAAADwAAAAh0cmFuc2Zlcg==".to_string()],
            value: serde_json::json!({ "amount": 100 }),
            shard: 2,
        }
    }

    #[tokio::test]
    async fn stdout_backend_writes_one_ndjson_line() {
        assert!(matches!(
            Sink::connect(&SinkBackend::Stdout).await.unwrap(),
            Sink::Stdout
        ));

        let mut out = Vec::new();
        write_line(&mut out, &serde_json::to_string(&event()).unwrap())
            .await
            .unwrap();
        let output = String::from_utf8(out).unwrap();

        assert!(output.ends_with('\n'));
        assert_eq!(output.lines().count(), 1);
        let line: serde_json::Value = serde_json::from_str(output.trim()).unwrap();
        assert_eq!(line["id"], "event-1");
        assert_eq!(line["event_type"], "LoanCreated");
        assert_eq!(line["contract_id"], "CTEST");
        assert_eq!(line["shard"], 2);
    }

    #[tokio::test]
    async fn file_sink_appends_one_ndjson_line() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.ndjson");
        let sink = Sink::connect(&SinkBackend::File {
            path: path.to_string_lossy().into_owned(),
        })
        .await
        .unwrap();

        sink.emit(&event()).await.unwrap();

        let output = tokio::fs::read_to_string(&path).await.unwrap();
        assert_eq!(output.lines().count(), 1);
        let line: serde_json::Value = serde_json::from_str(output.trim()).unwrap();
        assert_eq!(line["id"], "event-1");
    }

    #[cfg(not(feature = "kafka"))]
    #[tokio::test]
    async fn kafka_backend_without_feature_returns_an_error() {
        let error = match Sink::connect(&SinkBackend::Kafka {
            brokers: "localhost:9092".to_string(),
            topic: "dukapay.contract-events".to_string(),
        })
        .await
        {
            Ok(_) => panic!("kafka sink must be rejected without the feature"),
            Err(error) => error,
        };

        assert!(error
            .to_string()
            .contains("binary built without the `kafka` feature"));
    }
}
