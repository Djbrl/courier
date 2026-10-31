import { createHash } from "node:crypto";
import { checkIntent, config, newId, paypal, requireInternal, type Visa } from "@courier/shared";
import { Router } from "express";
import {
  type Approval,
  db,
  effectiveStatus,
  type Hold,
  pairwiseSubject,
  type Report,
  remainingBudget,
  type SavedPayPalRecord,
  type Stamp,
  type StampKind,
} from "./db.ts";

/* ---------------- stamps ---------------- */

export function addStamp(visa: Visa, kind: StampKind, title: string, detail = ""): Stamp {
  const stamp: Stamp = {
    id: newId("st"),
    visaId: visa.id,
    humanId: visa.humanId,
    kind,
    title,
    detail,
    merchantName: visa.merchantName,
    at: new Date().toISOString(),
  };
  return db.put("stamps", stamp.id, stamp);
}

/* ---------------- lifecycle ---------------- */

/** Records the person's answer to an ask_human request (idempotent once decided). */
export function decideApproval(
  approval: Approval,
  decision: "approved" | "denied",
  via: "page" | "chat" = "page",
): Approval {
  if (approval.status !== "pending") return approval;
  const decided: Approval = { ...approval, status: decision, decidedAt: new Date().toISOString(), via };
  db.put("approvals", approval.id, decided);
  const visa = db.get<Visa>("visas", approval.visaId);
  const what = approval.items.map((i) => i.title).join(", ");
  if (visa)
    addStamp(
      visa,
      decision === "approved" ? "approval" : "blocked",
      decision === "approved" ? "You allowed it" : "You declined it",
      via === "chat" ? `${what} · answered in Claude` : what,
    );
  return decided;
}

/** Deletes the errand's saved PayPal at PayPal, so nothing more can be charged to it. Returns a note for the stamp. */
export async function forgetSavedPayPal(visa: Visa): Promise<string> {
  if (visa.autopay?.status !== "on") return "";
  const saved = db.get<SavedPayPalRecord>("saved_paypal", visa.id);
  try {
    if (saved?.vaultId) await paypal.deleteVaultToken(saved.vaultId);
    db.delete("saved_paypal", visa.id);
    visa.autopay = { ...visa.autopay, status: "removed" };
    return " Saved PayPal removed.";
  } catch (error) {
    console.warn(`[autopay] could not delete the saved PayPal for ${visa.id}:`, (error as Error).message);
    return ` Removing the saved PayPal failed: ${(error as Error).message}`;
  }
}

/** Revokes a visa, releases its bond (void) if one is held, and removes its saved PayPal. */
export async function revokeVisa(visaId: string, reason: string): Promise<Visa | undefined> {
  const visa = db.get<Visa>("visas", visaId);
  if (!visa) return undefined;
  if (visa.status === "revoked") return visa;
  let bondNote = "";
  if (visa.bond?.status === "authorized" && visa.bond.authorizationId) {
    try {
      await paypal.voidAuthorization(visa.bond.authorizationId);
      visa.bond.status = "voided";
      bondNote = " Bond released.";
    } catch (error) {
      bondNote = ` Bond release failed: ${(error as Error).message}`;
    }
  }
  bondNote += await forgetSavedPayPal(visa);
  visa.status = "revoked";
  visa.revokedAt = new Date().toISOString();
  visa.revokeReason = reason;
  db.put("visas", visa.id, visa);
  // Kill outstanding refresh tokens for this visa.
  for (const rt of db.list<{ id: string; visaId: string; revoked: boolean }>(
    "refresh_tokens",
    (r) => r.visaId === visaId,
  )) {
    db.put("refresh_tokens", rt.id, { ...rt, revoked: true });
  }
  addStamp(visa, "revoked", "Visa revoked", `${reason}.${bondNote}`);
  return visa;
}

/** Includes errands abandoned on a PayPal page, so they don't linger. */
const SWEPT: Visa["status"][] = ["active", "pending_bond", "pending_paypal"];

/** Sweeps expired visas: releases bonds and saved PayPal that are no longer needed. Runs on a timer. */
export async function sweepExpiredVisas(): Promise<void> {
  const now = Date.now();
  for (const visa of db.list<Visa>(
    "visas",
    (v) => SWEPT.includes(v.status) && new Date(v.expiresAt).getTime() <= now,
  )) {
    if (visa.bond?.status === "authorized" && visa.bond.authorizationId) {
      try {
        await paypal.voidAuthorization(visa.bond.authorizationId);
        visa.bond.status = "voided";
      } catch (error) {
        console.warn(`[sweep] could not void bond for ${visa.id}:`, (error as Error).message);
      }
    }
    const savedNote = await forgetSavedPayPal(visa);
    visa.status = "expired";
    db.put("visas", visa.id, visa);
    addStamp(
      visa,
      "bond",
      "Visa expired cleanly",
      `${visa.bond ? "Bond released, nothing charged." : ""}${savedNote}`.trim(),
    );
  }
}

/* ---------------- internal API used by merchants (the demo store) ---------------- */

interface SpendItem {
  title: string;
  category: string;
  priceCents: number;
  quantity?: number;
}

function fingerprint(visaId: string, action: string, items: SpendItem[], totalCents: number): string {
  return createHash("sha256")
    .update(
      JSON.stringify({ visaId, action, items: items.map((i) => [i.title, i.priceCents, i.quantity ?? 1]), totalCents }),
    )
    .digest("hex")
    .slice(0, 32);
}

function itemsKey(items: { title: string; priceCents: number }[], totalCents: number): string {
  return JSON.stringify({ items: items.map((i) => [i.title, i.priceCents]).sort(), totalCents });
}

export const internalRouter = Router();
internalRouter.use(requireInternal);

internalRouter.get("/visas/:id", (req, res) => {
  const visa = db.get<Visa>("visas", req.params.id);
  if (!visa) {
    res.status(404).json({ error: "visa not found" });
    return;
  }
  res.json({
    id: visa.id,
    status: effectiveStatus(visa),
    resource: visa.resource,
    spentCents: visa.spentCents,
    spendLimitCents: visa.spendLimitCents,
    perPurchaseLimitCents: visa.perPurchaseLimitCents,
    remainingCents: remainingBudget(visa),
    expiresAt: visa.expiresAt,
    bond: visa.bond ?? null,
  });
});

/**
 * Spend authority. Called by the merchant before reserving or creating a PayPal order.
 * 1. Hard limits in code (never delegated to a model). 2. Intent check. 3. Hold the budget.
 */
internalRouter.post("/spend/check", async (req, res) => {
  const { visaId, sub, resource, action, items, totalCents, agentNote, approvalId } = req.body as {
    visaId: string;
    sub: string;
    resource: string;
    action: "reserve" | "checkout";
    items: SpendItem[];
    totalCents: number;
    agentNote?: string;
    approvalId?: string;
  };

  const visa = db.get<Visa>("visas", visaId);
  const deny = (code: string, reason: string, extra: Record<string, unknown> = {}) => {
    if (visa) addStamp(visa, "blocked", `Blocked ${action}`, reason);
    res.json({ decision: "deny", code, reason, ...extra });
  };

  if (!visa) return deny("unknown_visa", "This visa does not exist.");
  if (effectiveStatus(visa) !== "active") return deny("visa_inactive", `This visa is ${effectiveStatus(visa)}.`);
  if (visa.resource !== resource) return deny("wrong_merchant", "This visa was issued for a different merchant.");
  if (pairwiseSubject(visa.humanId, visa.resource) !== sub)
    return deny("subject_mismatch", "Token subject does not match the visa holder.");

  const neededScope = action === "checkout" ? "store:buy" : "store:reserve";
  if (!visa.scopes.includes(neededScope))
    return deny("insufficient_scope", `The visa does not include "${neededScope}".`);

  if (!Array.isArray(items) || items.length === 0 || !Number.isInteger(totalCents) || totalCents <= 0) {
    return deny("bad_request", "Nothing to authorize.");
  }

  if (action === "checkout") {
    if (totalCents > visa.perPurchaseLimitCents) {
      return deny(
        "per_purchase_limit",
        `$${(totalCents / 100).toFixed(2)} is over the per-purchase limit of $${(visa.perPurchaseLimitCents / 100).toFixed(2)}.`,
        { model: "code", modelCalled: false },
      );
    }
    const remaining = remainingBudget(visa);
    if (totalCents > remaining) {
      return deny(
        "spend_limit",
        `$${(totalCents / 100).toFixed(2)} is over the remaining visa budget of $${(remaining / 100).toFixed(2)}.`,
        { model: "code", modelCalled: false },
      );
    }
  }

  const fp = fingerprint(visa.id, action, items, totalCents);

  // A human already approved this exact action.
  let approvedByHuman = false;
  if (approvalId) {
    const approval = db.get<Approval>("approvals", approvalId);
    if (approval && approval.visaId === visa.id && approval.fingerprint === fp) {
      if (approval.status === "approved") approvedByHuman = true;
      else if (approval.status === "denied") return deny("human_denied", "The person declined this action.");
      else {
        res.json({
          decision: "ask_human",
          reason: "Still waiting for the person to decide.",
          approvalId: approval.id,
          approvalUrl: `${config.courier.url}/approvals/${approval.id}`,
        });
        return;
      }
    }
  }

  // One yes covers the same items for the rest of the errand: allowing a hold also allows buying it, and back.
  if (!approvedByHuman) {
    const key = itemsKey(items, totalCents);
    approvedByHuman = db
      .list<Approval>("approvals", (a) => a.visaId === visa.id && a.status === "approved")
      .some((a) => itemsKey(a.items, a.totalCents) === key);
  }

  let intent = null as Awaited<ReturnType<typeof checkIntent>> | null;
  if (!approvedByHuman) {
    intent = await checkIntent({
      visaIntent: visa.intent,
      merchant: visa.merchantName,
      action,
      items: items.map((i) => ({ title: i.title, category: i.category, priceCents: i.priceCents })),
      totalCents,
      remainingBudgetCents: remainingBudget(visa),
      agentNote,
    });

    if (intent.decision === "deny") return deny("intent_denied", intent.reason, { intent });
    if (intent.decision === "ask_human") {
      const approval: Approval = {
        id: newId("apv"),
        visaId: visa.id,
        humanId: visa.humanId,
        action,
        items: items.map((i) => ({ title: i.title, category: i.category, priceCents: i.priceCents })),
        totalCents,
        reason: intent.reason,
        model: intent.model,
        probability: intent.probability,
        fingerprint: fp,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      db.put("approvals", approval.id, approval);
      addStamp(visa, "approval", `Asked you about a ${action}`, intent.reason);
      res.json({
        decision: "ask_human",
        reason: intent.reason,
        intent,
        approvalId: approval.id,
        approvalUrl: `${config.courier.url}/approvals/${approval.id}`,
      });
      return;
    }
  }

  let holdId: string | null = null;
  if (action === "checkout") {
    // Re-check after the (async) intent check, so two concurrent checkouts can't both slip under the limit.
    const fresh = db.get<Visa>("visas", visa.id)!;
    if (effectiveStatus(fresh) !== "active") return deny("visa_inactive", `This visa is ${effectiveStatus(fresh)}.`);
    const remainingNow = remainingBudget(fresh);
    if (totalCents > remainingNow) {
      return deny(
        "spend_limit",
        `$${(totalCents / 100).toFixed(2)} is over the remaining visa budget of $${(remainingNow / 100).toFixed(2)}.`,
        { model: "code", modelCalled: false },
      );
    }
    const hold: Hold = {
      id: newId("hold"),
      visaId: visa.id,
      amountCents: totalCents,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      committed: false,
    };
    db.put("holds", hold.id, hold);
    holdId = hold.id;
  } else {
    addStamp(
      visa,
      "reserve",
      `Reserved ${items.map((i) => i.title).join(", ")}`,
      `Within your visa for ${visa.merchantName}.`,
    );
  }

  res.json({
    decision: "approve",
    reason: approvedByHuman ? "Approved by the person." : intent!.reason,
    intent,
    holdId,
    autopay: action === "checkout" && visa.autopay?.status === "on",
    remainingCents: remainingBudget(visa),
  });
});

/** Called by the merchant after PayPal captured a payment. */
internalRouter.post("/spend/commit", (req, res) => {
  const { visaId, holdId, orderId, amountCents, summary, paidWith } = req.body as {
    visaId: string;
    holdId: string;
    orderId: string;
    amountCents: number;
    summary: string;
    paidWith?: "paypal_page" | "saved_paypal";
  };
  const visa = db.get<Visa>("visas", visaId);
  const hold = db.get<Hold>("holds", holdId);
  if (!visa || !hold || hold.visaId !== visaId) {
    res.status(404).json({ error: "unknown visa or hold" });
    return;
  }
  if (!hold.committed) {
    db.put("holds", hold.id, { ...hold, committed: true });
    visa.spentCents += amountCents;
    db.put("visas", visa.id, visa);
    addStamp(
      visa,
      "purchase",
      summary,
      `${paidWith === "saved_paypal" ? "Paid with saved PayPal · " : ""}PayPal order ${orderId} · $${(amountCents / 100).toFixed(2)}`,
    );
  }
  res.json({ ok: true, spentCents: visa.spentCents, remainingCents: remainingBudget(visa) });
});

/**
 * Pays a checkout with the errand's saved PayPal. Courier, not the shop, holds the saved PayPal, so the shop asks
 * Courier to charge an approved hold. Only the exact held amount can be charged, once (idempotent per hold). The
 * shop then commits the spend as for any paid order.
 */
internalRouter.post("/spend/charge", async (req, res) => {
  const { visaId, holdId, description, brandName, items } = req.body as {
    visaId: string;
    holdId: string;
    description: string;
    brandName: string;
    items?: { name: string; unitCents: number; quantity: number; sku?: string }[];
  };
  const visa = db.get<Visa>("visas", visaId);
  const hold = db.get<Hold>("holds", holdId);
  const saved = db.get<SavedPayPalRecord>("saved_paypal", visaId);
  if (!visa || !hold || hold.visaId !== visaId) {
    res.status(404).json({ error: "unknown visa or hold" });
    return;
  }
  if (effectiveStatus(visa) !== "active" || visa.autopay?.status !== "on" || !saved?.vaultId) {
    res.status(409).json({ error: "This errand has no saved PayPal to charge." });
    return;
  }
  if (hold.committed || new Date(hold.expiresAt).getTime() <= Date.now()) {
    res.status(409).json({ error: "This hold was already used or has expired." });
    return;
  }
  try {
    const order = await paypal.chargeVault(
      { amountCents: hold.amountCents, currency: visa.currency, description, customId: visa.id, brandName, items },
      saved.vaultId,
      `charge-${hold.id}`,
    );
    res.json({ orderId: order.id, status: order.status, captureId: order.captureId ?? null });
  } catch (error) {
    console.warn(`[autopay] charge failed for ${visa.id}:`, (error as Error).message);
    res.status(502).json({ error: "PayPal didn't take the payment from the saved PayPal." });
  }
});

/** Releases a hold when a checkout is cancelled. */
internalRouter.post("/spend/release", (req, res) => {
  const hold = db.get<Hold>("holds", req.body.holdId);
  if (hold && !hold.committed) db.put("holds", hold.id, { ...hold, expiresAt: new Date(0).toISOString() });
  res.json({ ok: true });
});

/** Where an ask stands, so the shop can wait for the person's answer on Courier's page. */
internalRouter.get("/approvals/:id", (req, res) => {
  const approval = db.get<Approval>("approvals", req.params.id);
  if (!approval) {
    res.status(404).json({ error: "approval not found" });
    return;
  }
  res.json({ status: approval.status });
});

/**
 * The person answered Courier's question inside their chat app (an MCP elicitation the client shows to the human;
 * the model can't answer it). Only the visa the ask belongs to can record the answer.
 */
internalRouter.post("/approvals/:id/decide", (req, res) => {
  const approval = db.get<Approval>("approvals", req.params.id);
  if (!approval || approval.visaId !== req.body.visaId) {
    res.status(404).json({ error: "approval not found" });
    return;
  }
  res.json({
    status: decideApproval(approval, req.body.decision === "approved" ? "approved" : "denied", "chat").status,
  });
});

internalRouter.post("/stamps", (req, res) => {
  const visa = db.get<Visa>("visas", req.body.visaId);
  if (!visa) {
    res.status(404).json({ error: "visa not found" });
    return;
  }
  // Avoid flooding the errand with browse stamps: one per 10 minutes.
  if (req.body.kind === "browse") {
    const recent = db.list<Stamp>(
      "stamps",
      (s) => s.visaId === visa.id && s.kind === "browse" && Date.now() - new Date(s.at).getTime() < 10 * 60 * 1000,
      50,
    );
    if (recent.length) {
      res.json({ ok: true, skipped: true });
      return;
    }
  }
  addStamp(visa, req.body.kind, req.body.title, req.body.detail ?? "");
  res.json({ ok: true });
});

/** A merchant reports abuse by an agent. Suspends the visa and claims the bond, if any. */
internalRouter.post("/report", async (req, res) => {
  const { visaId, reason, evidence } = req.body as { visaId: string; reason: string; evidence?: unknown };
  const visa = db.get<Visa>("visas", visaId);
  if (!visa) {
    res.status(404).json({ error: "visa not found" });
    return;
  }
  let bondOutcome = "no bond on this visa";
  if (visa.bond?.status === "authorized" && visa.bond.authorizationId) {
    try {
      const capture = await paypal.captureAuthorization(visa.bond.authorizationId, `bond-capture-${visa.id}`);
      visa.bond.status = "captured";
      bondOutcome = `bond of $${(visa.bond.amountCents / 100).toFixed(2)} captured (${capture.captureId})`;
    } catch (error) {
      bondOutcome = `bond capture failed: ${(error as Error).message}`;
    }
  }
  bondOutcome += (await forgetSavedPayPal(visa)).replace(/^ /, " · ");
  visa.status = "suspended";
  visa.revokedAt = new Date().toISOString();
  visa.revokeReason = `Reported by ${visa.merchantName}: ${reason}`;
  db.put("visas", visa.id, visa);
  const report: Report = {
    id: newId("rpt"),
    visaId,
    reason,
    evidence: evidence ?? null,
    bondOutcome,
    at: new Date().toISOString(),
  };
  db.put("reports", report.id, report);
  addStamp(visa, "report", `Reported by ${visa.merchantName}`, `${reason} · ${bondOutcome}`);
  res.json({ ok: true, status: visa.status, bondOutcome });
});
