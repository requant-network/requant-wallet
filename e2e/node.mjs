import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import init, { run } from "../pkg-browser/requant_browser_core.js";

export const fixture = JSON.parse(
  await readFile(
    new URL("../target/full-test-fixture.json", import.meta.url),
    "utf8",
  ),
);
await init({
  module_or_path: await readFile(
    new URL("../pkg-browser/requant_browser_core_bg.wasm", import.meta.url),
  ),
});
export const core = (op, args) => JSON.parse(run(op, JSON.stringify(args)));
export const metadata = core("metadata", { file: fixture.file });

export function nodeFixture() {
  const owner = fixture.request.coins[0].owner;
  const coins = JSON.parse(fixture.request.coins[0].raw).result.map((c) => ({
    ...c,
    owner,
  }));
  return {
    spent: false,
    loseResponse: false,
    broadcasts: [],
    requests: [],
    async install(context, beforeBroadcast = async () => {}) {
      await context.route("**/*", async (route) => {
        const request = route.request(),
          url = new URL(request.url());
        if (url.pathname !== "/wallet-api/v1/rpc") {
          if (url.origin === "http://127.0.0.1:4173") return route.continue();
          return route.abort();
        }
        assert.equal(url.origin, "http://127.0.0.1:4173");
        const { method, params } = request.postDataJSON();
        this.requests.push(request.postData());
        let result;
        if (method === "getinfo")
          result = {
            network: "test",
            height: 100,
            tip: "a".repeat(64),
            peers: 4,
          };
        else if (method === "getblock") result = { id: fixture.genesis };
        else if (method === "utxos") {
          const owners = Array.isArray(params[0]) ? params[0] : [params[0]];
          result = this.spent
            ? []
            : coins.filter((c) => owners.includes(c.owner));
        } else if (method === "history") result = [];
        else if (method === "estimatefee") result = { atoms_per_byte: 5 };
        else if (method === "gettxbatch")
          result = params[0].map((txid) => ({
            txid,
            raw: fixture.request.parents[txid],
          }));
        else if (method === "sendtx") {
          const signed = core("signed", { hex: params[0] });
          await beforeBroadcast({ ...signed, hex: params[0] });
          this.broadcasts.push({ ...signed, hex: params[0] });
          if (this.loseResponse) return route.abort("connectionreset");
          result = signed.txid;
        } else throw new Error("Unexpected RPC: " + method);
        await route.fulfill({ json: { result, error: null } });
      });
    },
  };
}

export async function disk(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("requant-wallet", 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result,
            tx = db.transaction("state"),
            request = tx.objectStore("state").get("disk");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
          tx.oncomplete = () => db.close();
        };
      }),
  );
}
