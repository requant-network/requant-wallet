import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowLeftRight,
  FileDown,
  FileUp,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import * as api from "./service";
import * as protocol from "./protocols";
import { platform } from "./platform";
export type Props = {
  wallet: api.PublicWallet;
  reset: number;
  busy: boolean;
  task: (label: string, fn: () => Promise<void>) => Promise<void>;
};
export function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={type === "password" ? "off" : undefined}
        spellCheck={false}
      />
    </label>
  );
}
export function Button({
  children,
  onClick,
  disabled = false,
  primary = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      className={`button${primary ? " primary" : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
export function Details({ rows }: { rows: [string, any][] }) {
  return (
    <dl className="protocol-details">
      {rows
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{String(v)}</dd>
          </div>
        ))}
    </dl>
  );
}
export function Review({ review }: { review: any }) {
  return (
    <div className="protocol-review">
      <h3>Review before signing</h3>
      {review.outputs ? (
        <>
          <Details
            rows={[
              ["Amount", `${review.amount} RQT`],
              ["Network fee", `${review.fee} RQT`],
              ["Total", `${review.total} RQT`],
            ]}
          />
          {review.outputs.map((o: any, i: number) => (
            <Details
              key={i}
              rows={[
                [o.change ? "Change address" : "Recipient", o.address],
                ["Amount", `${o.amount} RQT`],
              ]}
            />
          ))}
        </>
      ) : (
        <Details
          rows={
            Object.entries(review).map(([k, v]) => [
              k.replace(/([A-Z])/g, " $1"),
              v,
            ]) as [string, any][]
          }
        />
      )}
    </div>
  );
}
export function useRunner(p: Props, clear: () => void) {
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    clear();
    return () => {
      generation.current++;
    };
  }, [p.reset, p.wallet.id]);
  return (label: string, fn: (valid: () => boolean) => Promise<void>) =>
    void p.task(label, async () => {
      const g = generation.current;
      await fn(() => g === generation.current);
    });
}
export function usePicker(
  run: ReturnType<typeof useRunner>,
  load: (text: string, valid: () => boolean) => Promise<void>,
) {
  const ref = useRef<HTMLInputElement>(null);
  return {
    pick: () =>
      run("Reading protocol file…", async (valid) => {
        if (platform()?.pick) {
          const f = await platform()!.pick!(8 * 1024 * 1024);
          if (f && valid()) await load(f.text, valid);
        } else ref.current?.click();
      }),
    input: (
      <input
        type="file"
        hidden
        ref={ref}
        accept=".json,.txt,.hex"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file)
            run("Reading protocol file…", async (valid) => {
              const text = await api.readFile(file, 8 * 1024 * 1024);
              if (valid()) await load(text, valid);
            });
          e.target.value = "";
        }}
      />
    ),
  };
}
export function units(n: string | undefined, decimals = 8) {
  if (!n) return "—";
  const v = BigInt(n),
    d = 10n ** BigInt(decimals);
  return `${v / d}.${(v % d).toString().padStart(decimals, "0")}`;
}
export function Swaps(p: Props) {
  const [rows, setRows] = useState(() =>
      protocol.list().swaps.filter((r) => r.walletId === p.wallet.id),
    ),
    [selected, setSelected] = useState<protocol.Swap | null>(null);
  const [password, setPassword] = useState(""),
    [walletPassword, setWalletPassword] = useState(""),
    [rate, setRate] = useState("5");
  const [details, setDetails] = useState<any>(null),
    [state, setState] = useState<any>(null),
    [tron, setTron] = useState<any>(null);
  const [review, setReview] = useState<any>(null),
    [action, setAction] = useState(""),
    [recipient, setRecipient] = useState(""),
    [btcTxid, setBtcTxid] = useState(""),
    [btcVout, setBtcVout] = useState("0"),
    [btcSats, setBtcSats] = useState("");
  const refreshRows = () =>
    setRows(protocol.list().swaps.filter((r) => r.walletId === p.wallet.id));
  const clear = () => {
    setPassword("");
    setWalletPassword("");
    setSelected(null);
    setDetails(null);
    setState(null);
    setTron(null);
    setReview(null);
    setAction("");
    refreshRows();
  };
  const run = useRunner(p, clear);
  const choose = (r: protocol.Swap) => {
    setSelected(r);
    setDetails(null);
    setState(null);
    setTron(null);
    setReview(null);
    setPassword("");
    setWalletPassword("");
  };
  const picker = usePicker(run, async (text, valid) => {
    const j = JSON.parse(text);
    let checked: any;
    if (j.requant_swap_encrypted === 1) {
      await api.core("swapEnvelope", { record: text });
      checked = {
        record: text,
        details: await api.core("swapInspect", { record: text, password }),
      };
    } else checked = await api.core("swapImport", { plain: text, password });
    if (!valid()) return;
    const old = protocol
      .list()
      .swaps.find((r) => r.details.id === checked.details.id);
    const row = await protocol.putSwap({
      id: old?.id ?? crypto.randomUUID(),
      walletId: p.wallet.id,
      ...checked,
      backedUp: true,
      outbox: old?.outbox,
    });
    if (valid()) {
      setSelected(row);
      setDetails(row.details);
      refreshRows();
    }
  });
  const refresh = () =>
    run("Checking swap and both networks…", async (valid) => {
      if (!selected) return;
      const s = await protocol.status(selected, password);
      let t = null;
      if (s.details.kind === "usdt")
        t = await protocol.tronState(selected, password);
      const updated =
        s.details.kind === "usdt" && selected.outbox?.length
          ? await protocol.tronHistory(selected)
          : selected;
      if (!valid()) return;
      setSelected(updated);
      setDetails(s.details);
      setState(s.status);
      setTron(t);
      setReview(null);
      if (s.status.funding) {
        setBtcTxid(s.status.funding.txid ?? "");
        setBtcVout(s.status.funding.vout ?? "0");
        setBtcSats(s.status.funding.sats ?? "");
      }
    });
  const prepare = (a: string) =>
    run("Preparing local transaction…", async (valid) => {
      if (!selected) return;
      setReview(null);
      let r;
      if (a === "claim") r = await protocol.claim(selected, password, rate);
      else if (a === "btcRefund")
        r = await api.core("swapBtcRefund", {
          record: selected.record,
          password,
          recipient,
          txid: btcTxid,
          vout: btcVout,
          sats: btcSats,
          rate,
        });
      else r = await protocol.tronPrepare(selected, password, a, recipient);
      if (valid()) {
        setReview(r);
        setAction(a);
      }
    });
  const send = () =>
    run("Signing and submitting approved swap transaction…", async (valid) => {
      if (!selected || !review) return;
      if (action === "claim") {
        const fresh = await protocol.claim(selected, password, rate);
        if (JSON.parse(fresh.payment).tx !== JSON.parse(review.payment).tx)
          throw new Error("The claim changed. Review it again.");
        const signed = await api.signCondition(
          selected.walletId,
          fresh.payment,
          walletPassword,
        );
        if (!valid()) return;
        await api.broadcast(signed as { hex: string; txid: string });
      } else {
        const fresh = await protocol.tronPrepare(
          selected,
          password,
          action,
          recipient,
        );
        const semantic = (r: any) =>
          JSON.stringify({ ...r.review, expires: undefined });
        if (semantic(fresh) !== semantic(review))
          throw new Error("Transaction terms changed. Review again.");
        if (!valid()) return;
        const row = await protocol.tronSend(selected, fresh);
        if (valid()) setSelected(row);
      }
      if (valid()) {
        setReview(null);
        setWalletPassword("");
        refreshRows();
        setState({
          ...state,
          state: "Submitted — refresh to check confirmation",
        });
      }
    });
  return (
    <div className="protocol-workspace">
      {picker.input}
      <section className="panel protocol-intro">
        <div>
          <span className="eyebrow">ATOMIC SWAPS / TESTNET</span>
          <h2>Swaps are temporarily disabled</h2>
          <p className="subtle">
            New offers and funding are paused. Keep your existing swap backups.
            You can still check a saved swap, claim funded RQT or recover funds.
          </p>
        </div>
        <ArrowLeftRight size={32} />
      </section>
      <div className="protocol-columns">
        <section className="panel">
          <h2>Recover an existing swap</h2>
          <p className="subtle">
            Import a saved swap or select one from your history. Do not send new
            funds to old deposit addresses or invoices.
          </p>
          <Field
            label="Swap backup password (12+ characters)"
            type="password"
            value={password}
            onChange={(v) => {
              setPassword(v);
              setReview(null);
            }}
          />
          <div className="action-row">
            <Button disabled={p.busy || !password} onClick={picker.pick}>
              <FileUp size={16} />
              Import swap
            </Button>
          </div>
        </section>
        <section className="panel">
          <h2>Your swaps</h2>
          <p className="subtle">
            Each swap has its own backup. Wallet recovery phrases do not restore
            swap secrets.
          </p>
          {rows.length ? (
            rows.map((r) => (
              <button
                key={r.id}
                className={`protocol-list-row ${selected?.id === r.id ? "selected" : ""}`}
                onClick={() => choose(r)}
                disabled={p.busy}
              >
                <span>
                  <strong>{r.details.receiveAmount} RQT</strong>
                  <small>
                    {r.details.kind?.toUpperCase()} ·{" "}
                    {r.backedUp ? "Backup saved" : "Recovery backup needed"}
                  </small>
                </span>
                <ArrowRight size={18} />
              </button>
            ))
          ) : (
            <p className="empty">No saved swaps.</p>
          )}
        </section>
      </div>
      {selected && (
        <section className="panel">
          <div className="panel-heading">
            <h2>Swap workspace</h2>
            <Button disabled={p.busy || !password} onClick={refresh}>
              <RefreshCw size={16} />
              Unlock & refresh
            </Button>
          </div>
          <p className="subtle">
            Enter this swap's backup password above, then unlock to verify its
            saved terms and live state.
          </p>
          {details && (
            <>
              <Details
                rows={[
                  ["Swap ID", details.id],
                  ["Receive", `${details.receiveAmount} RQT`],
                  ["Receiving address", details.receiveAddress],
                  ["State", state?.state ?? details.state],
                  [
                    "Network",
                    details.kind === "usdt"
                      ? `TRON ${details.tron_network}`
                      : `Bitcoin ${details.btc_network}`,
                  ],
                ]}
              />
              <div className="action-row">
                <Button
                  disabled={p.busy}
                  onClick={() =>
                    run("Saving encrypted swap backup…", async (valid) => {
                      await api.download(
                        selected.record,
                        `requant-swap-${details.id ?? selected.id}.json`,
                      );
                      {
                        const row = await protocol.putSwap({
                          ...selected,
                          backedUp: true,
                        });
                        if (valid()) {
                          setSelected(row);
                          refreshRows();
                        }
                      }
                    })
                  }
                >
                  <FileDown size={16} />
                  Save encrypted swap backup
                </Button>
              </div>
              {tron && (
                <Details
                  rows={[
                    ["USDT held", `${units(tron.balance, 6)} USDT`],
                    ["TRX held", `${units(tron.trx, 6)} TRX`],
                    [
                      "USDT contract state",
                      ["Not locked", "Locked", "Claimed", "Refunded"][
                        Number(tron.state)
                      ],
                    ],
                    ["Approval irreversible", tron.approved ? "Yes" : "No"],
                  ]}
                />
              )}
              <div className="conditions-grid">
                <Field
                  label="Requant fee (atoms/byte); BTC refund (sats/vbyte)"
                  value={rate}
                  onChange={(v) => {
                    setRate(v);
                    setReview(null);
                  }}
                />
                <Field
                  label="Wallet signing password (for RQT claim)"
                  type="password"
                  value={walletPassword}
                  onChange={setWalletPassword}
                />
              </div>
              <div className="action-row">
                <Button
                  primary
                  disabled={p.busy || !password || !state?.rqt_htlc}
                  onClick={() => prepare("claim")}
                >
                  Review RQT claim
                </Button>
                {details.kind === "usdt" && (
                  <>
                    <Button
                      disabled={p.busy || !password}
                      onClick={() =>
                        run(
                          "Requesting maker fee sponsorship…",
                          async (valid) => {
                            await protocol.external("maker.swap_fees", [
                              details.id,
                            ]);
                            if (valid())
                              setState({
                                ...state,
                                state:
                                  "Fee support requested — refresh after it arrives",
                              });
                          },
                        )
                      }
                    >
                      Request TRON fees
                    </Button>
                    <Button
                      disabled={p.busy || !password}
                      onClick={() => prepare("refund")}
                    >
                      Review USDT refund
                    </Button>
                    <Button
                      disabled={p.busy || !password}
                      onClick={() => prepare("returnFees")}
                    >
                      Return unused maker TRX
                    </Button>
                  </>
                )}
              </div>
              {details.kind !== "ln" && (
                <div className="protocol-refund">
                  <h3>Refund & withdrawal</h3>
                  <Field
                    label={
                      details.kind === "btc"
                        ? "Bitcoin refund address (Signet)"
                        : "USDT withdrawal address (TRON Nile)"
                    }
                    value={recipient}
                    onChange={(v) => {
                      setRecipient(v);
                      setReview(null);
                    }}
                  />
                  {details.kind === "btc" && (
                    <div className="conditions-grid">
                      <Field
                        label="Funding transaction ID"
                        value={btcTxid}
                        onChange={(v) => {
                          setBtcTxid(v);
                          setReview(null);
                        }}
                      />
                      <Field
                        label="Funding output index"
                        value={btcVout}
                        onChange={(v) => {
                          setBtcVout(v);
                          setReview(null);
                        }}
                      />
                      <Field
                        label="Actual output value (satoshis)"
                        value={btcSats}
                        onChange={(v) => {
                          setBtcSats(v);
                          setReview(null);
                        }}
                      />
                    </div>
                  )}
                  <Button
                    disabled={p.busy || !password}
                    onClick={() =>
                      prepare(details.kind === "btc" ? "btcRefund" : "withdraw")
                    }
                  >
                    Review{" "}
                    {details.kind === "btc"
                      ? "Bitcoin refund"
                      : "USDT withdrawal"}
                  </Button>
                </div>
              )}
              {review && (
                <>
                  <Review review={review.review} />
                  {action === "btcRefund" ? (
                    <>
                      <p className="subtle">
                        Verify the funding output value. Submit this signed
                        transaction through a Bitcoin Signet node after its
                        refund height.
                      </p>
                      <Button
                        primary
                        disabled={p.busy}
                        onClick={() =>
                          run("Saving signed Bitcoin refund…", async () => {
                            await api.download(
                              review.hex,
                              `requant-btc-refund-${review.txid}.hex`,
                            );
                          })
                        }
                      >
                        Save signed refund
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className="protocol-warning">
                        {action === "claim"
                          ? "Claiming reveals your secret and allows the maker to take the other side of this swap."
                          : action === "approve"
                            ? "This approves the deployed RequantHtlc contract for USDT at this swap address. Only use test tokens on Nile."
                            : "The signed transaction will be sent to TRON Nile."}
                      </p>
                      <Button
                        primary
                        disabled={
                          p.busy || (action === "claim" && !walletPassword)
                        }
                        onClick={send}
                      >
                        <ShieldCheck size={16} />
                        Confirm, sign & send
                      </Button>
                    </>
                  )}
                </>
              )}
              {!!selected.outbox?.length && (
                <>
                  <h3>TRON transaction history</h3>
                  {selected.outbox.map((x) => (
                    <Details
                      key={x.txid}
                      rows={[
                        ["Transaction", x.txid],
                        ["State", x.status],
                      ]}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
