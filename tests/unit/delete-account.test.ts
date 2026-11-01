import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.PAYPAL_MODE = "simulated";
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "courier-delete-"));
const { paypal } = await import("../../packages/shared/src/paypal.ts");
const { db } = await import("../../apps/courier/src/db.ts");
const { deleteAccount } = await import("../../apps/courier/src/visas.ts");

const OF_PERSON = ["connections", "stamps", "approvals", "refresh_tokens", "codes", "errand_sessions", "couriers"];
const OF_VISA = ["holds", "reports", "visa_requests"];

function seed(humanId: string, visaId: string) {
  db.put("humans", humanId, { id: humanId, payerId: `PAYER-${humanId}` });
  db.put("visas", visaId, {
    id: visaId,
    humanId,
    status: "active",
    bond: { amountCents: 500, orderId: "o", authorizationId: `auth-${visaId}`, status: "authorized" },
    autopay: { status: "on" },
  });
  for (const collection of OF_PERSON)
    db.put(collection, `${collection}-${humanId}`, { id: humanId, humanId, authRequestId: `req-${humanId}` });
  for (const collection of OF_VISA)
    db.put(collection, `${collection}-${visaId}`, { visaId, vaultId: `vault-${visaId}` });
  db.put("saved_paypal", humanId, { humanId, vaultId: `vault-${visaId}` });
  db.put("auth_requests", `req-${humanId}`, { id: `req-${humanId}` });
  db.put("clients", `courier-demo-couriers-${humanId}`, { client_id: `courier-demo-couriers-${humanId}` });
}

test("deleting an account releases PayPal first, keeps everything if that fails, and touches nobody else", async () => {
  seed("hum_me", "visa_me");
  seed("hum_other", "visa_other");
  const me = db.get<{ id: string }>("humans", "hum_me") as never;
  const released: string[] = [];
  const realVoid = paypal.voidAuthorization;
  const realDelete = paypal.deleteVaultToken;
  paypal.deleteVaultToken = async (id: string) => void released.push(id);

  paypal.voidAuthorization = async () => {
    throw new Error("PayPal is down");
  };
  assert.equal(await deleteAccount(me), false);
  assert.ok(db.get("humans", "hum_me"), "the account stays");
  assert.ok(db.get("stamps", "stamps-hum_me"), "its records stay");
  assert.equal(db.get<{ status: string }>("visas", "visa_me")?.status, "revoked", "its errands are called back");

  // Trying again retries the bond, even though the errand has already ended.
  paypal.voidAuthorization = async (id: string) => void released.push(id);
  assert.equal(await deleteAccount(me), true);
  assert.deepEqual(released.sort(), ["auth-visa_me", "vault-visa_me"]);

  assert.equal(db.get("humans", "hum_me"), undefined);
  assert.equal(db.get("visas", "visa_me"), undefined);
  assert.equal(db.get("saved_paypal", "hum_me"), undefined);
  assert.equal(db.get("auth_requests", "req-hum_me"), undefined);
  for (const collection of OF_PERSON) assert.equal(db.get(collection, `${collection}-hum_me`), undefined, collection);
  for (const collection of OF_VISA) assert.equal(db.get(collection, `${collection}-visa_me`), undefined, collection);

  assert.ok(db.get("humans", "hum_other"));
  assert.ok(db.get("saved_paypal", "hum_other"));
  assert.equal(db.get<{ status: string }>("visas", "visa_other")?.status, "active");
  assert.ok(db.get("auth_requests", "req-hum_other"));
  for (const collection of OF_PERSON) assert.ok(db.get(collection, `${collection}-hum_other`), collection);
  for (const collection of OF_VISA) assert.ok(db.get(collection, `${collection}-visa_other`), collection);

  paypal.voidAuthorization = realVoid;
  paypal.deleteVaultToken = realDelete;
});
