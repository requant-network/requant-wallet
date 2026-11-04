import { useEffect, useRef, useState } from "react";
import * as api from "./service";
import { platform } from "./platform";
import { connection, relay, validateRequest } from "./recast.mjs";
export default function RecastConnect({
  wallet,
  reset,
}: {
  wallet: api.PublicWallet;
  reset: number;
}) {
  const epoch = useRef(0);
  const [input, setInput] = useState(() => {
    const hash = location.hash;
    if (!hash.startsWith("#recast=")) return "";
    history.replaceState(null, "", location.pathname + location.search);
    try {
      return decodeURIComponent(hash.slice(8));
    } catch {
      return "";
    }
  });
  const [review, setReview] = useState<any>(),
    [source, setSource] = useState<ReturnType<typeof connection>>(),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState(false);
  useEffect(() => {
    epoch.current++;
    setPassword("");
    setReview(undefined);
    setSource(undefined);
    setDone(false);
  }, [reset, wallet.id]);
  useEffect(() => {
    const clear = () => {
      if (document.hidden) setPassword("");
    };
    document.addEventListener("visibilitychange", clear);
    return () => document.removeEventListener("visibilitychange", clear);
  }, []);
  async function load() {
    setError("");
    setBusy(true);
    try {
      const next = connection(input);
      const request = validateRequest(
        await relay(next, "read", undefined, platform()),
        next,
      );
      setSource(next);
      setReview(request);
      setDone(request.approved === true);
      setInput("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not read ReCast request.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function approve() {
    if (!source || !review) return;
    const current = epoch.current;
    setBusy(true);
    setError("");
    try {
      validateRequest(review, source);
      const result = await api.core<{ public_key: string; signature: string }>(
        "recastApprove",
        {
          file: api.wallet(wallet.id).file,
          password,
          request: review,
          source_origin: source.origin,
          now: Math.floor(Date.now() / 1000),
        },
      );
      if (current !== epoch.current || document.hidden)
        throw new Error(
          "Wallet changed or locked. Review the connection again.",
        );
      validateRequest(review, source);
      await relay(
        source,
        "approve",
        { public_key: result.public_key, signature: result.signature },
        platform(),
      );
      setDone(true);
      setReview(undefined);
      setSource(undefined);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not approve ReCast request.",
      );
    } finally {
      setPassword("");
      setBusy(false);
    }
  }
  async function reject() {
    if (!source) return;
    setBusy(true);
    try {
      await relay(source, "reject", undefined, platform());
      setReview(undefined);
      setSource(undefined);
      setPassword("");
      setError("Request rejected.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reject request.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>ReCast website connections</h2>
      <p>
        Approve sign-in and channel updates with this wallet. No payment is
        made. Your keys and password stay on this device.
      </p>
      {done ? (
        <p role="status">Approved. Return to ReCast.</p>
      ) : review ? (
        <>
          <p>
            Website: <strong>{source?.origin}</strong>
          </p>
          <p>
            Network: <strong>Requant testnet</strong>
          </p>
          <p>
            Wallet: <code>{wallet.meta.address}</code>
          </p>
          <h3>
            {review.intent === "login"
              ? "Sign in to ReCast"
              : "Approve channel update"}
          </h3>
          {review.document && (
            <dl>
              {Object.entries(review.document).map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd className="recast-value">{String(value)}</dd>
                </div>
              ))}
            </dl>
          )}
          <p>
            Expires: {new Date(review.expires_at * 1000).toLocaleTimeString()}
          </p>
          <label className="field">
            <span>Local wallet password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <div className="actions">
            <button
              className="button primary"
              disabled={busy || !password || wallet.meta.watchOnly}
              onClick={() => void approve()}
            >
              Approve in wallet
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => void reject()}
            >
              Reject
            </button>
          </div>
          {wallet.meta.watchOnly && (
            <p role="alert">A watch-only wallet cannot approve sign-in.</p>
          )}
        </>
      ) : (
        <>
          <label className="field">
            <span>ReCast connection link</span>
            <textarea
              aria-label="ReCast connection link"
              rows={4}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button
            className="button primary"
            disabled={busy || !input}
            onClick={() => void load()}
          >
            Review connection
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
