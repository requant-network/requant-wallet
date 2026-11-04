# Signed web and extension releases

## Trust boundary

The independent verifier must already be installed from a trusted distribution. A normal website and its service worker remain controlled by their serving host: a JavaScript self-check downloaded from that host does not solve this problem. The desktop wallet pins `release-trust.json` in its compiled Rust core; the extension pins the same root in its packaged WASM. The public key matches the native updater key. The signing key must stay outside the website host and Git. A compromised signing key or installed client is outside this guarantee.

A server can withhold updates, but cannot invent executable assets accepted by an existing trusted client. First-install authenticity still requires a trusted installer/store and independent verification of its publisher; this change does not turn a download from an already compromised host into a trusted first installation.

## Signed envelope

The publisher signs the exact UTF-8 manifest bytes with the existing Tauri Minisign signer (hashed Ed25519 mode). The envelope carries the raw manifest string and base64-encoded Minisign signature. Schema 1 binds purpose `requant-release-v1`, product (`web` or `extension`), network `test`, release version, minimum installed-client version, reviewed source commit and a unique relative path/byte-count/SHA-256 record for every asset. Product and network mismatches fail closed. Signatures are checked before parsing manifest contents. Traversal, duplicate paths, unknown schema fields, missing/extra web assets and excessive sizes are rejected.

A `.rqweb` file adds a base64 map of all web assets to that envelope. The desktop client verifies every asset before replacing its in-memory asset map. It serves that map through `wallet-verified://localhost/wallet/` (the WebView2 HTTPS custom-protocol equivalent on Windows), with no filesystem or network fallback. Its CSP forbids remote scripts, frames and workers. The verified frontend uses the existing native storage, signing and network adapter; it does not move private keys to a server or a browser website. Existing encrypted storage is preserved, and its revision checks reject competing writes between wallet windows. Close the verified window before updating the installed application.

Open **Settings → Signed web wallet → Open signed web bundle**, select the downloaded `.rqweb` file and wait for verification. A rejection runs no downloaded code and preserves the previous cache. Versions below the installed client or highest verified cached release are rejected. Each version is immutable; publish a new version for any rebuilt bundle. The public signed cache persists across process restarts. Android uses the signed APK; it does not launch a second, unprotected web wallet window.

The extension verifies both freshly fetched and cached update manifests through its installed WASM verifier. Old unsigned update offers are ignored. Downloading an unpacked update fetches only the expected same-origin immutable ZIP URL, refuses redirects, enforces the signed size and checks its SHA-256 before the trusted extension UI creates a download Blob. It never executes downloaded JavaScript inside MV3. Store installations keep the browser's signed update mechanism; unpacked installations require the user to replace files in the same folder and reload, preserving extension identity/storage.

An attacker controlling the server can freeze the newest available version; this is availability/freshness, not a forged signature. Cached anti-rollback state is local application data. Deleting that data removes its remembered high-water mark; the installed-version floor remains.

## Preparing a release

Use one successful reviewed build, align native/web/extension versions, and verify the source commit and pinned public key before signing. `scripts/prepare-update-release.mjs` now requires `--commit=FULL_REVIEWED_SHA` and `--extension-commit=FULL_REVIEWED_EXTENSION_SHA` and publishes a signed `extension.json` envelope plus `Requant-Web-Wallet_VERSION_testnet.rqweb`. The former unsigned extension feed is not a fallback. Existing native feeds retain their own platform signature handling.

For a web-only build, the desktop wallet repository provides:

```sh
node scripts/signed-release.mjs --directory=/absolute/dist-web \
  --product=web --version=0.5.3 --commit=FULL_REVIEWED_SHA \
  --key=/absolute/private-wallet-updater.key --output=/absolute/new-release.rqweb
```

For the extension, provide a fresh directory containing exactly `Requant-Wallet-Extension_VERSION_chromium-testnet.zip`, use `--product=extension` and write `extension.json`. Signing happens locally; neither script uploads or publishes anything. They refuse existing output files and symlink assets. Keep signed artifacts immutable. Publish artifacts before atomically replacing update feeds. Stage rollout with the installed clients before replacing a live feed.

Tests use an ephemeral test key whose private half is deleted; only its public key, message and signature fixture are committed. Production code cannot substitute a server-provided public key. Local tests cover real signature verification, wrong-root/product/version rejection, asset hashes, traversal, cached unsigned offers, tampered ZIPs and strict preparation boundaries. Native custom-protocol rendering and Android screenshot prevention also need platform acceptance checks on the release candidates.
