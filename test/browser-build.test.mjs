import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(
  new URL("../scripts/build-browser-core.mjs", import.meta.url),
);
const wasm = "wasm32-unknown-unknown/release/requant_browser_core.wasm";

for (const custom of [false, true]) {
  test(
    `browser package uses freshly compiled WASM with ${custom ? "custom" : "default"} Cargo target`,
    { skip: process.platform === "win32" },
    () => {
      const root = mkdtempSync(join(tmpdir(), "wallet-browser-build-"));
      try {
        const bin = join(root, "bin"),
          stale = join(root, "target", wasm);
        mkdirSync(bin);
        mkdirSync(dirname(stale), { recursive: true });
        writeFileSync(stale, "stale wallet core");
        writeFileSync(
          join(bin, "cargo"),
          `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const output=path.join(process.env.CARGO_TARGET_DIR||'target',${JSON.stringify(wasm)});
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,'fresh wallet core');
`,
          { mode: 0o755 },
        );
        writeFileSync(
          join(bin, "wasm-bindgen"),
          `#!/usr/bin/env node
const fs=require('node:fs');
fs.writeFileSync('pkg-browser/selected-core.txt',fs.readFileSync(process.argv[2]));
`,
          { mode: 0o755 },
        );
        const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
        delete env.CARGO_TARGET_DIR;
        if (custom) env.CARGO_TARGET_DIR = join(root, "custom-target");
        const result = spawnSync(process.execPath, [script], {
          cwd: root,
          env,
          encoding: "utf8",
          timeout: 10000,
        });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(
          readFileSync(join(root, "pkg-browser/selected-core.txt"), "utf8"),
          "fresh wallet core",
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
}
