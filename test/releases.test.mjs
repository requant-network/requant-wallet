import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manifestFor } from "../scripts/signed-release.mjs";
test("release packager binds every byte and refuses symlinks and unexpected extension files", () => {
  const dir = mkdtempSync(join(tmpdir(), "rq-assets-"));
  try {
    writeFileSync(join(dir, "index.html"), "ok");
    const out = manifestFor(dir, "web", "0.5.3", "ab".repeat(20));
    assert.equal(JSON.parse(out.manifest).files[0].bytes, 2);
    symlinkSync(join(dir, "index.html"), join(dir, "escape.js"));
    assert.throws(
      () => manifestFor(dir, "web", "0.5.3", "ab".repeat(20)),
      /regular files/,
    );
    assert.throws(
      () => manifestFor(dir, "web", "0.5.3", "unreviewed"),
      /reviewed/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("installed web trust root matches the independent native updater root", () => {
  const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  const key = Buffer.from(config.plugins.updater.pubkey, "base64")
    .toString()
    .trim()
    .split("\n")[1];
  assert.equal(
    JSON.parse(readFileSync("release-trust.json", "utf8")).public_key,
    key,
  );
});
