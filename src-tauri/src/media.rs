//! Media mode: Stremio addon protocol client.
//!
//! Addons in the Stremio ecosystem are URLs serving JSON. A manifest declares
//! the catalogs and resource types an addon provides; catalogs and metas are
//! fetched over HTTP by convention:
//!   {base}/{resource}/{type}/{id}.json  →  { metas: [...] }
//!
//! Phase 1 keeps this a thin, dependency-light client (reqwest + serde). The
//! full stremio-core embed (torrent engine, library sync) lands in later phases.

use crate::error::AppError;
use serde::{Deserialize, Serialize};

const DEFAULT_USER_AGENT: &str = "MAXplorer/0.2 (Stremio addon client)";

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ManifestCatalog {
    #[serde(rename = "type")]
    pub kind: String,
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra: Vec<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub types: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub catalogs: Vec<ManifestCatalog>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub resources: Vec<serde_json::Value>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CatalogMeta {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default, rename = "type")]
    pub kind: Option<String>,
    #[serde(default)]
    pub poster: Option<String>,
    #[serde(default)]
    pub background: Option<String>,
    #[serde(default)]
    pub logo: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub release_info: Option<String>,
    #[serde(default)]
    pub imdb_rating: Option<String>,
}

fn client() -> Result<reqwest::Client, crate::error::AppError> {
    reqwest::Client::builder()
        .user_agent(DEFAULT_USER_AGENT)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| AppError::new("media", format!("HTTP client: {error}"), None))
}

async fn get_json<T: serde::de::DeserializeOwned>(url: &str) -> Result<T, AppError> {
    let client = client()?;
    let response = client.get(url).send().await.map_err(|error| {
        AppError::new("media", format!("Request failed: {error}"), None)
    })?;
    let status = response.status();
    if !status.is_success() {
        return Err(AppError::new(
            "media",
            format!("Addon responded with HTTP {status}"),
            None,
        ));
    }
    response.json::<T>().await.map_err(|error| {
        AppError::new("media", format!("Invalid addon response: {error}"), None)
    })
}

fn manifest_url(raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.ends_with("manifest.json") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/manifest.json")
    }
}

/// Fetches and validates an addon manifest.
#[tauri::command]
pub async fn media_addon_manifest(url: String) -> Result<Manifest, crate::error::AppError> {
    get_json::<Manifest>(&manifest_url(&url)).await
}

#[derive(Debug, Serialize)]
pub struct CatalogResponse {
    pub metas: Vec<CatalogMeta>,
}

/// Fetches one catalog page: {base}/catalog/{type}/{catalogId}.json.
#[tauri::command]
pub async fn media_catalog(
    url: String,
    r#type: String,
    catalog_id: String,
) -> Result<CatalogResponse, crate::error::AppError> {
    let base = url.trim().trim_end_matches('/');
    let request_url = format!("{base}/catalog/{type}/{catalog_id}.json");
    let raw = get_json::<serde_json::Value>(&request_url).await?;
    // Catalogs use `metas`; some addons return bare arrays. Accept both.
    let metas = if let Some(list) = raw.get("metas").and_then(|value| value.as_array()) {
        list.clone()
    } else if let Some(list) = raw.as_array() {
        list.clone()
    } else {
        Vec::new()
    };
    let metas = metas
        .into_iter()
        .filter_map(|value| serde_json::from_value::<CatalogMeta>(value).ok())
        .collect();
    Ok(CatalogResponse { metas })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_url_appends_manifest_path() {
        assert_eq!(
            manifest_url("https://v3-cinemeta.strem.io"),
            "https://v3-cinemeta.strem.io/manifest.json"
        );
        assert_eq!(
            manifest_url("https://example.com/manifest.json"),
            "https://example.com/manifest.json"
        );
        assert_eq!(
            manifest_url("https://example.com/"),
            "https://example.com/manifest.json"
        );
    }

    #[test]
    fn manifest_parses_cinemeta_shape() {
        let json = serde_json::json!({
            "id": "org.stremio.cinemeta",
            "name": "Cinemeta",
            "version": "3.0.0",
            "types": ["movie", "series"],
            "catalogs": [
                { "type": "movie", "id": "top", "name": "Popular" }
            ],
            "resources": ["catalog", "meta"]
        });
        let manifest: Manifest = serde_json::from_value(json).expect("parse");
        assert_eq!(manifest.id, "org.stremio.cinemeta");
        assert_eq!(manifest.catalogs.len(), 1);
        assert_eq!(manifest.catalogs[0].name, "Popular");
    }

    #[test]
    fn catalog_meta_parses_optional_fields() {
        let meta: CatalogMeta = serde_json::from_value(serde_json::json!({
            "id": "tt10648173",
            "name": "Thor: Love and Thunder",
            "poster": "https://images.metahub.space/poster/medium/tt10648173/background",
            "releaseInfo": "2022",
            "imdbRating": "6.2"
        }))
        .expect("parse");
        assert_eq!(meta.name.as_deref(), Some("Thor: Love and Thunder"));
        assert_eq!(meta.release_info.as_deref(), Some("2022"));
        assert!(meta.description.is_none());
    }
}
