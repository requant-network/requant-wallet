import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { platform } from "../web/src/platform";
export default function VerifiedWeb({ blocked }: { blocked: boolean }) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  if (
    /Android/i.test(navigator.userAgent) ||
    location.protocol === "wallet-verified:" ||
    location.hostname === "wallet-verified.localhost"
  )
    return null;
  return (
    <section className="card wallet-updates" aria-live="polite">
      <h2>Signed web wallet</h2>
      <p className="muted small">
        Open a downloaded .rqweb bundle. The installed wallet verifies the
        release signature and every asset before running it. Your wallets stay
        in this application's storage.
      </p>
      <button
        className="button"
        disabled={busy || blocked}
        onClick={async () => {
          setBusy(true);
          setStatus("");
          try {
            const file = await platform()?.pick?.(48 * 1024 * 1024);
            if (file) {
              setStatus("Verifying signed release…");
              const version = await invoke<string>("open_verified_web", {
                bundle: file.text,
              });
              setStatus(`Opened verified web wallet ${version}.`);
            }
          } catch (e) {
            setStatus(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Verifying…" : "Open signed web bundle"}
      </button>
      {status && <p role="status">{status}</p>}
    </section>
  );
}
