//! The trust root is shipped in the installed client, never fetched from a server.
use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
type Result<T> = std::result::Result<T, String>;
pub const MAX_BUNDLE: usize = 48 * 1024 * 1024;
const MAX_ASSET: usize = 16 * 1024 * 1024;
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReleaseFile {
    pub path: String,
    pub bytes: usize,
    pub sha256: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReleaseManifest {
    pub schema: u32,
    pub purpose: String,
    pub product: String,
    pub network: String,
    pub version: String,
    pub min_client: String,
    pub source_commit: String,
    pub files: Vec<ReleaseFile>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignedManifest {
    pub manifest: String,
    pub signature: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WebBundle {
    manifest: String,
    signature: String,
    files: BTreeMap<String, String>,
}
pub fn version(v: &str) -> Result<[u32; 3]> {
    let parts: Vec<_> = v.split('.').collect();
    if parts.len() != 3 {
        return Err("Invalid release version.".into());
    }
    let mut n = [0; 3];
    for (i, p) in parts.iter().enumerate() {
        if p.is_empty()
            || p.len() > 9
            || !p.bytes().all(|b| b.is_ascii_digit())
            || (p.len() > 1 && p.starts_with('0'))
        {
            return Err("Invalid release version.".into());
        }
        n[i] = p.parse().map_err(|_| "Invalid release version.")?;
    }
    Ok(n)
}
fn path_ok(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 240
        && path
            .split('/')
            .all(|p| !p.is_empty() && p != "." && p != "..")
        && path
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"/-_.".contains(&c))
}
pub fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
fn verify_with_key(
    raw: &str,
    signature: &str,
    product: &str,
    floor: &str,
    client: &str,
    key: &str,
) -> Result<ReleaseManifest> {
    if raw.len() > 256 * 1024 || signature.len() > 4096 {
        return Err("Release manifest exceeds the limit.".into());
    }
    let sig = STANDARD
        .decode(signature)
        .map_err(|_| "Invalid release signature.")?;
    let sig = std::str::from_utf8(&sig).map_err(|_| "Invalid release signature.")?;
    PublicKey::from_base64(key)
        .and_then(|k| Signature::decode(sig).and_then(|s| k.verify(raw.as_bytes(), &s, false)))
        .map_err(|_| "Release signature verification failed.")?;
    let m: ReleaseManifest =
        serde_json::from_str(raw).map_err(|_| "Invalid signed release manifest.")?;
    if m.schema != 1
        || m.purpose != "requant-release-v1"
        || m.product != product
        || m.network != "test"
        || m.source_commit.len() != 40
        || !m.source_commit.bytes().all(|b| b.is_ascii_hexdigit())
        || m.files.is_empty()
        || m.files.len() > 1024
    {
        return Err("Unsupported signed release manifest.".into());
    }
    if version(&m.version)? < version(floor)? {
        return Err("Release rollback refused.".into());
    }
    if version(&m.min_client)? > version(client)? {
        return Err("Update the installed wallet before opening this release.".into());
    }
    let mut seen = HashSet::new();
    let mut total = 0usize;
    for f in &m.files {
        if !path_ok(&f.path)
            || !seen.insert(&f.path)
            || f.bytes > MAX_ASSET
            || f.sha256.len() != 64
            || !f.sha256.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err("Invalid release asset.".into());
        }
        total = total
            .checked_add(f.bytes)
            .filter(|n| *n <= 32 * 1024 * 1024)
            .ok_or("Release assets exceed the limit.")?;
    }
    Ok(m)
}
pub fn verify_manifest(
    raw: &str,
    signature: &str,
    product: &str,
    floor: &str,
    client: &str,
) -> Result<ReleaseManifest> {
    #[derive(Deserialize)]
    struct Trust {
        public_key: String,
    }
    let trust: Trust = serde_json::from_str(include_str!("../../../release-trust.json"))
        .map_err(|_| "Invalid installed trust root.")?;
    verify_with_key(raw, signature, product, floor, client, &trust.public_key)
}
pub fn verify_web_bundle(
    text: &str,
    floor: &str,
    client: &str,
) -> Result<(ReleaseManifest, BTreeMap<String, Vec<u8>>)> {
    if text.len() > MAX_BUNDLE {
        return Err("Web bundle exceeds the limit.".into());
    }
    let b: WebBundle = serde_json::from_str(text).map_err(|_| "Invalid signed web bundle.")?;
    let m = verify_manifest(&b.manifest, &b.signature, "web", floor, client)?;
    verify_assets(&m, b.files).map(|files| (m, files))
}
fn verify_assets(
    m: &ReleaseManifest,
    files: BTreeMap<String, String>,
) -> Result<BTreeMap<String, Vec<u8>>> {
    if files.len() != m.files.len() || !files.contains_key("index.html") {
        return Err("Web bundle asset list mismatch.".into());
    }
    let mut result = BTreeMap::new();
    for f in &m.files {
        let encoded = files.get(&f.path).ok_or("Missing signed web asset.")?;
        if encoded.len() > MAX_ASSET * 4 / 3 + 4 {
            return Err("Web asset exceeds the limit.".into());
        }
        let bytes = STANDARD
            .decode(encoded)
            .map_err(|_| "Invalid encoded web asset.")?;
        if bytes.len() != f.bytes || sha256(&bytes) != f.sha256 {
            return Err("Web asset hash verification failed.".into());
        }
        result.insert(f.path.clone(), bytes);
    }
    Ok(result)
}
pub fn invoke(v: &serde_json::Value) -> Result<serde_json::Value> {
    let s = |k: &str| v[k].as_str().ok_or_else(|| format!("Missing {k}."));
    let m = verify_manifest(
        s("manifest")?,
        s("signature")?,
        "extension",
        s("floor")?,
        s("client")?,
    )?;
    serde_json::to_value(m).map_err(|_| "Cannot read verified release.".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strict_paths_versions_and_asset_binding() {
        for p in ["../key", "/index.html", "a/../b", "a//b", "a%2fb", "a\\b"] {
            assert!(!path_ok(p));
        }
        for v in ["01.2.3", "1.2", "1.2.3-beta", "1.2.3.4"] {
            assert!(version(v).is_err());
        }
        let m = ReleaseManifest {
            schema: 1,
            purpose: "requant-release-v1".into(),
            product: "web".into(),
            network: "test".into(),
            version: "0.5.3".into(),
            min_client: "0.5.3".into(),
            source_commit: "ab".repeat(20),
            files: vec![ReleaseFile {
                path: "index.html".into(),
                bytes: 2,
                sha256: sha256(b"ok"),
            }],
        };
        let mut files = BTreeMap::from([("index.html".into(), STANDARD.encode(b"ok"))]);
        assert!(verify_assets(&m, files.clone()).is_ok());
        files.insert("index.html".into(), STANDARD.encode(b"no"));
        assert!(verify_assets(&m, files.clone()).is_err());
        files.insert("extra.js".into(), String::new());
        assert!(verify_assets(&m, files).is_err());
    }
    #[test]
    fn genuine_signature_tampering_cross_product_and_rollback() {
        let f: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/signed-release.json")).unwrap();
        let raw = f["manifest"].as_str().unwrap();
        let sig = f["signature"].as_str().unwrap();
        let key = f["public_key"].as_str().unwrap();
        assert!(verify_with_key(raw, sig, "web", "0.5.3", "0.5.3", key).is_ok());
        assert!(verify_with_key(
            &raw.replace("index.html", "other.html"),
            sig,
            "web",
            "0.5.3",
            "0.5.3",
            key
        )
        .is_err());
        assert!(verify_with_key(raw, sig, "extension", "0.5.3", "0.5.3", key).is_err());
        assert!(verify_with_key(raw, sig, "web", "0.5.4", "0.5.3", key).is_err());
        assert!(verify_with_key(raw, sig, "web", "0.5.3", "0.5.2", key).is_err());
        assert!(verify_manifest(raw, sig, "web", "0.5.3", "0.5.3").is_err()); // Test key is not the installed production key.
    }
    #[test]
    fn forged_server_manifest_fails_closed() {
        assert!(verify_manifest("{}", "", "web", "0.5.3", "0.5.3").is_err());
    }
}
