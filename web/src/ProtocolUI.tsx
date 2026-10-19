import { useEffect, useRef, type ReactNode } from "react";
import * as api from "./service";
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
