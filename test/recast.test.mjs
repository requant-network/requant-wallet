import test from "node:test";
import assert from "node:assert/strict";
import { connection, validateRequest, relay } from "../web/src/recast.mjs";
const uri =
  "https://recast.example/reCast/v1/wallet/pairings/" +
  "ab".repeat(32) +
  "#" +
  "cd".repeat(32);
const source = connection(uri);
const request = {
  protocol: "recast-connect-v1",
  id: source.id,
  origin: source.origin,
  network: "test",
  intent: "login",
  document: null,
  owner: "",
  expires_at: 1800000300,
};
test("connection rejects credentials, missing capabilities, wrong paths and insecure remote hosts", () => {
  for (const input of [
    "http://evil.example/" + source.id,
    uri.replace("https://", "javascript:"),
    uri.replace("/pairings/", "/sessions/"),
    uri.replace("recast.example", "user:password@recast.example"),
    uri.replace("#", "?token="),
    uri.replace("#", "#00"),
    uri.replace("/pairings/", "/pairings/../pairings/") + "?query=1",
  ])
    assert.throws(() => connection(input));
  assert.equal(source.url.includes("cd".repeat(32)), false);
});
test("review binds the visible origin, request nonce, network, purpose and expiry", () => {
  assert.equal(validateRequest(request, source, 1800000000), request);
  for (const [key, value] of [
    ["id", "00".repeat(32)],
    ["origin", "https://evil.example"],
    ["network", "main"],
    ["expires_at", 1800000000],
    ["expires_at", 1800000400],
    ["intent", "sendTransaction"],
    ["document", { transaction: "00" }],
  ])
    assert.throws(() =>
      validateRequest({ ...request, [key]: value }, source, 1800000000),
    );
});
test("relay carries only public approvals, omits credentials and refuses redirects", async () => {
  let submitted;
  const approval = { public_key: "11".repeat(32), signature: "22".repeat(64) };
  const fetch = async (url, options) => {
    submitted = { url, options };
    return new Response('{"approved":true}', { status: 200 });
  };
  await relay(source, "approve", approval, null, fetch);
  assert.equal(submitted.url, source.url + "/approve");
  assert.equal(submitted.options.credentials, "omit");
  assert.equal(submitted.options.redirect, "error");
  assert.deepEqual(JSON.parse(submitted.options.body), approval);
  await assert.rejects(relay(source, "claim", {}, null, fetch));
  await assert.rejects(
    relay(
      source,
      "approve",
      { ...approval, password: "must-not-leave-wallet" },
      null,
      fetch,
    ),
  );
});

test("comparison code matches Go/Rust vectors and binds the local approval purpose", async () => {
  const { comparisonCode } = await import("../web/src/recast.mjs");
  const r = {
    origin: "https://recast.example",
    network: "test",
    id: "ab".repeat(32),
    intent: "login",
    expires_at: 1800000300,
  };
  assert.equal(await comparisonCode(r), "228355");
  assert.equal(await comparisonCode({ ...r, intent: "channel" }), "950127");
  assert.notEqual(
    await comparisonCode({ ...r, id: "cd".repeat(32) }),
    "228355",
  );
  await assert.rejects(comparisonCode({ ...r, network: "main" }));
});
