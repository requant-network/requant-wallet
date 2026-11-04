//! Signed assets are served from memory; this protocol never reads a URL as a file path.
use requant_browser_core::releases::{self, ReleaseManifest};
use std::{collections::BTreeMap, fs, io::Write, path::PathBuf, sync::Mutex};
use tauri::{
    http::{Request, Response},
    Manager, State,
};
type Result<T> = std::result::Result<T, String>;
pub struct VerifiedWeb {
    pub directory: PathBuf,
    pub(super) assets: BTreeMap<String, Vec<u8>>,
    opening: bool,
}
impl VerifiedWeb {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            directory,
            assets: BTreeMap::new(),
            opening: false,
        }
    }
    fn prepare(&mut self, bundle: &str, client: &str) -> Result<ReleaseManifest> {
        let path = self.directory.join("verified-web.rqweb");
        let mut floor = client.to_string();
        let previous = if path.exists() {
            let file =
                fs::File::open(&path).map_err(|_| "Cannot read cached signed web bundle.")?;
            use std::io::Read;
            let mut text = String::new();
            file.take(releases::MAX_BUNDLE as u64 + 1)
                .read_to_string(&mut text)
                .map_err(|_| "Cannot read cached signed web bundle.")?;
            let (manifest, _) = releases::verify_web_bundle(&text, "0.0.0", client)?;
            if releases::version(&manifest.version)? > releases::version(&floor)? {
                floor = manifest.version.clone();
            }
            Some((manifest.version, text))
        } else {
            None
        };
        let (manifest, assets) = releases::verify_web_bundle(bundle, &floor, client)?;
        if let Some((version, text)) = previous {
            if version == manifest.version && text != bundle {
                return Err("A release version is immutable. Refusing a different bundle with the same version.".into());
            }
        }
        let tmp = self.directory.join(format!(
            ".verified-{}.tmp",
            hex::encode(requant_wallet_core::crypto::random::<8>()?)
        ));
        let result = (|| {
            let mut opts = fs::OpenOptions::new();
            opts.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                opts.mode(0o600);
            }
            let mut f = opts
                .open(&tmp)
                .map_err(|_| "Cannot stage signed web bundle.")?;
            f.write_all(bundle.as_bytes())
                .and_then(|_| f.sync_all())
                .map_err(|_| "Cannot save signed web bundle.")?;
            fs::rename(&tmp, &path).map_err(|_| "Cannot replace cached signed web bundle.")?;
            Ok::<_, String>(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(tmp);
        }
        result?;
        self.assets = assets;
        Ok(manifest)
    }
}
const CSP:&str="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src ipc: http://ipc.localhost https://ipc.localhost; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'";
pub fn serve(req: &Request<Vec<u8>>, assets: &BTreeMap<String, Vec<u8>>) -> Response<Vec<u8>> {
    let path = req.uri().path().strip_prefix("/wallet/").unwrap_or("");
    let body = if req.method() == "GET" {
        assets.get(path)
    } else {
        None
    };
    let mime = match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "wasm" => "application/wasm",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    };
    Response::builder()
        .status(if body.is_some() { 200 } else { 404 })
        .header("Content-Type", mime)
        .header("Content-Security-Policy", CSP)
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "no-store")
        .body(body.cloned().unwrap_or_default())
        .expect("constant response headers")
}
#[tauri::command]
pub fn verified_web_active(app: tauri::AppHandle) -> bool {
    app.get_webview_window("verified-wallet").is_some()
        || app
            .state::<Mutex<VerifiedWeb>>()
            .lock()
            .map(|state| state.opening)
            .unwrap_or(true)
}
#[tauri::command]
pub async fn open_verified_web(
    app: tauri::AppHandle,
    state: State<'_, Mutex<VerifiedWeb>>,
    bundle: String,
) -> Result<String> {
    #[cfg(not(desktop))]
    {
        let _ = (app, state, bundle);
        Err("Signed web bundles open in the desktop wallet. Android uses the signed APK.".into())
    }
    #[cfg(desktop)]
    {
        if verified_web_active(app.clone()) {
            return Err("Close the verified web wallet before opening another bundle.".into());
        }
        let manifest = {
            let mut state = state.lock().map_err(|_| "Signed web wallet is busy.")?;
            if state.opening {
                return Err("Another signed web wallet is opening.".into());
            }
            let manifest = state.prepare(&bundle, &app.package_info().version.to_string())?;
            state.opening = true;
            manifest
        };
        let opened = tauri::WebviewWindowBuilder::new(
            &app,
            "verified-wallet",
            tauri::WebviewUrl::CustomProtocol(
                "wallet-verified://localhost/wallet/index.html"
                    .parse()
                    .map_err(|_| "Invalid verified wallet URL.")?,
            ),
        )
        .title(format!(
            "Requant Wallet · verified web {}",
            manifest.version
        ))
        .inner_size(1180., 820.)
        .use_https_scheme(true)
        .on_navigation(|url| {
            (url.scheme() == "wallet-verified" && url.host_str() == Some("localhost"))
                || (url.scheme() == "https" && url.host_str() == Some("wallet-verified.localhost"))
        })
        .build();
        state
            .lock()
            .map_err(|_| "Signed web wallet is busy.")?
            .opening = false;
        opened.map_err(|_| "Cannot open verified web wallet.")?;
        Ok(manifest.version)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejected_bundle_preserves_assets_and_cache() {
        let dir = tempfile::tempdir().unwrap();
        let mut state = VerifiedWeb::new(dir.path().to_owned());
        state
            .assets
            .insert("index.html".into(), b"previous".to_vec());
        assert!(state
            .prepare(
                "{\"manifest\":\"{}\",\"signature\":\"\",\"files\":{}}",
                "0.5.3"
            )
            .is_err());
        assert_eq!(state.assets["index.html"], b"previous");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }
    #[test]
    fn protocol_has_no_filesystem_or_network_fallback() {
        let assets = BTreeMap::from([("index.html".into(), b"signed".to_vec())]);
        for path in [
            "/etc/passwd",
            "/wallet/../wallets.json",
            "/wallet/%2e%2e/wallets.json",
            "/wallet/missing.js",
        ] {
            assert_eq!(
                serve(&Request::builder().uri(path).body(vec![]).unwrap(), &assets).status(),
                404
            );
        }
        let response = serve(
            &Request::builder()
                .uri("/wallet/index.html")
                .body(vec![])
                .unwrap(),
            &assets,
        );
        assert_eq!(response.status(), 200);
        assert_eq!(response.body(), b"signed");
        assert!(response.headers()["Content-Security-Policy"]
            .to_str()
            .unwrap()
            .contains("worker-src 'none'"));
    }
}
