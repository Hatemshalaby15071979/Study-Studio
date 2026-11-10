//! Helix Core sidecar: spawn it, read its handshake, proxy its HTTP API.
//!
//! The webview never talks to the core directly. Two reasons:
//!
//! 1. The port is chosen by the kernel at launch (`--port 0`), and Tauri's
//!    CSP `connect-src` is static — it cannot name a port that does not exist
//!    until the process starts.
//! 2. The bearer token is generated per launch. Keeping it in Rust means it
//!    is never written into the JavaScript context, a devtools console, or a
//!    crash report from the webview.
//!
//! The contract with the core is one line of stdout:
//! `{"event":"ready","port":54321,"token":"..."}`.

use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(20);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// The prefix that tells the TypeScript client "the service is not there",
/// as opposed to "the service said no".
const UNAVAILABLE: &str = "core-unavailable:";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreEndpoint {
    pub port: u16,
    pub token: String,
    pub url: String,
}

#[derive(Default)]
pub struct CoreHandle {
    endpoint: Mutex<Option<CoreEndpoint>>,
    child: Mutex<Option<CommandChild>>,
    error: Mutex<Option<String>>,
}

impl CoreHandle {
    pub fn endpoint(&self) -> Option<CoreEndpoint> {
        self.endpoint.lock().ok().and_then(|guard| guard.clone())
    }

    pub fn error(&self) -> Option<String> {
        self.error.lock().ok().and_then(|guard| guard.clone())
    }

    pub fn shutdown(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(child) = guard.take() {
                let _ = child.kill();
            }
        }
    }
}

/// Parse the one line the core prints before it starts serving.
///
/// Public so the cross-repo contract test (`tests/sidecar_contract.rs`) can
/// assert the real parser accepts the real sidecar's output, rather than a
/// copy of it that could drift.
pub fn parse_handshake(line: &str) -> Option<CoreEndpoint> {
    let value: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
    if value.get("event")?.as_str()? != "ready" {
        return None;
    }
    let port = value.get("port")?.as_u64()?;
    if port == 0 || port > u16::MAX as u64 {
        return None;
    }
    let port = port as u16;
    let token = value.get("token")?.as_str()?.to_string();
    Some(CoreEndpoint {
        port,
        token,
        url: format!("http://127.0.0.1:{port}"),
    })
}

/// Spawn the sidecar and wait for its handshake, in the background.
///
/// Failure is recorded rather than fatal: the app still opens, and every
/// quiz reports that scoring is unavailable instead of failing to start.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        match spawn_and_handshake(&app).await {
            Ok((endpoint, child)) => {
                let state = app.state::<CoreHandle>();
                if let Ok(mut guard) = state.child.lock() {
                    *guard = Some(child);
                };
                if let Ok(mut guard) = state.endpoint.lock() {
                    *guard = Some(endpoint);
                };
            }
            Err(message) => {
                eprintln!("[core] {message}");
                let state = app.state::<CoreHandle>();
                if let Ok(mut guard) = state.error.lock() {
                    *guard = Some(message);
                };
            }
        }
    });
}

async fn spawn_and_handshake(app: &AppHandle) -> Result<(CoreEndpoint, CommandChild), String> {
    let (mut rx, child) = app
        .shell()
        .sidecar("helix-core")
        .map_err(|e| format!("{UNAVAILABLE} the bundled helix-core sidecar is missing: {e}"))?
        .args(["--port", "0", "--handshake"])
        .spawn()
        .map_err(|e| format!("{UNAVAILABLE} could not start helix-core: {e}"))?;

    let deadline = tokio::time::Instant::now() + HANDSHAKE_TIMEOUT;

    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            let _ = child.kill();
            return Err(format!(
                "{UNAVAILABLE} helix-core did not report ready within {}s",
                HANDSHAKE_TIMEOUT.as_secs()
            ));
        }

        match tokio::time::timeout(remaining, rx.recv()).await {
            Ok(Some(CommandEvent::Stdout(bytes))) => {
                let line = String::from_utf8_lossy(&bytes);
                if let Some(endpoint) = parse_handshake(&line) {
                    return Ok((endpoint, child));
                }
            }
            Ok(Some(CommandEvent::Terminated(payload))) => {
                return Err(format!(
                    "{UNAVAILABLE} helix-core exited before it was ready (code {:?})",
                    payload.code
                ));
            }
            Ok(Some(_)) => continue,
            Ok(None) => {
                return Err(format!("{UNAVAILABLE} helix-core closed its output before reporting ready"))
            }
            Err(_) => {
                let _ = child.kill();
                return Err(format!(
                    "{UNAVAILABLE} helix-core did not report ready within {}s",
                    HANDSHAKE_TIMEOUT.as_secs()
                ));
            }
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreStatus {
    pub ready: bool,
    pub endpoint: Option<CoreEndpoint>,
    pub error: Option<String>,
}

/// Where the core is listening, or why it is not.
#[tauri::command]
pub fn core_status(state: State<'_, CoreHandle>) -> CoreStatus {
    CoreStatus {
        ready: state.endpoint().is_some(),
        endpoint: state.endpoint(),
        error: state.error(),
    }
}

/// Proxy one call to the core. The token is added here, never by the caller.
#[tauri::command]
pub async fn core_fetch(
    state: State<'_, CoreHandle>,
    path: String,
    method: String,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    if !path.starts_with("/v1/") || path.contains("://") {
        return Err(format!("refusing to proxy an unexpected path: {path}"));
    }

    let (url, token) = {
        let guard = state
            .endpoint
            .lock()
            .map_err(|_| format!("{UNAVAILABLE} the core handle is poisoned"))?;
        match guard.as_ref() {
            Some(endpoint) => (endpoint.url.clone(), endpoint.token.clone()),
            None => {
                let reason = state.error().unwrap_or_else(|| "Helix Core is not running".to_string());
                return Err(if reason.starts_with(UNAVAILABLE) {
                    reason
                } else {
                    format!("{UNAVAILABLE} {reason}")
                });
            }
        }
    };

    let client = reqwest::Client::new();
    let target = format!("{url}{path}");
    let mut request = match method.to_ascii_uppercase().as_str() {
        "GET" => client.get(target),
        "POST" => client.post(target),
        other => return Err(format!("unsupported method: {other}")),
    };
    request = request.bearer_auth(&token).timeout(REQUEST_TIMEOUT);
    if let Some(payload) = body {
        request = request.json(&payload);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("{UNAVAILABLE} Helix Core is not reachable: {e}"))?;

    let status = response.status();
    let value: serde_json::Value = response.json().await.unwrap_or(serde_json::Value::Null);

    if !status.is_success() {
        let detail = value
            .get("detail")
            .and_then(|d| d.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| format!("Helix Core returned HTTP {}", status.as_u16()));
        return Err(detail);
    }

    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_handshake_line() {
        let endpoint = parse_handshake(r#"{"event":"ready","port":54321,"token":"abc"}"#).unwrap();
        assert_eq!(
            endpoint,
            CoreEndpoint {
                port: 54321,
                token: "abc".to_string(),
                url: "http://127.0.0.1:54321".to_string(),
            }
        );
    }

    #[test]
    fn ignores_uvicorn_log_lines() {
        assert!(parse_handshake("INFO:     Started server process [1234]").is_none());
        assert!(parse_handshake("").is_none());
        assert!(parse_handshake(r#"{"event":"starting","port":1}"#).is_none());
    }

    #[test]
    fn rejects_an_impossible_port() {
        assert!(parse_handshake(r#"{"event":"ready","port":0,"token":"abc"}"#).is_none());
        assert!(parse_handshake(r#"{"event":"ready","port":70000,"token":"abc"}"#).is_none());
    }

    #[test]
    fn rejects_a_handshake_without_a_token() {
        assert!(parse_handshake(r#"{"event":"ready","port":5000}"#).is_none());
    }
}
