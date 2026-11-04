import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const cli = resolve("node_modules/@tauri-apps/cli/tauri.js");
test("publisher requires the separate extension source commit before touching output", () => {
  const dir = mkdtempSync(join(tmpdir(), "rq-release-args-"));
  try {
    const output = join(dir, "output");
    const result = spawnSync(
      process.execPath,
      [
        "scripts/prepare-update-release.mjs",
        `--input=${dir}`,
        `--output=${output}`,
        "--key=unused-test-path",
        `--commit=${"ab".repeat(20)}`,
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /extension-commit/);
    assert.equal(existsSync(output), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("publisher binds each product to its own reviewed source commit", () => {
  const dir = mkdtempSync(join(tmpdir(), "rq-release-contract-"));
  const env = { ...process.env, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "" };
  delete env.TAURI_SIGNING_PRIVATE_KEY;
  delete env.TAURI_SIGNING_PRIVATE_KEY_PATH;
  try {
    const input = join(dir, "input"),
      output = join(dir, "output"),
      key = join(dir, "test-release.key");
    mkdirSync(input);
    const generated = spawnSync(
      process.execPath,
      [
        cli,
        "signer",
        "generate",
        "--ci",
        "--password",
        "",
        "--write-keys",
        key,
      ],
      { encoding: "utf8", env },
    );
    assert.equal(generated.status, 0, "Test key generation failed.");
    for (const name of [
      `Requant Wallet_${version}_x64-setup.exe`,
      "Requant-Wallet.app.tar.gz",
      `Requant Wallet_${version}_universal.dmg`,
      `Requant Wallet_${version}_amd64.AppImage`,
      `Requant Wallet_${version}_amd64.deb`,
      "app.apk",
      `Requant-Wallet-Extension_${version}_chromium-testnet.zip`,
    ])
      writeFileSync(
        join(input, name),
        "public non-executable packaging fixture",
      );
    writeFileSync(
      join(input, "app.apk.metadata.txt"),
      `package: name='network.requant.wallet' versionName='${version}' versionCode='503'`,
    );
    const web = join(input, "requant-web-wallet");
    mkdirSync(web);
    writeFileSync(
      join(web, "index.html"),
      "<html>Public packaging fixture</html>",
    );
    const walletCommit = "ab".repeat(20),
      extensionCommit = "cd".repeat(20);
    const result = spawnSync(
      process.execPath,
      [
        "scripts/prepare-update-release.mjs",
        `--input=${input}`,
        `--output=${output}`,
        `--key=${key}`,
        `--commit=${walletCommit}`,
        `--extension-commit=${extensionCommit}`,
      ],
      { encoding: "utf8", env },
    );
    assert.equal(result.status, 0, "Fixture release preparation failed.");
    const extension = JSON.parse(
      readFileSync(join(output, "extension.json"), "utf8"),
    );
    const bundleName = `Requant-Web-Wallet_${version}_testnet.rqweb`;
    const webBundle = JSON.parse(
      readFileSync(join(output, bundleName), "utf8"),
    );
    assert.equal(JSON.parse(extension.manifest).source_commit, extensionCommit);
    assert.equal(JSON.parse(webBundle.manifest).source_commit, walletCommit);
    assert.equal(JSON.parse(extension.manifest).product, "extension");
    assert.equal(JSON.parse(webBundle.manifest).product, "web");
    assert.ok(extension.signature.length > 100);
    assert.ok(webBundle.signature.length > 100);
    assert.match(
      readFileSync(join(output, "SHA256SUMS.txt"), "utf8"),
      new RegExp(bundleName.replaceAll(".", "\\.")),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
