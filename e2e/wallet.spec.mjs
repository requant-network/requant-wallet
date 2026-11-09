import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fixture, metadata, core, nodeFixture, disk } from "./node.mjs";

const walletURL = "http://127.0.0.1:4173/wallet/";
const nav = (page, name) =>
  page
    .getByRole("navigation", { name: "Wallet navigation", exact: true })
    .getByRole("button", { name, exact: true });

async function importWallet(
  page,
  file = fixture.file,
  password = fixture.password,
) {
  await page.goto(walletURL);
  await page
    .getByRole("button", { name: "Import backup", exact: true })
    .click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "unfunded-wallet.json",
    mimeType: "application/json",
    buffer: Buffer.from(file),
  });
  await page
    .getByLabel("Backup password (leave empty for watch-only)")
    .fill(password);
  await page
    .getByRole("button", { name: "Restore wallet", exact: true })
    .click();
}

async function review(page) {
  await expect(page.locator(".balance-panel .amount.large")).toContainText(
    "2.00000000",
  );
  await nav(page, "Send RQT").click();
  await page
    .getByLabel("Address", { exact: true })
    .fill(fixture.request.payments[0].address);
  await page.getByLabel("Amount (RQT)", { exact: true }).fill("1.00000000");
  await page
    .getByRole("button", { name: "Review payment", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review payment", exact: true }),
  ).toBeVisible();
}

test("create, enforce backup confirmation and restore the downloaded backup in a clean browser context", async ({
  page,
  context,
  browser,
}, info) => {
  const node = nodeFixture();
  await node.install(context);
  await page.goto(walletURL);
  const password = "disposable-e2e-creation-password";
  await page
    .getByLabel("Local wallet password", { exact: true })
    .fill(password);
  await page.getByLabel("Confirm local password").fill(password);
  await page.getByRole("button", { name: "Create wallet locally" }).click();
  await expect(
    page.getByRole("button", { name: "Continue to wallet" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Reveal phrase", exact: true })
    .click();
  const words = await page.locator(".phrase-grid strong").allTextContents();
  expect(words).toHaveLength(24);
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Save encrypted backup", exact: true })
    .click();
  const backup = info.outputPath("unfunded-backup.json");
  await (await downloaded).saveAs(backup);
  const encrypted = await readFile(backup, "utf8");
  expect(encrypted).not.toContain(password);
  expect(encrypted).not.toContain(words.join(" "));
  await page
    .getByLabel("I have stored my recovery phrase safely offline.")
    .check();
  await page.getByRole("button", { name: "Continue to wallet" }).click();
  await page
    .getByRole("button", { name: "Show address & QR", exact: true })
    .click();
  const address = await page.locator(".receive-address").innerText();
  const clean = await browser.newContext();
  try {
    await nodeFixture().install(clean);
    const restored = await clean.newPage();
    await importWallet(restored, encrypted, "incorrect-password");
    await expect(restored.getByRole("alert")).toContainText(/Wrong password/);
    await restored
      .getByLabel("Backup password (leave empty for watch-only)")
      .fill(password);
    await restored
      .getByRole("button", { name: "Restore wallet", exact: true })
      .click();
    await restored
      .getByRole("button", { name: "Show address & QR", exact: true })
      .click();
    await expect(restored.locator(".receive-address")).toHaveText(address);
    await restored.reload();
    await restored
      .getByRole("button", { name: "Show address & QR", exact: true })
      .click();
    await expect(restored.locator(".receive-address")).toHaveText(address);
    expect(JSON.stringify(await disk(restored))).not.toContain(password);
  } finally {
    await clean.close();
  }
  expect(node.broadcasts).toHaveLength(0);
  expect(node.requests.join("\n")).not.toContain(password);
  expect(node.requests.join("\n")).not.toContain(words.join(" "));
});

test("review and locally sign one transfer; persist signed bytes before the single broadcast", async ({
  page,
  context,
}) => {
  const node = nodeFixture();
  await node.install(context, async (signed) => {
    const outbox = JSON.parse((await disk(page)).data["requant.web.outbox.v1"]);
    expect(outbox[0]).toMatchObject({
      txid: signed.txid,
      hex: signed.hex,
      status: "Broadcast pending",
    });
  });
  await importWallet(page);
  await review(page);
  await page
    .getByLabel("Local wallet password", { exact: true })
    .fill("incorrect-password");
  await page.getByRole("button", { name: "Confirm, sign & broadcast" }).click();
  await expect(page.getByRole("alert")).toContainText(/Wrong password/);
  expect(node.broadcasts).toHaveLength(0);
  await page
    .getByLabel("Local wallet password", { exact: true })
    .fill(fixture.password);
  await page.getByRole("button", { name: "Confirm, sign & broadcast" }).click();
  await expect(
    page.getByRole("heading", { name: "Track your payment" }),
  ).toBeVisible();
  expect(node.broadcasts).toHaveLength(1);
  await page.reload();
  await nav(page, "Activity").click();
  await expect(page.getByRole("link", { name: /Pending/ })).toHaveAttribute(
    "href",
    new RegExp(node.broadcasts[0].txid),
  );
  expect(node.broadcasts).toHaveLength(1);
  expect(node.requests.join("\n")).not.toContain(fixture.password);
});

test("a spent input invalidates an already visible payment review before broadcast", async ({
  page,
  context,
}) => {
  const node = nodeFixture();
  await node.install(context);
  await importWallet(page);
  await review(page);
  node.spent = true;
  await page
    .getByLabel("Local wallet password", { exact: true })
    .fill(fixture.password);
  await page.getByRole("button", { name: "Confirm, sign & broadcast" }).click();
  await expect(page.getByRole("alert")).toContainText(/selected coin changed/i);
  expect(node.broadcasts).toHaveLength(0);
});

test("an accepted transfer with a lost reply remains unknown after reload and is never automatically rebroadcast", async ({
  page,
  context,
}) => {
  const node = nodeFixture();
  node.loseResponse = true;
  await node.install(context);
  await importWallet(page);
  await review(page);
  await page
    .getByLabel("Local wallet password", { exact: true })
    .fill(fixture.password);
  await page.getByRole("button", { name: "Confirm, sign & broadcast" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Broadcast status is unknown",
  );
  expect(node.broadcasts).toHaveLength(1);
  const transaction = node.broadcasts[0];
  await page.reload();
  await nav(page, "Activity").click();
  await expect(
    page.getByRole("link", { name: /Broadcast status unknown/ }),
  ).toHaveAttribute("href", new RegExp(transaction.txid));
  expect(
    JSON.parse((await disk(page)).data["requant.web.outbox.v1"])[0],
  ).toMatchObject({
    txid: transaction.txid,
    hex: transaction.hex,
    status: "Broadcast status unknown",
  });
  expect(node.broadcasts).toHaveLength(1);
});

test("legacy browser storage migrates without changing wallet identity or losing broadcast records", async ({
  page,
  context,
}) => {
  const node = nodeFixture();
  await node.install(context);
  await page.goto(walletURL);
  const signed = core("sign", {
    file: fixture.file,
    password: fixture.password,
    unsigned: core("plan", fixture.request).unsigned,
  });
  await page.evaluate(
    ({ fixture, metadata, signed }) => {
      localStorage.setItem(
        "requant.web.v1",
        JSON.stringify([
          {
            id: "legacy-e2e-wallet",
            name: "Existing wallet",
            file: fixture.file,
            meta: metadata,
            backedUp: true,
          },
        ]),
      );
      localStorage.setItem(
        "requant.web.outbox.v1",
        JSON.stringify([
          { ...signed, status: "Broadcast status unknown", created: 1 },
        ]),
      );
    },
    { fixture, metadata, signed },
  );
  await page.reload();
  await expect(page.getByLabel("Your wallets")).toHaveValue(
    "legacy-e2e-wallet",
  );
  await page
    .getByRole("button", { name: "Show address & QR", exact: true })
    .click();
  await expect(page.locator(".receive-address")).toHaveText(metadata.address);
  await nav(page, "Activity").click();
  await expect(
    page.getByRole("link", { name: /Broadcast status unknown/ }),
  ).toHaveAttribute("href", new RegExp(signed.txid));
  expect(
    await page.evaluate(() => localStorage.getItem("requant.web.v1")),
  ).toBeNull();
  expect(
    await page.evaluate(() => localStorage.getItem("requant.web.outbox.v1")),
  ).toBeNull();
  expect(node.broadcasts).toHaveLength(0);
});

test("watch-only backup restores without a password and cannot offer signing", async ({
  page,
  context,
}) => {
  await nodeFixture().install(context);
  await importWallet(page, core("watch", { file: fixture.file }).file, "");
  await expect(page.getByText("Watch-only", { exact: true })).toBeVisible();
  await expect(
    page
      .locator(".balance-panel")
      .getByRole("button", { name: "Send RQT", exact: true }),
  ).toBeDisabled();
});
