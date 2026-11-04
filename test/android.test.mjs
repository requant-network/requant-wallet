import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  rmSync,
  existsSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
test("Android preparation protects the activity before first frame and fails closed on template changes", () => {
  const script = resolve("scripts/prepare-android.mjs"),
    template = resolve("src-tauri/android/MainActivity.kt");
  for (const valid of [true, false]) {
    const root = mkdtempSync(join(tmpdir(), "rq-android-"));
    try {
      const base = join(root, "src-tauri/gen/android");
      const activity = join(
        base,
        "app/src/main/java/network/requant/wallet/MainActivity.kt",
      );
      mkdirSync(join(base, "app/src/main/java/network/requant/wallet"), {
        recursive: true,
      });
      mkdirSync(join(root, "src-tauri/android"), { recursive: true });
      mkdirSync(join(root, "src-tauri/icons/android"), { recursive: true });
      copyFileSync(template, join(root, "src-tauri/android/MainActivity.kt"));
      writeFileSync(
        activity,
        valid
          ? "class MainActivity : TauriActivity()"
          : "changed upstream layout",
      );
      writeFileSync(
        join(base, "app/build.gradle.kts"),
        'compileSdk = 35\ntargetSdk = 35\nbuildTypes { getByName("release") { } }',
      );
      writeFileSync(
        join(base, "app/src/main/AndroidManifest.xml"),
        '<manifest><application android:allowBackup="true" android:usesCleartextTraffic="true" /></manifest>',
      );
      const run = spawnSync(process.execPath, [script], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          RUNNER_TEMP: root,
          ANDROID_KEY_BASE64: Buffer.from("synthetic-test-keystore").toString(
            "base64",
          ),
          ANDROID_KEY_PASSWORD: "test-only-keystore-password",
        },
      });
      if (!valid) {
        assert.notEqual(run.status, 0);
        assert.equal(
          existsSync(join(root, "requant-wallet-android.jks")),
          false,
        );
        continue;
      }
      assert.equal(run.status, 0, run.stderr);
      const kotlin = readFileSync(activity, "utf8");
      assert.ok(
        kotlin.indexOf("FLAG_SECURE") < kotlin.indexOf("super.onCreate"),
      );
      assert.match(
        readFileSync(join(base, "app/src/main/AndroidManifest.xml"), "utf8"),
        /allowBackup="false"/,
      );
      if (process.platform !== "win32")
        assert.equal(
          statSync(join(root, "requant-wallet-android.jks")).mode & 0o777,
          0o600,
        );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
