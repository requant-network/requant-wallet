const hex32 = (s) => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
export function connection(text) {
  if (typeof text !== "string" || text.length > 2048)
    throw new Error("Invalid ReCast connection link.");
  let u;
  try {
    u = new URL(text.trim());
  } catch {
    throw new Error("Paste the complete ReCast connection link.");
  }
  const local = ["127.0.0.1", "localhost"].includes(u.hostname);
  const match =
    /^(?:\/[A-Za-z0-9_-]+)*\/v1\/wallet\/pairings\/([a-f0-9]{64})$/.exec(
      u.pathname,
    );
  if (
    !(u.protocol === "https:" || (u.protocol === "http:" && local)) ||
    u.username ||
    u.password ||
    u.search ||
    !match ||
    !hex32(u.hash.slice(1))
  )
    throw new Error("Invalid ReCast connection link.");
  const token = u.hash.slice(1);
  u.hash = "";
  return { url: u.href, token, origin: u.origin, id: match[1] };
}
export function validateRequest(value, source, now = Date.now() / 1000) {
  if (
    !value ||
    value.protocol !== "recast-connect-v1" ||
    value.id !== source.id ||
    value.origin !== source.origin ||
    value.network !== "test" ||
    !Number.isSafeInteger(value.expires_at) ||
    value.expires_at <= now ||
    value.expires_at > now + 330 ||
    !["login", "channel"].includes(value.intent)
  )
    throw new Error("Invalid, expired or wrong-network ReCast request.");
  if (value.intent === "login" && value.document !== null)
    throw new Error(
      "A sign-in request cannot contain a payment or channel update.",
    );
  if (
    value.intent === "channel" &&
    (!value.document ||
      !hex32(value.owner) ||
      value.document.id !== value.owner)
  )
    throw new Error("Invalid channel approval request.");
  return value;
}
export async function relay(
  source,
  action,
  approval,
  adapter,
  transport = fetch,
) {
  if (!["read", "approve", "reject"].includes(action))
    throw new Error("Unsupported ReCast operation.");
  if (
    action === "approve" &&
    (!approval ||
      !hex32(approval.public_key) ||
      !/^[a-f0-9]{128}$/.test(approval.signature) ||
      Object.keys(approval).some(
        (k) => !["public_key", "signature"].includes(k),
      ))
  )
    throw new Error("Invalid wallet approval.");
  if (adapter?.recastRelay)
    return adapter.recastRelay(source.url, source.token, action, approval);
  const response = await transport(
    source.url + (action === "read" ? "" : "/" + action),
    {
      method: action === "read" ? "GET" : "POST",
      headers: {
        Authorization: `Pairing ${source.token}`,
        ...(action === "approve" ? { "Content-Type": "application/json" } : {}),
      },
      ...(action === "approve" ? { body: JSON.stringify(approval) } : {}),
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(10000),
    },
  );
  const body = await response.text();
  if (body.length > 16384) throw new Error("ReCast response is too large.");
  let value;
  try {
    value = body ? JSON.parse(body) : {};
  } catch {
    throw new Error("Invalid ReCast response.");
  }
  if (!response.ok)
    throw new Error(value.error?.message ?? "ReCast request failed.");
  return value;
}
