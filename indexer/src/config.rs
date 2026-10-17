//! Runtime configuration, loaded entirely from environment variables so the
//! indexer can be deployed as a stateless, horizontally scalable service.

use anyhow::{Context, Result};
use std::time::Duration;

#[derive(Clone, Debug)]
pub struct Config {
    /// Soroban-RPC endpoint (e.g. https://soroban-testnet.stellar.org).
    pub rpc_url: String,
    /// Contract IDs to index. At least one is required.
    pub contract_ids: Vec<String>,
    /// Number of ledgers to stay behind the tip before treating events as final.
    pub finality_depth: u32,
    /// How often to poll the RPC for new events.
    pub poll_interval: Duration,
    /// Max ledgers requested per `getEvents` page.
    pub batch_size: u32,
    /// Number of parallel workers draining the event channel.
    pub worker_concurrency: usize,
    /// Retries after the initial attempt before a failed event is dead-lettered.
    pub max_event_retries: u32,
    /// NDJSON file used to durably record events that exhaust retries.
    pub dead_letter_file: String,
    /// Bounded channel capacity between the fetcher and the workers.
    pub channel_capacity: usize,
    /// Optional shard config for horizontal scaling: (shard_index, shard_total).
    /// A contract is processed by shard `crc(contract_id) % shard_total`.
    pub shard: (u32, u32),
    /// Where checkpoints are persisted.
    pub checkpoint: CheckpointBackend,
    /// Where decoded events are emitted.
    pub sink: SinkBackend,
    /// Port for the Prometheus `/metrics` + `/healthz` server.
    pub metrics_port: u16,
    /// Alert threshold (in ledgers) used only to flip the `indexer_lag_ok` gauge.
    pub lag_alert_threshold: i64,
}

#[derive(Clone, Debug)]
pub enum CheckpointBackend {
    /// JSON file on a persistent volume, fine for single-replica deployments.
    File { path: String },
    /// Postgres row per (shard, contract), required for multi-replica.
    Postgres { url: String },
}

#[derive(Clone, Debug)]
pub enum SinkBackend {
    Stdout,
    /// Newline-delimited JSON appended to a file.
    File {
        path: String,
    },
    /// Kafka topic (requires the `kafka` cargo feature).
    Kafka {
        #[cfg_attr(not(feature = "kafka"), allow(dead_code))]
        brokers: String,
        #[cfg_attr(not(feature = "kafka"), allow(dead_code))]
        topic: String,
    },
}

fn env(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.trim().is_empty())
}

fn env_or(key: &str, default: &str) -> String {
    env(key).unwrap_or_else(|| default.to_string())
}

fn parse<T: std::str::FromStr>(key: &str, default: T) -> Result<T>
where
    T::Err: std::fmt::Display,
{
    match env(key) {
        None => Ok(default),
        Some(raw) => raw
            .parse::<T>()
            .map_err(|e| anyhow::anyhow!("invalid {key}: {e}")),
    }
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let rpc_url = env("INDEXER_RPC_URL")
            .or_else(|| env("STELLAR_RPC_URL"))
            .context("INDEXER_RPC_URL (or STELLAR_RPC_URL) is required")?;

        let contract_ids: Vec<String> = env("INDEXER_CONTRACT_IDS")
            .context("INDEXER_CONTRACT_IDS is required (comma-separated)")?
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        anyhow::ensure!(!contract_ids.is_empty(), "INDEXER_CONTRACT_IDS is empty");

        // Accepts a plain integer, or a StatefulSet pod name like
        // "dukapay-indexer-2" from which the trailing ordinal is extracted.
        let shard_index: u32 = match env("INDEXER_SHARD_INDEX") {
            None => 0,
            Some(raw) => raw
                .parse::<u32>()
                .or_else(|_| raw.rsplit('-').next().unwrap_or("").parse::<u32>())
                .context(
                    "INDEXER_SHARD_INDEX must be an integer or pod name ending in -<ordinal>",
                )?,
        };
        let shard_total: u32 = parse("INDEXER_SHARD_TOTAL", 1)?;
        anyhow::ensure!(shard_total >= 1, "INDEXER_SHARD_TOTAL must be >= 1");
        anyhow::ensure!(
            shard_index < shard_total,
            "INDEXER_SHARD_INDEX must be < INDEXER_SHARD_TOTAL"
        );

        let checkpoint = match env("INDEXER_CHECKPOINT_DSN").or_else(|| env("DATABASE_URL")) {
            Some(url) => CheckpointBackend::Postgres { url },
            None => CheckpointBackend::File {
                path: env_or("INDEXER_CHECKPOINT_FILE", "./checkpoints.json"),
            },
        };

        let sink = match env_or("INDEXER_SINK", "stdout").as_str() {
            "stdout" => SinkBackend::Stdout,
            "file" => SinkBackend::File {
                path: env_or("INDEXER_SINK_FILE", "./events.ndjson"),
            },
            "kafka" => SinkBackend::Kafka {
                brokers: env("INDEXER_KAFKA_BROKERS").context("INDEXER_KAFKA_BROKERS required")?,
                topic: env_or("INDEXER_KAFKA_TOPIC", "dukapay.contract-events"),
            },
            other => anyhow::bail!("unknown INDEXER_SINK: {other}"),
        };

        Ok(Self {
            rpc_url,
            contract_ids,
            finality_depth: parse("INDEXER_FINALITY_DEPTH", 5)?,
            poll_interval: Duration::from_millis(parse("INDEXER_POLL_INTERVAL_MS", 3000u64)?),
            batch_size: parse("INDEXER_BATCH_SIZE", 200)?,
            worker_concurrency: parse("INDEXER_WORKER_CONCURRENCY", 8usize)?,
            max_event_retries: parse("INDEXER_MAX_EVENT_RETRIES", 3u32)?,
            dead_letter_file: env_or("INDEXER_DEAD_LETTER_FILE", "./dead-letter.ndjson"),
            channel_capacity: parse("INDEXER_CHANNEL_CAPACITY", 10_000usize)?,
            shard: (shard_index, shard_total),
            checkpoint,
            sink,
            metrics_port: parse("INDEXER_METRICS_PORT", 9464u16)?,
            lag_alert_threshold: parse("INDEXER_LAG_ALERT_THRESHOLD", 100i64)?,
        })
    }

    /// Deterministic shard assignment for a contract ID.
    pub fn owns_contract(&self, contract_id: &str) -> bool {
        let (idx, total) = self.shard;
        if total == 1 {
            return true;
        }
        let crc = contract_id
            .bytes()
            .fold(0u32, |acc, b| acc.wrapping_mul(31).wrapping_add(b as u32));
        crc % total == idx
    }

    /// Contract IDs this replica is responsible for.
    pub fn owned_contracts(&self) -> Vec<String> {
        self.contract_ids
            .iter()
            .filter(|c| self.owns_contract(c))
            .cloned()
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // All tests that mutate process env must hold this lock for their duration.
    // Without it, parallel test threads race on env vars and flake.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    /// Clear all INDEXER_* and STELLAR_RPC_URL vars, then set the given ones.
    /// Holds `ENV_LOCK` for the entire operation so tests are serialized.
    fn isolated_env<F: FnOnce() -> Result<Config>>(
        vars: &[(&str, &str)],
        f: F,
    ) -> Result<Config> {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());

        let all_keys = [
            "INDEXER_RPC_URL",
            "STELLAR_RPC_URL",
            "INDEXER_CONTRACT_IDS",
            "INDEXER_SHARD_INDEX",
            "INDEXER_SHARD_TOTAL",
            "INDEXER_CHECKPOINT_DSN",
            "DATABASE_URL",
            "INDEXER_CHECKPOINT_FILE",
            "INDEXER_SINK",
            "INDEXER_SINK_FILE",
            "INDEXER_KAFKA_BROKERS",
            "INDEXER_KAFKA_TOPIC",
            "INDEXER_FINALITY_DEPTH",
            "INDEXER_POLL_INTERVAL_MS",
            "INDEXER_BATCH_SIZE",
            "INDEXER_WORKER_CONCURRENCY",
            "INDEXER_MAX_EVENT_RETRIES",
            "INDEXER_DEAD_LETTER_FILE",
            "INDEXER_CHANNEL_CAPACITY",
            "INDEXER_METRICS_PORT",
            "INDEXER_LAG_ALERT_THRESHOLD",
        ];

        let saved: Vec<(String, Option<String>)> = all_keys
            .iter()
            .map(|k| (k.to_string(), std::env::var(k).ok()))
            .collect();

        for k in &all_keys {
            // SAFETY: single-threaded by ENV_LOCK.
            unsafe { std::env::remove_var(k) };
        }
        for (k, v) in vars {
            // SAFETY: single-threaded by ENV_LOCK.
            unsafe { std::env::set_var(k, v) };
        }

        let result = f();

        for (k, prev) in &saved {
            match prev {
                Some(v) => unsafe { std::env::set_var(k, v) },
                None => unsafe { std::env::remove_var(k) },
            }
        }

        result
    }

    fn minimal_vars() -> Vec<(&'static str, &'static str)> {
        vec![
            ("INDEXER_RPC_URL", "https://soroban-testnet.stellar.org"),
            ("INDEXER_CONTRACT_IDS", "CABC,CDEF"),
        ]
    }

    // ── RPC URL resolution ────────────────────────────────────────────────────

    #[test]
    fn uses_indexer_rpc_url_when_set() {
        let cfg = isolated_env(
            &[
                ("INDEXER_RPC_URL", "https://primary.example.com"),
                ("STELLAR_RPC_URL", "https://fallback.example.com"),
                ("INDEXER_CONTRACT_IDS", "CABC"),
            ],
            Config::from_env,
        )
        .unwrap();
        assert_eq!(cfg.rpc_url, "https://primary.example.com");
    }

    #[test]
    fn falls_back_to_stellar_rpc_url_when_indexer_rpc_url_absent() {
        let cfg = isolated_env(
            &[
                ("STELLAR_RPC_URL", "https://fallback.stellar.org"),
                ("INDEXER_CONTRACT_IDS", "CABC"),
            ],
            Config::from_env,
        )
        .unwrap();
        assert_eq!(cfg.rpc_url, "https://fallback.stellar.org");
    }

    #[test]
    fn fails_when_neither_rpc_url_is_set() {
        let err = isolated_env(&[("INDEXER_CONTRACT_IDS", "CABC")], Config::from_env)
            .unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("INDEXER_RPC_URL") || msg.contains("STELLAR_RPC_URL"),
            "unexpected error: {msg}"
        );
    }

    // ── Required variables ────────────────────────────────────────────────────

    #[test]
    fn fails_when_contract_ids_missing() {
        let err = isolated_env(
            &[("INDEXER_RPC_URL", "https://soroban-testnet.stellar.org")],
            Config::from_env,
        )
        .unwrap_err();
        assert!(err.to_string().contains("INDEXER_CONTRACT_IDS"));
    }

    #[test]
    fn fails_when_contract_ids_is_blank() {
        let err = isolated_env(
            &[
                ("INDEXER_RPC_URL", "https://soroban-testnet.stellar.org"),
                ("INDEXER_CONTRACT_IDS", "   "),
            ],
            Config::from_env,
        )
        .unwrap_err();
        assert!(err.to_string().contains("INDEXER_CONTRACT_IDS"));
    }

    // ── Defaults ─────────────────────────────────────────────────────────────

    #[test]
    fn default_values_are_applied() {
        let cfg = isolated_env(&minimal_vars(), Config::from_env).unwrap();
        assert_eq!(cfg.finality_depth, 5);
        assert_eq!(cfg.poll_interval, Duration::from_millis(3000));
        assert_eq!(cfg.batch_size, 200);
        assert_eq!(cfg.worker_concurrency, 8);
        assert_eq!(cfg.max_event_retries, 3);
        assert_eq!(cfg.channel_capacity, 10_000);
        assert_eq!(cfg.metrics_port, 9464);
        assert_eq!(cfg.lag_alert_threshold, 100);
    }

    #[test]
    fn default_checkpoint_backend_is_file() {
        let cfg = isolated_env(&minimal_vars(), Config::from_env).unwrap();
        assert!(
            matches!(cfg.checkpoint, CheckpointBackend::File { .. }),
            "expected File checkpoint backend"
        );
    }

    #[test]
    fn default_sink_is_stdout() {
        let cfg = isolated_env(&minimal_vars(), Config::from_env).unwrap();
        assert!(matches!(cfg.sink, SinkBackend::Stdout));
    }

    #[test]
    fn default_shard_is_0_of_1() {
        let cfg = isolated_env(&minimal_vars(), Config::from_env).unwrap();
        assert_eq!(cfg.shard, (0, 1));
    }

    // ── Invalid values ────────────────────────────────────────────────────────

    #[test]
    fn invalid_finality_depth_returns_error() {
        let mut vars = minimal_vars();
        vars.push(("INDEXER_FINALITY_DEPTH", "not_a_number"));
        let err = isolated_env(&vars, Config::from_env).unwrap_err();
        assert!(err.to_string().contains("INDEXER_FINALITY_DEPTH"));
    }

    #[test]
    fn unknown_sink_returns_error() {
        let mut vars = minimal_vars();
        vars.push(("INDEXER_SINK", "grpc"));
        let err = isolated_env(&vars, Config::from_env).unwrap_err();
        assert!(err.to_string().contains("INDEXER_SINK"));
    }

    // ── Shard pod-name parsing ────────────────────────────────────────────────

    #[test]
    fn shard_index_parsed_from_pod_name() {
        let mut vars = minimal_vars();
        vars.push(("INDEXER_SHARD_INDEX", "dukapay-indexer-2"));
        vars.push(("INDEXER_SHARD_TOTAL", "5"));
        let cfg = isolated_env(&vars, Config::from_env).unwrap();
        assert_eq!(cfg.shard, (2, 5));
    }

    #[test]
    fn shard_index_must_be_less_than_total() {
        let mut vars = minimal_vars();
        vars.push(("INDEXER_SHARD_INDEX", "5"));
        vars.push(("INDEXER_SHARD_TOTAL", "5"));
        let err = isolated_env(&vars, Config::from_env).unwrap_err();
        assert!(
            err.to_string().contains("INDEXER_SHARD_INDEX")
                || err.to_string().contains("INDEXER_SHARD_TOTAL")
        );
    }

    // ── owns_contract / owned_contracts ──────────────────────────────────────

    #[test]
    fn single_shard_owns_all_contracts() {
        let cfg = isolated_env(&minimal_vars(), Config::from_env).unwrap();
        assert!(cfg.owns_contract("CABC"));
        assert!(cfg.owns_contract("CDEF"));
        assert_eq!(cfg.owned_contracts().len(), 2);
    }
}
