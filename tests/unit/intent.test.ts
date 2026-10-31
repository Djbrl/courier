import assert from "node:assert/strict";
import { test } from "node:test";

process.env.INTENT_MODEL = "rules";
const { checkIntent, rulesIntentCheck } = await import("../../packages/shared/src/intent.ts");

const purchase = (visaIntent: string, title: string, category: string) => ({
  visaIntent,
  merchant: "Juniper Records",
  action: "checkout" as const,
  items: [{ title, category, priceCents: 2900 }],
  totalCents: 2900,
  remainingBudgetCents: 6000,
});

test("a blank purpose approves anything within the limits, without calling a model", async () => {
  const result = await checkIntent(purchase("  ", "Night Bus Freestyles", "cd"));
  assert.equal(result.decision, "approve");
  assert.equal(result.model, "rules");
});

test("a purchase that matches the purpose is approved", () => {
  const result = rulesIntentCheck(purchase("jazz records", "Blue Train: a jazz record", "vinyl"));
  assert.equal(result.decision, "approve");
});

test("a purchase that does not match the purpose goes back to the person", () => {
  const result = rulesIntentCheck(purchase("jazz records for my dad", "Felt slipmat", "accessories"));
  assert.equal(result.decision, "ask_human");
});
