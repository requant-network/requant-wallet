import { readdirSync, readFileSync, writeFileSync, lstatSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
export function manifestFor(
  directory,
  product,
  version,
  commit,
  minClient = "0.5.3",
) {
  if (!/^[a-f0-9]{40}$/.test(commit) || !/^(web|extension)$/.test(product))
    throw new Error("Supply a reviewed source commit and release product.");
  for (const value of [version, minClient])
    if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(value))
      throw new Error("Invalid release version.");
  const files = [],
    data = {};
  let total = 0;
  function walk(relative) {
    for (const name of readdirSync(join(directory, relative)).sort()) {
      const path = relative ? `${relative}/${name}` : name;
      if (
        path.length > 240 ||
        !path
          .split("/")
          .every((p) => p !== "." && p !== ".." && /^[a-zA-Z0-9_.-]+$/.test(p))
      )
        throw new Error("Unsupported release asset path.");
      const file = join(directory, path),
        stat = lstatSync(file);
      if (stat.isDirectory()) {
        walk(path);
        continue;
      }
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size > 16 * 1024 * 1024
      )
        throw new Error("Release assets must be bounded regular files.");
      total += stat.size;
      if (total > 32 * 1024 * 1024 || files.length >= 1024)
        throw new Error("Release exceeds the asset limit.");
      if (
        product === "web" &&
        !/\.(html|js|css|wasm|svg|png|ico|woff2?|ttf|json|txt)$/.test(path)
      )
        throw new Error("Unexpected public web asset type.");
      const bytes = readFileSync(file);
      files.push({
        path,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
      data[path] = bytes.toString("base64");
    }
  }
  walk("");
  if (product === "web" && !data["index.html"])
    throw new Error("Missing web entry point.");
  if (
    product === "extension" &&
    (files.length !== 1 ||
      files[0].path !==
        `Requant-Wallet-Extension_${version}_chromium-testnet.zip`)
  )
    throw new Error("Expected exactly the reviewed extension ZIP.");
  return {
    manifest: JSON.stringify({
      schema: 1,
      purpose: "requant-release-v1",
      product,
      network: "test",
      version,
      min_client: minClient,
      source_commit: commit,
      files,
    }),
    files: data,
  };
}
export function signRelease({
  directory,
  product,
  version,
  commit,
  key,
  output,
}) {
  const bundle = manifestFor(directory, product, version, commit);
  const manifestFile = `${output}.manifest.json`;
  // Exclusive creation prevents mixing artifacts from different reviewed builds.
  writeFileSync(manifestFile, bundle.manifest, { flag: "wx", mode: 0o600 });
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/@tauri-apps/cli/tauri.js",
      "signer",
      "sign",
      "--private-key-path",
      resolve(key),
      "--app-version",
      version,
      manifestFile,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0)
    throw new Error("Offline manifest signing failed; nothing was published.");
  const signature = readFileSync(`${manifestFile}.sig`, "utf8").trim();
  writeFileSync(
    output,
    JSON.stringify({
      manifest: bundle.manifest,
      signature,
      ...(product === "web" ? { files: bundle.files } : {}),
    }),
    { flag: "wx", mode: 0o600 },
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const i = a.indexOf("=");
      return [a.slice(0, i), a.slice(i + 1)];
    }),
  );
  for (const k of [
    "directory",
    "product",
    "version",
    "commit",
    "key",
    "output",
  ])
    if (!args[`--${k}`]) throw new Error(`Missing --${k}=VALUE`);
  signRelease(
    Object.fromEntries(Object.entries(args).map(([k, v]) => [k.slice(2), v])),
  );
}
