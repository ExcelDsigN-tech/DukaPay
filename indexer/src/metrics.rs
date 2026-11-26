//! Prometheus metrics + a tiny HTTP server exposing `/metrics` and `/healthz`.
//! Health signals: lag (ledgers behind tip), throughput (events/sec via counter
//! rate), error rate (fetch/process error counters).

use anyhow::Result;
use http_body_util::Full;
use hyper::body::Bytes;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use once_cell::sync::Lazy;
use prometheus::{
    register_int_counter, register_int_counter_vec, register_int_gauge, register_int_gauge_vec,
    Encoder, IntCounter, IntCounterVec, IntGauge, IntGaugeVec, TextEncoder,
};
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::net::TcpListener;

pub static LEDGER_LAG: Lazy<IntGaugeVec> = Lazy::new(|| {
    register_int_gauge_vec!(
        "indexer_ledger_lag",
        "Ledgers between the last processed ledger and the network tip",
        &["contract_id"]
    )
    .unwrap()
});

pub static LAG_OK: Lazy<IntGauge> = Lazy::new(|| {
    register_int_gauge!(
        "indexer_lag_ok",
        "1 when all contracts are within the lag alert threshold, else 0"
    )
    .unwrap()
});

pub static LAST_PROCESSED_LEDGER: Lazy<IntGaugeVec> = Lazy::new(|| {
    register_int_gauge_vec!(
        "indexer_last_processed_ledger",
        "Last fully processed ledger per contract",
        &["contract_id"]
    )
    .unwrap()
});

pub static EVENTS_PROCESSED: Lazy<IntCounterVec> = Lazy::new(|| {
    register_int_counter_vec!(
        "indexer_events_processed_total",
        "Contract events decoded and emitted to the sink",
        &["contract_id", "event_type"]
    )
    .unwrap()
});

pub static FETCH_ERRORS: Lazy<IntCounter> =
    Lazy::new(|| register_int_counter!("indexer_fetch_errors_total", "RPC fetch errors").unwrap());

pub static PROCESS_ERRORS: Lazy<IntCounter> = Lazy::new(|| {
    register_int_counter!(
        "indexer_process_errors_total",
        "Errors while decoding or emitting an event"
    )
    .unwrap()
});

pub static FAILED_EVENTS: Lazy<IntCounter> = Lazy::new(|| {
    register_int_counter!(
        "indexer_failed_events_total",
        "Events that exhausted processing retries"
    )
    .unwrap()
});

pub static DEAD_LETTER_EVENTS: Lazy<IntCounter> = Lazy::new(|| {
    register_int_counter!(
        "indexer_dead_letter_events_total",
        "Events durably recorded in the dead-letter queue"
    )
    .unwrap()
});

pub static SINK_WRITES: Lazy<IntCounter> = Lazy::new(|| {
    register_int_counter!("indexer_sink_writes_total", "Successful sink writes").unwrap()
});

pub static READY_GAUGE: Lazy<IntGauge> =
    Lazy::new(|| register_int_gauge!("indexer_ready", "1 when the indexer is ready").unwrap());

static READY: AtomicBool = AtomicBool::new(false);

pub fn set_ready(v: bool) {
    READY.store(v, Ordering::Relaxed);
    READY_GAUGE.set(i64::from(v));
}

async fn handle<B>(req: Request<B>) -> Result<Response<Full<Bytes>>> {
    let resp = match req.uri().path() {
        "/metrics" => {
            let mut buf = Vec::new();
            let encoder = TextEncoder::new();
            encoder.encode(&prometheus::gather(), &mut buf)?;
            Response::builder()
                .header("content-type", encoder.format_type())
                .body(Full::new(Bytes::from(buf)))?
        }
        "/healthz" => Response::new(Full::new(Bytes::from("ok"))),
        "/readyz" => {
            if READY.load(Ordering::Relaxed) {
                Response::new(Full::new(Bytes::from("ready")))
            } else {
                Response::builder()
                    .status(StatusCode::SERVICE_UNAVAILABLE)
                    .body(Full::new(Bytes::from("starting")))?
            }
        }
        _ => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Full::new(Bytes::from("not found")))?,
    };
    Ok(resp)
}

pub async fn serve(port: u16) -> Result<()> {
    let listener = TcpListener::bind(("0.0.0.0", port)).await?;
    tracing::info!(port, "metrics server listening");
    serve_listener(listener).await
}

async fn serve_listener(listener: TcpListener) -> Result<()> {
    loop {
        let (stream, _) = listener.accept().await?;
        let io = TokioIo::new(stream);
        tokio::spawn(async move {
            if let Err(e) = hyper::server::conn::http1::Builder::new()
                .serve_connection(io, service_fn(handle))
                .await
            {
                tracing::debug!(error = %e, "metrics connection closed");
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    static READY_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    fn request(path: &str) -> Request<()> {
        Request::builder().uri(path).body(()).unwrap()
    }

    fn body(response: Response<Full<Bytes>>) -> String {
        String::from_utf8(response.into_body().into_inner().expect("body").to_vec()).unwrap()
    }

    fn ready_gauge() -> i64 {
        prometheus::gather()
            .iter()
            .find(|family| family.get_name() == "indexer_ready")
            .and_then(|family| family.get_metric().first())
            .map(|metric| metric.get_gauge().get_value() as i64)
            .unwrap_or_else(|| panic!("indexer_ready metric is missing"))
    }

    #[tokio::test]
    async fn set_ready_flips_readiness_gauge_and_probe() {
        let _guard = READY_LOCK.lock().await;

        set_ready(false);
        let response = handle(request("/readyz")).await.unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body(response), "starting");
        assert_eq!(ready_gauge(), 0);

        set_ready(true);
        let response = handle(request("/readyz")).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(body(response), "ready");
        assert_eq!(ready_gauge(), 1);

        set_ready(false);
        assert_eq!(ready_gauge(), 0);
    }

    #[tokio::test]
    async fn serve_exposes_metrics_health_and_readiness() {
        let _guard = READY_LOCK.lock().await;
        set_ready(true);

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(serve_listener(listener));
        let client = reqwest::Client::new();
        let base = format!("http://127.0.0.1:{port}");

        let metrics = client.get(format!("{base}/metrics")).send().await.unwrap();
        assert_eq!(metrics.status().as_u16(), 200);
        assert!(metrics
            .headers()
            .get("content-type")
            .unwrap()
            .to_str()
            .unwrap()
            .contains("text/plain"));
        assert!(metrics.text().await.unwrap().contains("indexer_ready 1"));

        let health = client.get(format!("{base}/healthz")).send().await.unwrap();
        assert_eq!(health.status().as_u16(), 200);
        assert_eq!(health.text().await.unwrap(), "ok");

        let ready = client.get(format!("{base}/readyz")).send().await.unwrap();
        assert_eq!(ready.status().as_u16(), 200);
        assert_eq!(ready.text().await.unwrap(), "ready");

        let missing = client.get(format!("{base}/missing")).send().await.unwrap();
        assert_eq!(missing.status().as_u16(), 404);

        server.abort();
        let _ = server.await;
        set_ready(false);
    }
}
