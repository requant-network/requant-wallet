# ReCast Connect v1

Wallet 0.5.1 adds the same Website connections screen to the web wallet, native desktop/Android UI and the Chromium extension. It uses the existing wallet's first receive key, supports encrypted HD and legacy wallets, and refuses watch-only approval. It does not create a separate ReCast recovery account, request a transfer or expose keys/passwords to the website.

## Use

In ReCast choose Connect RQT wallet. Open the official web wallet or copy the connection link into Website connections in the extension/app. Review the complete website origin, test network, selected wallet, purpose and expiry. For a channel update, review every document field. Enter the local wallet password and explicitly approve, or reject. Return to ReCast. A channel save requires a separate wallet approval; login alone does not authorize arbitrary signed documents or transfers.

The web URL fragment is removed after it is read and is never sent to the wallet web server. No connection capability, approval password or plaintext private key is persisted by the connection screen. Existing encrypted wallet storage and the updater verification key are unchanged. Extension access requires an explicit browser permission for the site; native network access uses a constrained Rust relay, without relaxing its WebView CSP. The web/extension production CSP allows the current ReCast origin `https://147.90.15.89`; a new origin needs an intentional policy update.

## Protocol

The browser creates a five-minute pairing. The relay stores only hashes of two independent 256-bit capabilities. The wallet capability may read, approve or reject its specific request. The separate browser capability may claim or cancel it and never appears in the wallet link. Request/response bodies are bounded, redirects and cookies are refused, and only the approval/read endpoints have no-credential CORS.

The `recastApprove` Rust operation accepts only `recast-connect-v1` on Requant testnet with a fresh nonce/expiry and a relay-matching origin. It builds canonical ReCast authentication bytes itself. Channel approvals validate ownership and every field and reproduce the canonical channel bytes. There is no arbitrary message/transaction argument. Ed25519 signing stays on the device; only a public key and signature are relayed. Pending approvals are invalidated when the selected wallet/lock generation changes.

Server approval is atomic and binds the original request. Claims are idempotent: the same HMAC-derived session token can be reconstructed without storing plaintext credentials, but a revoked/expired session cannot be recreated or extended. Login sessions last at most 24 hours. Channel claims return a verified signature to the existing signed, versioned and idempotent channel-write path. User rejection and browser cancellation prevent subsequent approval.

## Verification and limits

Tests use newly generated unfunded wallets and mocked chain broadcasts, never user keys or real transfers. Rust tests verify real signatures, wallet ownership, canonical Unicode/HTML escaping, wrong origin/network, expiry, watch-only and unsupported-purpose rejection. Node tests cover URL parsing, capability handling, credential omission and payload boundaries. ReCast browser integration creates a real encrypted RQT wallet, approves login and separately signs a channel; another test loads the actual extension/background worker in isolated Chromium. The local extension fixture adds only its loopback test host; production permissions are unchanged.

This is an implemented, tested integration, not a security audit. Native packages must be reviewed and signed with the existing private updater key using `scripts/prepare-update-release.mjs` before publishing automatic updates. Do not generate a replacement key or bypass updater verification. Windows/macOS/Android artifacts come from the existing cross-platform CI workflow; native UI behavior still needs device-specific acceptance testing.
