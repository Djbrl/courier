import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// Live PayPal moves real money, so its guards run the configuration in a fresh process for each case, the way a
// server would start. Explicit variables win over .env, so the person's own settings don't leak in.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const configUrl = pathToFileURL(path.join(root, "packages/shared/src/config.ts")).href;
const scratch = mkdtempSync(path.join(tmpdir(), "courier-live-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

function start(vars: Record<string, string>) {
  const out = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `const { config } = await import(${JSON.stringify(configUrl)}); console.log(JSON.stringify(config.paypal));`,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        PAYPAL_CLIENT_ID: "id",
        PAYPAL_CLIENT_SECRET: "secret",
        PAYPAL_MODE: "",
        PAYPAL_API_BASE: "",
        PAYPAL_WEB_BASE: "",
        COURIER_URL: "http://localhost:4000",
        STORE_URL: "http://localhost:4100",
        DATA_DIR: path.join(scratch, "data"),
        ...vars,
      },
    },
  );
  if (out.status !== 0) return { error: out.stderr.match(/\[config\][^\n]*/)?.[0] ?? out.stderr };
  return { paypal: JSON.parse(out.stdout.trim().split("\n").at(-1)!) };
}
const liveData = () => path.join(scratch, "live");

test("keys alone mean the sandbox, never live", () => {
  assert.equal(start({}).paypal?.mode, "sandbox");
  assert.equal(start({ PAYPAL_LIVE: "yes" }).paypal?.mode, "sandbox");
});

test("live needs the exact switch, localhost and its own data", () => {
  const live = start({ PAYPAL_LIVE: "real-money", DATA_DIR: liveData() });
  assert.equal(live.paypal?.mode, "live");
  assert.equal(live.paypal?.apiBase, "https://api-m.paypal.com");
  assert.match(start({ PAYPAL_LIVE: "real-money" }).error ?? "", /own data/);
  assert.match(
    start({ PAYPAL_LIVE: "real-money", DATA_DIR: liveData(), COURIER_URL: "https://courier.example.com" }).error ?? "",
    /localhost/,
  );
  assert.match(
    start({ PAYPAL_LIVE: "real-money", DATA_DIR: liveData(), STORE_URL: "https://shop.example.com" }).error ?? "",
    /localhost/,
  );
});

test("live endpoints don't run without the switch, and the switch doesn't run on sandbox endpoints", () => {
  assert.match(start({ PAYPAL_API_BASE: "https://api-m.paypal.com" }).error ?? "", /outside the sandbox/);
  assert.match(start({ PAYPAL_WEB_BASE: "https://www.paypal.com" }).error ?? "", /outside the sandbox/);
  assert.match(
    start({ PAYPAL_LIVE: "real-money", DATA_DIR: liveData(), PAYPAL_API_BASE: "https://api-m.sandbox.paypal.com" })
      .error ?? "",
    /point at the sandbox/,
  );
});

test("a live payment over the cap is refused before anything reaches PayPal", () => {
  const paypalUrl = pathToFileURL(path.join(root, "packages/shared/src/paypal.ts")).href;
  const out = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `globalThis.fetch = () => { throw new Error("reached PayPal"); };
       const { paypal } = await import(${JSON.stringify(paypalUrl)});
       const order = { amountCents: 501, currency: "USD", description: "x", customId: "x", brandName: "x", returnUrl: "http://localhost/r", cancelUrl: "http://localhost/c", intent: "CAPTURE" };
       for (const pay of [() => paypal.createOrder(order, "k1"), () => paypal.chargeVault(order, "v", "k2")])
         console.log(await pay().then(() => "paid", (e) => e.message));`,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        PAYPAL_CLIENT_ID: "id",
        PAYPAL_CLIENT_SECRET: "secret",
        PAYPAL_LIVE: "real-money",
        PAYPAL_MODE: "",
        PAYPAL_API_BASE: "",
        PAYPAL_WEB_BASE: "",
        COURIER_URL: "http://localhost:4000",
        STORE_URL: "http://localhost:4100",
        DATA_DIR: liveData(),
      },
    },
  );
  const lines = out.stdout.trim().split("\n");
  assert.equal(lines.length, 2, out.stderr);
  for (const line of lines) assert.match(line, /capped at \$5\.00/);
});

test("one live payment stays small whatever the setting", () => {
  assert.equal(start({ PAYPAL_LIVE: "real-money", DATA_DIR: liveData() }).paypal?.liveCapCents, 500);
  assert.equal(
    start({ PAYPAL_LIVE: "real-money", DATA_DIR: liveData(), PAYPAL_LIVE_CAP_CENTS: "99999" }).paypal?.liveCapCents,
    2000,
  );
});
