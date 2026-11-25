//! Minimal async Soroban-RPC client. Only the two JSON-RPC methods the indexer
//! needs are implemented: `getLatestLedger` and `getEvents`.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Clone)]
pub struct SorobanRpc {
    http: reqwest::Client,
    url: String,
}

#[derive(Debug, Deserialize)]
struct JsonRpcResponse<T> {
    result: Option<T>,
    error: Option<JsonRpcError>,
}

#[derive(Debug, Deserialize)]
struct JsonRpcError {
    code: i64,
    message: String,
}

#[derive(Debug, Deserialize)]
pub struct LatestLedger {
    pub sequence: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawEvent {
    #[serde(rename = "type")]
    pub kind: String,
    pub ledger: u32,
    #[serde(rename = "ledgerClosedAt")]
    pub ledger_closed_at: String,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub id: String,
    #[serde(rename = "pagingToken", default)]
    pub paging_token: String,
    #[serde(default)]
    pub topic: Vec<String>,
    #[serde(default)]
    pub value: serde_json::Value,
    #[serde(rename = "txHash", default)]
    pub tx_hash: String,
}

#[derive(Debug, Deserialize)]
pub struct GetEventsResult {
    #[serde(default)]
    pub events: Vec<RawEvent>,
    /// Network tip reported alongside the page; retained for observability.
    #[serde(rename = "latestLedger", default)]
    #[allow(dead_code)]
    pub latest_ledger: u32,
    #[serde(rename = "cursor", default)]
    pub cursor: Option<String>,
}

impl SorobanRpc {
    pub fn new(url: impl Into<String>) -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .expect("reqwest client"),
            url: url.into(),
        }
    }

    async fn call<T: for<'de> Deserialize<'de>>(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<T> {
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
        let resp: JsonRpcResponse<T> = self
            .http
            .post(&self.url)
            .json(&body)
            .send()
            .await
            .with_context(|| format!("rpc {method} transport"))?
            .error_for_status()
            .with_context(|| format!("rpc {method} http status"))?
            .json()
            .await
            .with_context(|| format!("rpc {method} decode"))?;

        if let Some(err) = resp.error {
            anyhow::bail!("rpc {method} error {}: {}", err.code, err.message);
        }
        resp.result.context("rpc response missing result")
    }

    pub async fn latest_ledger(&self) -> Result<u32> {
        let r: LatestLedger = self.call("getLatestLedger", json!({})).await?;
        Ok(r.sequence)
    }

    /// Fetch events for the given contracts in [start_ledger, ..] up to a page.
    /// Soroban-RPC caps the ledger span; the caller drives pagination by cursor.
    pub async fn get_events(
        &self,
        start_ledger: u32,
        contract_ids: &[String],
        cursor: Option<&str>,
        limit: u32,
    ) -> Result<GetEventsResult> {
        let mut filter = json!({
            "type": "contract",
            "contractIds": contract_ids,
        });
        let mut pagination = json!({ "limit": limit });
        match cursor {
            Some(c) => {
                pagination["cursor"] = json!(c);
            }
            None => {
                filter["startLedger"] = json!(start_ledger);
            }
        }
        let params = json!({ "filters": [filter], "pagination": pagination });
        self.call("getEvents", params).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{body_json, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn rpc(server: &MockServer) -> SorobanRpc {
        SorobanRpc::new(server.uri())
    }

    #[tokio::test]
    async fn latest_ledger_sends_the_jsonrpc_envelope() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/"))
            .and(body_json(json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "getLatestLedger",
                "params": {},
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": { "sequence": 1234 },
            })))
            .expect(1)
            .mount(&server)
            .await;

        assert_eq!(rpc(&server).latest_ledger().await.unwrap(), 1234);
    }

    #[tokio::test]
    async fn first_events_page_uses_start_ledger_and_no_cursor() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/"))
            .and(body_json(json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "getEvents",
                "params": {
                    "filters": [{ "type": "contract", "contractIds": ["CTEST"], "startLedger": 100 }],
                    "pagination": { "limit": 25 },
                },
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": { "events": [], "latestLedger": 120, "cursor": "page-2" },
            })))
            .expect(1)
            .mount(&server)
            .await;

        let page = rpc(&server)
            .get_events(100, &["CTEST".to_string()], None, 25)
            .await
            .unwrap();

        assert!(page.events.is_empty());
        assert_eq!(page.latest_ledger, 120);
        assert_eq!(page.cursor.as_deref(), Some("page-2"));
    }

    #[tokio::test]
    async fn cursor_page_omits_start_ledger_and_returns_events() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/"))
            .and(body_json(json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "getEvents",
                "params": {
                    "filters": [{ "type": "contract", "contractIds": ["CTEST"] }],
                    "pagination": { "cursor": "page-2", "limit": 25 },
                },
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "events": [{
                        "type": "contract",
                        "ledger": 101,
                        "ledgerClosedAt": "2026-11-25T00:00:00Z",
                        "contractId": "CTEST",
                        "id": "0000000000000123456-0000000001",
                        "pagingToken": "page-3",
                        "topic": ["AAAADwAAAAh0cmFuc2Zlcg=="],
                        "value": "AAAAAQ==",
                        "txHash": "tx-hash",
                    }],
                    "latestLedger": 121,
                },
            })))
            .expect(1)
            .mount(&server)
            .await;

        let page = rpc(&server)
            .get_events(100, &["CTEST".to_string()], Some("page-2"), 25)
            .await
            .unwrap();

        assert_eq!(page.events.len(), 1);
        assert_eq!(page.events[0].kind, "contract");
        assert_eq!(page.events[0].id, "0000000000000123456-0000000001");
        assert_eq!(page.events[0].paging_token, "page-3");
        assert_eq!(page.events[0].topic, vec!["AAAADwAAAAh0cmFuc2Zlcg=="]);
        assert_eq!(page.cursor, None);
    }

    #[tokio::test]
    async fn jsonrpc_error_is_mapped_with_method_and_code() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/"))
            .and(body_json(json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "getLatestLedger",
                "params": {},
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "jsonrpc": "2.0",
                "id": 1,
                "error": { "code": -32602, "message": "invalid params" },
            })))
            .expect(1)
            .mount(&server)
            .await;

        let error = rpc(&server).latest_ledger().await.unwrap_err();

        assert_eq!(
            error.to_string(),
            "rpc getLatestLedger error -32602: invalid params"
        );
    }
}
