//! Phase 4 (debrid path): Real-Debrid & TorBox integration.
//!
//! Adds a deburrer service layer so addons configured with a debrid token
//! return direct, seekable URLs. These flow straight into the existing
//! `media_play` command and the in-app player — no torrent engine needed.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const DEBRID_USER_AGENT: &str = "MAXplorer/0.2 (debrid client)";

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DebridProvider {
    RealDebrid,
    TorBox,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebridConfig {
    pub provider: DebridProvider,
    pub api_key: String,
}

fn client() -> Result<Client, crate::error::AppError> {
    Client::builder()
        .user_agent(DEBRID_USER_AGENT)
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| crate::error::AppError::new("debrid", format!("HTTP client: {e}"), None))
}

fn build_magnet(info_hash: &str) -> String {
    const TRACKERS: &[&str] = &[
        "udp://tracker.opentrackr.org:1337/announce",
        "udp://open.demonii.com:1337/announce",
        "udp://exodus.desync.com:6969/announce",
        "udp://tracker.torrent.eu.org:451/announce",
        "udp://opentracker.io:6969/announce",
    ];
    let trackers = TRACKERS
        .iter()
        .map(|t| format!("&tr={}", urlencoding_encode(t)))
        .collect::<String>();
    format!("magnet:?xt=urn:btih:{info_hash}{trackers}")
}

fn urlencoding_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
        match byte {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{:02X}", byte)),
        }
    }
    out
}

fn normalize_hash(info_hash: &str) -> Result<String, String> {
    let clean: String = info_hash.trim().to_lowercase().replace('-', "");
    if clean.len() != 40 || !clean.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!("invalid info hash: {info_hash}"));
    }
    Ok(clean)
}

async fn realdebrid_unrestrict(
    client: &Client,
    api_key: &str,
    magnet: &str,
) -> Result<String, crate::error::AppError> {
    let add_response = client
        .post("https://api.real-debrid.com/rest/1.0/torrents/addMagnet")
        .header("Authorization", format!("Bearer {api_key}"))
        .form(&[("magnet", magnet)])
        .send()
        .await
        .map_err(|e| crate::error::AppError::new("debrid", format!("add magnet: {e}"), None))?;

    if !add_response.status().is_success() {
        let status = add_response.status();
        let text = add_response.text().await.unwrap_or_default();
        return Err(crate::error::AppError::new(
            "debrid",
            format!("Real-Debrid add magnet failed: HTTP {status} - {text}"),
            None,
        ));
    }

    #[derive(Deserialize)]
    struct RealDebridTorrentInfo {
        id: String,
        files: Vec<RealDebridFile>,
        links: Vec<String>,
        status: String,
    }
    #[derive(Deserialize)]
    struct RealDebridFile {
        id: u64,
        bytes: u64,
    }

    let torrent: RealDebridTorrentInfo = add_response
        .json()
        .await
        .map_err(|e| crate::error::AppError::new("debrid", format!("add magnet json: {e}"), None))?;

    let file_ids: Vec<String> = torrent.files.iter().map(|f| f.id.to_string()).collect();
    let select_response = client
        .post(format!("https://api.real-debrid.com/rest/1.0/torrents/selectFiles/{}", torrent.id))
        .header("Authorization", format!("Bearer {api_key}"))
        .form(&[("files", file_ids.join(","))])
        .send()
        .await
        .map_err(|e| crate::error::AppError::new("debrid", format!("select files: {e}"), None))?;

    if !select_response.status().is_success() {
        let status = select_response.status();
        let text = select_response.text().await.unwrap_or_default();
        return Err(crate::error::AppError::new(
            "debrid",
            format!("Real-Debrid select files failed: HTTP {status} - {text}"),
            None,
        ));
    }

    for _ in 0..60 {
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        let status_response = client
            .get(format!("https://api.real-debrid.com/rest/1.0/torrents/info/{}", torrent.id))
            .header("Authorization", format!("Bearer {api_key}"))
            .send()
            .await
            .map_err(|e| crate::error::AppError::new("debrid", format!("info poll: {e}"), None))?;

        if !status_response.status().is_success() {
            continue;
        }

        let info: RealDebridTorrentInfo = status_response
            .json()
            .await
            .map_err(|e| crate::error::AppError::new("debrid", format!("info json: {e}"), None))?;

        if info.status == "downloaded" || info.links.iter().any(|l| !l.is_empty()) {
            let largest_file = info
                .files
                .iter()
                .max_by_key(|f| f.bytes);
            if let Some(file) = largest_file {
                let link_idx = file.id as usize - 1;
                if link_idx < info.links.len() && !info.links[link_idx].is_empty() {
                    return Ok(info.links[link_idx].clone());
                }
            }
        }
    }

    Err(crate::error::AppError::new(
        "debrid",
        "Real-Debrid torrent did not become ready in time".to_string(),
        None,
    ))
}

async fn torbox_unrestrict(
    client: &Client,
    api_key: &str,
    magnet: &str,
) -> Result<String, crate::error::AppError> {
    let create_response = client
        .post("https://api.torbox.app/v1/api/torrent/create")
        .header("Authorization", format!("Bearer {api_key}"))
        .form(&[("magnet", magnet)])
        .send()
        .await
        .map_err(|e| crate::error::AppError::new("debrid", format!("torbox create: {e}"), None))?;

    if !create_response.status().is_success() {
        let status = create_response.status();
        let text = create_response.text().await.unwrap_or_default();
        return Err(crate::error::AppError::new(
            "debrid",
            format!("TorBox create failed: HTTP {status} - {text}"),
            None,
        ));
    }

    #[derive(Deserialize)]
    struct TorBoxTorrentInfo {
        id: String,
        files: Vec<TorBoxFile>,
    }
    #[derive(Deserialize)]
    struct TorBoxFile {
        size: u64,
        stream_url: Option<String>,
    }

    let torrent: TorBoxTorrentInfo = create_response
        .json()
        .await
        .map_err(|e| crate::error::AppError::new("debrid", format!("torbox json: {e}"), None))?;

    if let Some(file) = torrent.files.iter().max_by_key(|f| f.size) {
        if let Some(stream_url) = &file.stream_url {
            if !stream_url.is_empty() {
                return Ok(stream_url.clone());
            }
        }
    }

    for _ in 0..60 {
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        let status_response = client
            .get(format!("https://api.torbox.app/v1/api/torrent/info?id={}", torrent.id))
            .header("Authorization", format!("Bearer {api_key}"))
            .send()
            .await
            .map_err(|e| crate::error::AppError::new("debrid", format!("torbox info: {e}"), None))?;

        if !status_response.status().is_success() {
            continue;
        }

        #[derive(Deserialize)]
        struct TorBoxInfoResponse {
            data: TorBoxTorrentInfo,
        }
        let info: TorBoxInfoResponse = status_response
            .json()
            .await
            .map_err(|e| crate::error::AppError::new("debrid", format!("torbox info json: {e}"), None))?;

        if let Some(file) = info.data.files.iter().max_by_key(|f| f.size) {
            if let Some(stream_url) = &file.stream_url {
                if !stream_url.is_empty() {
                    return Ok(stream_url.clone());
                }
            }
        }
    }

    Err(crate::error::AppError::new(
        "debrid",
        "TorBox torrent did not become ready in time".to_string(),
        None,
    ))
}

/// Resolves a torrent info-hash via the configured debrid provider.
#[tauri::command]
pub async fn media_debrid_resolve(
    app: tauri::AppHandle,
    info_hash: String,
) -> Result<String, crate::error::AppError> {
    use tauri::Manager;
    let hash = normalize_hash(&info_hash)
        .map_err(|e| crate::error::AppError::new("debrid", e, None))?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| crate::error::AppError::new("debrid", format!("data dir: {e}"), None))?;
    let config_path = data_dir.join("debrid-config.json");
    let config: DebridConfig = if config_path.exists() {
        let content = tokio::fs::read_to_string(&config_path)
            .await
            .map_err(|e| crate::error::AppError::new("debrid", format!("read config: {e}"), None))?;
        serde_json::from_str(&content).map_err(|e| crate::error::AppError::new("debrid", format!("parse config: {e}"), None))?
    } else {
        return Err(crate::error::AppError::new(
            "debrid",
            "No debrid provider configured. Open Settings → Media to add Real-Debrid or TorBox API key.".to_string(),
            None,
        ));
    };

    let client = client()?;
    let magnet = build_magnet(&hash);

    let url = match config.provider {
        DebridProvider::RealDebrid => realdebrid_unrestrict(&client, &config.api_key, &magnet).await?,
        DebridProvider::TorBox => torbox_unrestrict(&client, &config.api_key, &magnet).await?,
    };
    Ok(url)
}

/// Saves debrid provider configuration.
#[tauri::command]
pub async fn media_debrid_save_config(
    app: tauri::AppHandle,
    config: DebridConfig,
) -> Result<(), crate::error::AppError> {
    use tauri::Manager;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| crate::error::AppError::new("debrid", format!("data dir: {e}"), None))?;
    tokio::fs::create_dir_all(&data_dir).await.map_err(|e| crate::error::AppError::new("debrid", format!("mkdir: {e}"), None))?;
    let config_path = data_dir.join("debrid-config.json");
    let content = serde_json::to_string_pretty(&config).map_err(|e| crate::error::AppError::new("debrid", format!("serialize: {e}"), None))?;
    tokio::fs::write(&config_path, content).await.map_err(|e| crate::error::AppError::new("debrid", format!("write config: {e}"), None))?;
    Ok(())
}

/// Reads current debrid configuration.
#[tauri::command]
pub async fn media_debrid_get_config(
    app: tauri::AppHandle,
) -> Result<Option<DebridConfig>, crate::error::AppError> {
    use tauri::Manager;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| crate::error::AppError::new("debrid", format!("data dir: {e}"), None))?;
    let config_path = data_dir.join("debrid-config.json");
    if !config_path.exists() {
        return Ok(None);
    }
    let content = tokio::fs::read_to_string(&config_path)
        .await
        .map_err(|e| crate::error::AppError::new("debrid", format!("read config: {e}"), None))?;
    let config: DebridConfig = serde_json::from_str(&content)
        .map_err(|e| crate::error::AppError::new("debrid", format!("parse config: {e}"), None))?;
    Ok(Some(config))
}

/// Tests a debrid API key by making a lightweight request.
#[tauri::command]
pub async fn media_debrid_test_key(
    provider: DebridProvider,
    api_key: String,
) -> Result<bool, crate::error::AppError> {
    let client = client()?;
    let url = match provider {
        DebridProvider::RealDebrid => "https://api.real-debrid.com/rest/1.0/user",
        DebridProvider::TorBox => "https://api.torbox.app/v1/api/user/me",
    };
    let response = client
        .get(url)
        .header("Authorization", format!("Bearer {api_key}"))
        .send()
        .await
        .map_err(|e| crate::error::AppError::new("debrid", format!("test key: {e}"), None))?;
    Ok(response.status().is_success())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn magnet_builder_includes_hash_and_trackers() {
        let magnet = build_magnet("08ADA5A7A6183AAE1E09D831DF6748D566095A10");
        assert!(magnet.starts_with("magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10"));
        assert!(magnet.contains("&tr="));
    }
}