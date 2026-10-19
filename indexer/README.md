# DukaPay Standalone Event Indexer

> **Experimental:** this standalone Rust indexer is not production-ready. The
> supported deployment remains the backend's in-process indexer until this
> crate has completed operational validation. No Kubernetes deployment is
> provided for this experimental component.

High-throughput Soroban contract-event indexer written in Rust. It is an
experimental alternative to the in-process TypeScript indexer and is not yet
the production indexing path.

## Why

| | TS in-process indexer | This crate |
|---|---|---|
| Fetch | serial, single loop | one async task per contract |
| Decode | serial, blocks event loop | worker pool (`INDEXER_WORKER_CONCURRENCY`) |
| Scaling | vertical only | deterministic contract sharding across replicas |
| Backpressure | none | bounded channel + per-range ack |
| Delivery | best effort | at-least-once via durable checkpoints |
| Output | direct DB writes + pub/sub | pluggable sink (stdout / file / Kafka) |
| Health | logs | Prometheus `/metrics` (lag, throughput, errors) |

## Run

```bash
export INDEXER_RPC_URL=https://soroban-testnet.stellar.org
export INDEXER_CONTRACT_IDS=CAAA...,CBBB...
export INDEXER_SINK=stdout
cargo run --release
```

The configured sink emits `DecodedEvent` NDJSON. Kafka output is optional and
requires an independently operated consumer; the backend does not currently
depend on a Kafka consumer for correctness.

## Configuration (all env vars)

| Var | Default | Notes |
|---|---|---|
| `INDEXER_RPC_URL` | – (required) | falls back to `STELLAR_RPC_URL` |
| `INDEXER_CONTRACT_IDS` | – (required) | comma-separated |
| `INDEXER_FINALITY_DEPTH` | `5` | ledgers to stay behind the tip |
| `INDEXER_POLL_INTERVAL_MS` | `3000` | |
| `INDEXER_BATCH_SIZE` | `200` | `getEvents` page limit |
| `INDEXER_WORKER_CONCURRENCY` | `8` | decode/emit parallelism |
| `INDEXER_MAX_EVENT_RETRIES` | `3` | retries after the initial event processing attempt |
| `INDEXER_DEAD_LETTER_FILE` | `./dead-letter.ndjson` | durable NDJSON queue for events that exhaust retries |
| `INDEXER_CHANNEL_CAPACITY` | `10000` | fetch→worker backpressure buffer |
| `INDEXER_SHARD_INDEX` | `0` | integer, or pod name ending `-<n>` |
| `INDEXER_SHARD_TOTAL` | `1` | replica count |
| `INDEXER_CHECKPOINT_DSN` / `DATABASE_URL` | – | Postgres; if unset uses a file |
| `INDEXER_CHECKPOINT_FILE` | `./checkpoints.json` | |
| `INDEXER_SINK` | `stdout` | `stdout` \| `file` \| `kafka` |
| `INDEXER_SINK_FILE` | `./events.ndjson` | |
| `INDEXER_KAFKA_BROKERS` | – | required for `kafka` sink |
| `INDEXER_KAFKA_TOPIC` | `dukapay.contract-events` | |
| `INDEXER_METRICS_PORT` | `9464` | `/metrics`, `/healthz`, `/readyz` |
| `INDEXER_LAG_ALERT_THRESHOLD` | `100` | flips `indexer_lag_ok` gauge |
| `INDEXER_LOG` | `info` | `tracing` env filter |
| `INDEXER_LOG_FORMAT` | text | set `json` for structured logs |

Kafka support requires building with `--features kafka`.

## Metrics

- `indexer_ledger_lag{contract_id}`: ledgers behind the safe tip (HPA signal)
- `indexer_last_processed_ledger{contract_id}`
- `indexer_events_processed_total{contract_id,event_type}`: throughput
- `indexer_fetch_errors_total`, `indexer_process_errors_total`: error rate
- `indexer_failed_events_total`, `indexer_dead_letter_events_total`: exhausted event retries and durable dead-letter writes
- `indexer_sink_writes_total`
- `indexer_lag_ok`: 1/0 against `INDEXER_LAG_ALERT_THRESHOLD`

## Deployment status

There is no supported Kubernetes deployment for this experimental component.
Run it manually or package it for your own environment only after reviewing
its checkpoint and sink configuration.

## Delivery semantics

At-least-once. A checkpoint for `(shard, contract)` only advances after every
event in the range has been emitted to the sink. Exhausted events are stored in
`INDEXER_DEAD_LETTER_FILE`, but the checkpoint remains held until the event can
be emitted successfully. Dead-letter records are deduplicated by contract and
event ID. Consumers must dedupe on `(id)`; `shard` is included on each event to
make cross-replica dedupe trivial.
