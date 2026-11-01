import { createHash } from "node:crypto";
import {
  ALL_SCOPES,
  COURIER_RESOURCE,
  checkIntent,
  config,
  DURATIONS,
  newId,
  paypalFor,
  requireInternal,
  shopForResource,
  type Visa,
} from "@courier/shared";
import { Router } from "express";
import { mintAccessToken } from "./auth/oauth.ts";
import {
  type Approval,
  type AuthCode,
  type AuthRequest,
  activeTicket,
  anyShop,
  type Connection,
  type Courier,
  connectionAgent,
  db,
  effectiveStatus,
  findMerchant,
  type Hold,
  type Human,
  listCouriers,
  pairwiseSubject,
  type Report,
  remainingBudget,
  type SavedPayPalRecord,
  type Stamp,
  type StampKind,
  saveCourier,
} from "./db.ts";
import { demoClientId } from "./pages/shared.ts";

/* ---------------- stamps ---------------- */

export function addStamp(visa: Visa, kind: StampKind, title: string, detail = "", merchantName?: string): Stamp {
  const stamp: Stamp = {
    id: newId("st"),
    visaId: visa.id,
    humanId: visa.humanId,
    kind,
    title,
    detail,
    merchantName: merchantName ?? visa.merchantName,
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

const paypalOf = (humanId: string) => paypalFor(db.get<Human>("humans", humanId));

export const savedPayPal = (humanId: string) => db.get<SavedPayPalRecord>("saved_paypal", humanId);

/** Deletes the person's saved PayPal at PayPal, so nothing more can be charged to it. False if PayPal refused. */
export async function removeSavedPayPal(humanId: string): Promise<boolean> {
  const saved = savedPayPal(humanId);
  if (!saved) return true;
  try {
    await paypalOf(humanId).deleteVaultToken(saved.vaultId);
  } catch (error) {
    console.warn(`[autopay] could not delete the saved PayPal for ${humanId}:`, (error as Error).message);
    return false;
  }
  db.delete("saved_paypal", humanId);
  for (const visa of db.list<Visa>("visas", (v) => v.humanId === humanId && v.autopay?.status === "on", Infinity))
    db.put("visas", visa.id, { ...visa, autopay: { ...visa.autopay, status: "removed" } });
  return true;
}

/** Saved PayPal used to be kept per errand: moves any such record onto its person, and drops the leftovers. */
export function migrateSavedPayPal(): void {
  for (const old of db.list<{ visaId?: string; vaultId?: string | null; email?: string }>(
    "saved_paypal",
    (r) => Boolean(r.visaId),
    Infinity,
  )) {
    const visa = db.get<Visa>("visas", old.visaId!);
    if (visa && old.vaultId && !savedPayPal(visa.humanId))
      db.put<SavedPayPalRecord>("saved_paypal", visa.humanId, {
        humanId: visa.humanId,
        vaultId: old.vaultId,
        email: visa.autopay?.email,
      });
    db.delete("saved_paypal", old.visaId!);
  }
}

/** Releases a held bond at PayPal, if there is one. Returns a note for the stamp. */
async function releaseBond(visa: Visa): Promise<string> {
  if (visa.bond?.status !== "authorized" || !visa.bond.authorizationId) return "";
  try {
    await paypalOf(visa.humanId).voidAuthorization(visa.bond.authorizationId);
    visa.bond.status = "voided";
    return " Bond released.";
  } catch (error) {
    return ` Bond release failed: ${(error as Error).message}`;
  }
}

/** Revokes a visa and releases its bond (void) if one is held. The person's saved PayPal stays for their next errand. */
export async function revokeVisa(visaId: string, reason: string): Promise<Visa | undefined> {
  const visa = db.get<Visa>("visas", visaId);
  if (!visa) return undefined;
  if (visa.status === "revoked") return visa;
  const bondNote = await releaseBond(visa);
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
  addStamp(visa, "revoked", "Called back", `${reason}.${bondNote}`);
  return visa;
}

/** Removes a Claude from Courier: its tokens stop working, its errands end and its courier is free again. */
export async function disconnect(connection: Connection): Promise<void> {
  db.put<Connection>("connections", connection.id, {
    ...connection,
    status: "revoked",
    revokedAt: new Date().toISOString(),
  });
  for (const rt of db.list<{ id: string; connectionId?: string; revoked: boolean }>(
    "refresh_tokens",
    (r) => r.connectionId === connection.id,
  )) {
    db.put("refresh_tokens", rt.id, { ...rt, revoked: true });
  }
  for (let ticket = activeTicket(connection); ticket; ticket = activeTicket(connection))
    await revokeVisa(ticket.id, "Claude was disconnected");
  for (const courier of listCouriers(connection.humanId).filter((c) => c.clientId === connection.clientId)) {
    const { clientId: _clientId, clientName: _clientName, boundAt: _boundAt, ...free } = courier;
    saveCourier(free as Courier);
  }
}

/**
 * Erases a person from Courier. Returns false, having erased nothing, if PayPal wouldn't release a bond or saved PayPal:
 * once the records are gone, nothing could release them. Safe to run again. The shop keeps its own order records, which
 * carry only the pseudonym, so receipts keep working.
 */
export async function deleteAccount(human: Human): Promise<boolean> {
  const theirs = (doc: { humanId: string }) => doc.humanId === human.id;
  const visas = db.list<Visa>("visas", theirs, Infinity);
  let released = true;
  for (const { id } of visas) {
    const visa = (await revokeVisa(id, "Account deleted"))!;
    // Also retries a bond PayPal refused to release when this errand ended earlier.
    await releaseBond(visa);
    db.put("visas", visa.id, visa);
    if (visa.bond?.status === "authorized") released = false;
  }
  if (!(await removeSavedPayPal(human.id)) || !released) return false;

  const visaIds = new Set(visas.map((v) => v.id));
  const ofTheirVisa = (doc: { visaId: string }) => visaIds.has(doc.visaId);
  const requestIds = new Set(db.list<AuthCode>("codes", theirs, Infinity).map((c) => c.authRequestId));
  db.deleteWhere<AuthRequest>(
    "auth_requests",
    (r) => requestIds.has(r.id) || r.ticket?.humanId === human.id || visaIds.has(r.visaId ?? ""),
  );
  for (const collection of ["codes", "refresh_tokens", "connections", "stamps", "approvals", "errand_sessions"])
    db.deleteWhere(collection, theirs);
  for (const collection of ["holds", "reports", "visa_requests"]) db.deleteWhere(collection, ofTheirVisa);
  for (const courier of listCouriers(human.id)) db.delete("clients", demoClientId(courier.id));
  db.deleteWhere("couriers", theirs);
  db.deleteWhere("visas", theirs);
  // Last, so a crash part-way leaves an account the person can still sign in to and delete.
  db.delete("humans", human.id);
  return true;
}

export function issuedStamps(visa: Visa): void {
  if (visa.autopay?.status === "on")
    addStamp(
      visa,
      "visa_issued",
      "Pays with your saved PayPal",
      "Purchases within your limits are paid straight away.",
    );
  addStamp(
    visa,
    "visa_issued",
    `Errand given to ${visa.agentName}`,
    `${visa.merchantName} · up to $${(visa.spendLimitCents / 100).toFixed(0)}${visa.bond ? " · bonded" : ""}`,
  );
}

/** One errand at a time on an older per-shop connector. Through the Courier connector, errands run side by side. */
export async function endEarlierErrands(visa: Visa): Promise<void> {
  if (anyShop(visa)) return;
  for (const old of db.list<Visa>(
    "visas",
    (v) =>
      v.id !== visa.id &&
      v.humanId === visa.humanId &&
      v.clientId === visa.clientId &&
      !anyShop(v) &&
      effectiveStatus(v) === "active",
    Infinity,
  ))
    await revokeVisa(old.id, "Replaced by a new errand");
}

/* ---------------- errands through the Courier connector ---------------- */

const DAY_MS = 24 * 60 * 60 * 1000;

/** What Claude has started on its own in the last 24 hours. An errand that ended only counts what it spent. */
function startedToday(humanId: string): number {
  const since = Date.now() - DAY_MS;
  return db
    .list<Visa>(
      "visas",
      (v) => v.humanId === humanId && v.autoStarted === true && Date.parse(v.createdAt) > since,
      Infinity,
    )
    .reduce((sum, v) => sum + (effectiveStatus(v) === "active" ? v.spendLimitCents : v.spentCents), 0);
}

/** Whether Claude may start an errand this big with no click. Enforced here, because the amount comes from a model. */
export function withinCap(human: Human, cents: number): boolean {
  const cap = human.cap;
  return Boolean(cap && cents <= cap.perErrandCents && startedToday(human.id) + cents <= cap.perDayCents);
}

/** The cap a person typed, or null for "always ask me". */
export function parseCap(perErrand: unknown, perDay: unknown): Human["cap"] {
  const dollars = (value: unknown, max: number) => Math.min(max, Math.max(0, Math.floor(Number(value)) || 0));
  const perErrandCents = dollars(perErrand, 500) * 100;
  const perDayCents = dollars(perDay, 2000) * 100;
  return perErrandCents && perDayCents ? { perErrandCents, perDayCents } : null;
}

/** One errand: one budget, any shop, side by side with the person's other errands, over in 24 hours at the latest. */
export function issueErrand(opts: {
  connection: Connection;
  human: Human;
  courierName: string;
  what: string;
  budget: number;
  auto: boolean;
}): Visa {
  const saved = savedPayPal(opts.human.id);
  const now = Date.now();
  const visa: Visa = {
    id: newId("visa"),
    humanId: opts.human.id,
    clientId: opts.connection.clientId,
    agentName: opts.courierName,
    resource: COURIER_RESOURCE,
    merchantName: "any shop",
    scopes: opts.connection.scopes,
    spendLimitCents: opts.budget * 100,
    perPurchaseLimitCents: opts.budget * 100,
    spentCents: 0,
    currency: "USD",
    intent: opts.what.trim().slice(0, 160),
    status: "active",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + DAY_MS).toISOString(),
    bond: null,
    ...(saved ? { autopay: { status: "on" as const, email: saved.email } } : {}),
    ...(opts.auto ? { autoStarted: true } : {}),
  };
  db.put("visas", visa.id, visa);
  issuedStamps(visa);
  return visa;
}

/** Includes errands abandoned on a PayPal page, so they don't linger. */
const SWEPT: Visa["status"][] = ["active", "pending_bond", "pending_paypal"];

/** Sweeps expired visas: releases bonds that are no longer needed. Runs on a timer. */
export async function sweepExpiredVisas(): Promise<void> {
  const now = Date.now();
  for (const visa of db.list<Visa>(
    "visas",
    (v) => SWEPT.includes(v.status) && new Date(v.expiresAt).getTime() <= now,
  )) {
    if (visa.bond?.status === "authorized" && visa.bond.authorizationId) {
      try {
        await paypalOf(visa.humanId).voidAuthorization(visa.bond.authorizationId);
        visa.bond.status = "voided";
      } catch (error) {
        console.warn(`[sweep] could not void bond for ${visa.id}:`, (error as Error).message);
      }
    }
    visa.status = "expired";
    db.put("visas", visa.id, visa);
    addStamp(visa, "bond", "Errand ended on time", visa.bond ? "Bond released, nothing charged." : "");
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
 * A connected Claude's current standing. The ticket comes as a signed, short-lived token, so the shop verifies it and
 * keeps it as proof exactly as it would a visa in an access token.
 */
internalRouter.get("/connections/:id", async (req, res) => {
  const connection = db.get<Connection>("connections", req.params.id);
  const human = connection ? db.get<Human>("humans", connection.humanId) : undefined;
  if (!connection || !human) {
    res.status(404).json({ error: "connection not found" });
    return;
  }
  // Errands through the Courier connector reach the shop with each call, not through the connection.
  const ticket =
    connection.status === "active" && connection.resource !== COURIER_RESOURCE ? activeTicket(connection) : undefined;
  res.json({
    status: connection.status,
    agent: connectionAgent(connection),
    ticketToken: ticket
      ? (await mintAccessToken(ticket, human, connection.clientId, { expiresInSeconds: 60 })).token
      : null,
  });
});

const wholeDollars = (value: unknown, fallback: number) => {
  const dollars = typeof value === "number" && Number.isFinite(value) ? Math.ceil(value) : fallback;
  return Math.min(500, Math.max(1, dollars));
};

/** A link for the person to write a ticket, prefilled from the agent's suggestion. Nothing applies until they send it. */
internalRouter.post("/connections/:id/ticket", async (req, res) => {
  const connection = db.get<Connection>("connections", req.params.id);
  if (connection?.status !== "active") {
    res.status(404).json({ error: "connection not found" });
    return;
  }
  const { purpose, maxPerItem, maxTotal, price, budgetFromPerson } = req.body as {
    purpose?: unknown;
    maxPerItem?: unknown;
    maxTotal?: unknown;
    price?: unknown;
    budgetFromPerson?: unknown;
  };
  const intent = typeof purpose === "string" ? purpose.trim().slice(0, 160) : "";
  // The person set this in a dialog in their chat app, which the model can't answer. With PayPal already saved, there's
  // nothing left to do in a browser.
  const budget = Number(budgetFromPerson);
  const human = db.get<Human>("humans", connection.humanId);
  const saved = savedPayPal(connection.humanId);
  const merchant = findMerchant(connection.resource);
  if (Number.isInteger(budget) && budget >= 1 && budget <= 500 && human && saved && merchant) {
    const now = Date.now();
    const visa: Visa = {
      id: newId("visa"),
      humanId: human.id,
      clientId: connection.clientId,
      agentName: connectionAgent(connection),
      resource: merchant.resource,
      merchantName: merchant.name,
      scopes: connection.scopes,
      spendLimitCents: budget * 100,
      perPurchaseLimitCents: budget * 100,
      spentCents: 0,
      currency: "USD",
      intent,
      status: "active",
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + DURATIONS["7d"].ms).toISOString(),
      bond: null,
      autopay: { status: "on", email: saved.email },
    };
    db.put("visas", visa.id, visa);
    issuedStamps(visa);
    await endEarlierErrands(visa);
    res.json({ issued: true });
    return;
  }
  const perPurchaseLimit = wholeDollars(maxPerItem, Math.max(40, wholeDollars(price, 40)));
  const request: AuthRequest = {
    id: newId("ar"),
    clientId: connection.clientId,
    clientName: connection.clientName,
    redirectUri: "",
    codeChallenge: "",
    scopes: [...ALL_SCOPES],
    resource: connection.resource,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
    ticket: {
      connectionId: connection.id,
      humanId: connection.humanId,
      intent,
      perPurchaseLimit,
      spendLimit: budgetFromPerson
        ? wholeDollars(budgetFromPerson, 60)
        : Math.max(perPurchaseLimit, wholeDollars(maxTotal, 60)),
    },
  };
  db.put("auth_requests", request.id, request);
  res.json({ url: `${config.courier.url}/consent/${request.id}${budgetFromPerson ? "?pay=1" : ""}` });
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
    if (visa) addStamp(visa, "blocked", `Blocked ${action}`, reason, shopForResource(resource)?.name);
    res.json({ decision: "deny", code, reason, ...extra });
  };

  if (!visa) return deny("unknown_visa", "This visa does not exist.");
  if (effectiveStatus(visa) !== "active") return deny("visa_inactive", `This visa is ${effectiveStatus(visa)}.`);
  const shop = shopForResource(resource);
  if (visa.resource !== resource && !(anyShop(visa) && shop))
    return deny("wrong_merchant", "This visa was issued for a different merchant.");
  if (pairwiseSubject(visa.humanId, resource) !== sub)
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
  if (!approvedByHuman && config.intent.enabled && visa.intent.trim()) {
    intent = await checkIntent({
      visaIntent: visa.intent,
      merchant: shop?.name ?? visa.merchantName,
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
      `Within your visa for ${shop?.name ?? visa.merchantName}.`,
      shop?.name,
    );
  }

  res.json({
    decision: "approve",
    reason: approvedByHuman ? "Approved by the person." : (intent?.reason ?? "Inside the limits."),
    intent: intent ?? {
      model: approvedByHuman ? "human" : "limits",
      reason: approvedByHuman ? "Approved by the person." : "Inside the limits.",
    },
    holdId,
    autopay: action === "checkout" && visa.autopay?.status === "on",
    remainingCents: remainingBudget(visa),
  });
});

/** Called by the merchant after PayPal captured a payment. */
internalRouter.post("/spend/commit", (req, res) => {
  const { visaId, holdId, orderId, amountCents, summary, paidWith, merchantName } = req.body as {
    visaId: string;
    holdId: string;
    orderId: string;
    amountCents: number;
    summary: string;
    paidWith?: "paypal_page" | "saved_paypal";
    merchantName?: string;
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
      `${merchantName ? `${merchantName} · ` : ""}${paidWith === "saved_paypal" ? "Paid with saved PayPal · " : ""}PayPal order ${orderId} · $${(amountCents / 100).toFixed(2)}`,
      merchantName,
    );
    // Nothing left to spend: the errand is over, and shows as done rather than out.
    if (anyShop(visa) && effectiveStatus(visa) === "active" && remainingBudget(visa) === 0) {
      visa.status = "expired";
      visa.revokeReason = "Budget used up";
      db.put("visas", visa.id, visa);
    }
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
  const saved = visa && savedPayPal(visa.humanId);
  if (!visa || !hold || hold.visaId !== visaId) {
    res.status(404).json({ error: "unknown visa or hold" });
    return;
  }
  if (effectiveStatus(visa) !== "active" || visa.autopay?.status !== "on" || !saved) {
    res.status(409).json({ error: "This errand has no saved PayPal to charge." });
    return;
  }
  if (hold.committed || new Date(hold.expiresAt).getTime() <= Date.now()) {
    res.status(409).json({ error: "This hold was already used or has expired." });
    return;
  }
  try {
    const order = await paypalOf(visa.humanId).chargeVault(
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
  addStamp(visa, req.body.kind, req.body.title, req.body.detail ?? "", req.body.merchantName);
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
      const capture = await paypalOf(visa.humanId).captureAuthorization(
        visa.bond.authorizationId,
        `bond-capture-${visa.id}`,
      );
      visa.bond.status = "captured";
      bondOutcome = `bond of $${(visa.bond.amountCents / 100).toFixed(2)} captured (${capture.captureId})`;
    } catch (error) {
      bondOutcome = `bond capture failed: ${(error as Error).message}`;
    }
  }
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
