import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Set before loading configuration: no PayPal sandbox here, so every order reaches the simulator.
const dataDir = mkdtempSync(path.join(tmpdir(), "courier-store-views-"));
process.env.DATA_DIR = dataDir;
process.env.PAYPAL_MODE = "simulated";
const { SHOPS } = await import("../../packages/shared/src/index.ts");
const { shelfOf } = await import("../../apps/store/src/catalog.ts");
const { glyphFor, itemArt } = await import("../../apps/store/src/art.ts");
const { merchantDashboard } = await import("../../apps/store/src/views.ts");
type Order = import("../../apps/store/src/db.ts").Order;

after(() => rmSync(dataDir, { recursive: true, force: true }));

test("every item on every shelf has its own picture, not the fallback", () => {
  for (const shop of SHOPS)
    for (const item of shelfOf(shop.slug))
      assert.notEqual(glyphFor(item, shop.slug), "tag", `${shop.slug}: ${item.title} (${item.category})`);
});

test("an unknown kind of thing gets the fallback, and only a hue reaches the markup", () => {
  assert.equal(glyphFor({ title: "Mystery", category: "nothing-like-it" }), "tag");
  const svg = String(itemArt({ title: "x", category: "nothing-like-it", hue: '1"><script>' as unknown as number }));
  assert.ok(svg.startsWith("<svg"));
  assert.ok(!svg.includes("<script"));
});

const order = (id: string, sub: string, simulated: boolean): Order => ({
  id,
  shop: "amazoo",
  visaId: `visa_${id}`,
  sub,
  agent: "Steve",
  holdId: "hold",
  items: [{ id: "az-001", title: "The Lighthouse Ledger", priceCents: 1500, quantity: 1 }],
  totalCents: 1500,
  status: "paid",
  approveUrl: null,
  createdAt: new Date().toISOString(),
  ...(simulated ? { simulated: true } : {}),
  evidence: {
    visa: { id: `visa_${id}`, intent: null, spend_limit: { value: "50.00" }, per_purchase_limit: { value: "20.00" } },
    intent: null,
    tokenJti: "jti",
    humanVerified: !simulated,
  },
});

test("the dashboard counts simulator orders as demo, never as PayPal sandbox money", () => {
  const page = merchantDashboard(
    [order("o1", "pp_demo_person_1", true), order("o2", "pp_other_person_2", false)],
    [
      {
        id: "r1",
        at: new Date().toISOString(),
        outcome: "accepted",
        reason: "x",
        status: 200,
        sub: "pp_demo_person_1",
        demo: true,
      },
    ],
  );
  assert.match(page, /\$0\.00 in PayPal sandbox/);
  assert.match(page, /\$30\.00 simulated/);
  assert.equal(page.match(/class="mo2 mo-demo"/g)?.length, 2, "both orders are marked demo");
  assert.ok(page.includes('action="/merchant/report/visa_o1"'), "reporting still works from a demo order");
});
