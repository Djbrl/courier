import { createHmac } from "node:crypto";
import {
  ALL_SCOPES,
  type CourierColor,
  config,
  DocStore,
  newId,
  type Scope,
  STORE_RESOURCE,
  type Visa,
} from "@courier/shared";

export const db = new DocStore("courier");

/* ---------------- record types ---------------- */

export interface Human {
  id: string;
  payerId: string;
  verified: boolean;
  ageRange: string | null;
  accountType: string | null;
  /** First name the person gave their courier (or PayPal's display name, when shared). Never sent to merchants. */
  displayName?: string | null;
  createdAt: string;
  lastLoginAt: string;
}

/**
 * A person's courier: a named agent identity. One courier per AI assistant: the demo one in the errand room has its
 * own OAuth client, and a person's own Claude is bound to a courier (by its OAuth client id) the first time it asks
 * for an errand. Each errand is then a separate visa, one shop, one budget, one return time.
 */
export interface Courier {
  /** Courier id. A person's first courier uses their human id. */
  id: string;
  humanId: string;
  name: string;
  color: CourierColor;
  /** The model it runs on, shown as a small detail. */
  model: string;
  idNo: string;
  /** "demo": the in-browser stand-in for Claude; "claude": the person's own Claude via the connector. */
  mode: "demo" | "claude";
  /** The OAuth client (the person's own Claude connector) that acts as this courier, once bound. */
  clientId?: string;
  clientName?: string;
  boundAt?: string;
  createdAt: string;
}

/** A person's own Claude, connected to Courier. Outlives errands: it ends only when the person disconnects it. */
export interface Connection {
  id: string;
  humanId: string;
  clientId: string;
  clientName: string;
  resource: string;
  scopes: Scope[];
  status: "active" | "revoked";
  createdAt: string;
  revokedAt?: string;
}

export interface Merchant {
  resource: string;
  name: string;
  homepage: string;
  scopes: Scope[];
}

export interface AuthRequest {
  id: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  scopes: Scope[];
  resource: string;
  createdAt: string;
  expiresAt: string;
  visaId?: string;
  completed?: boolean;
  /** Set when this asks for an errand ticket on an existing connection, rather than an OAuth grant. */
  ticket?: {
    connectionId: string;
    humanId: string;
    /** Prefilled from what the agent suggested. The person edits and sends it; it's never applied on its own. */
    intent: string;
    spendLimit: number;
    perPurchaseLimit: number;
  };
}

export interface AuthCode {
  code: string;
  authRequestId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  visaId?: string;
  connectionId?: string;
  humanId: string;
  resource: string;
  expiresAt: string;
  used: boolean;
}

export interface RefreshTokenRecord {
  id: string; // sha256 of the token
  clientId: string;
  visaId?: string;
  connectionId?: string;
  humanId: string;
  expiresAt: string;
  revoked: boolean;
}

export type StampKind =
  | "visa_issued"
  | "browse"
  | "reserve"
  | "purchase"
  | "approval"
  | "blocked"
  | "revoked"
  | "report"
  | "bond";

export interface Stamp {
  id: string;
  visaId: string;
  humanId: string;
  kind: StampKind;
  title: string;
  detail: string;
  merchantName: string;
  at: string;
}

export interface Approval {
  id: string;
  visaId: string;
  humanId: string;
  action: "reserve" | "checkout";
  items: { title: string; category: string; priceCents: number }[];
  totalCents: number;
  reason: string;
  model: string;
  probability: number;
  fingerprint: string;
  status: "pending" | "approved" | "denied";
  createdAt: string;
  decidedAt?: string;
  /** Where the person answered: Courier's approval page, or a dialog in their chat app. */
  via?: "page" | "chat";
}

export interface Hold {
  id: string;
  visaId: string;
  amountCents: number;
  expiresAt: string;
  committed: boolean;
}

export interface Report {
  id: string;
  visaId: string;
  reason: string;
  evidence: unknown;
  bondOutcome: string;
  at: string;
}

/** The person's saved PayPal (PayPal Vault payment token), keyed by their id. Never leaves Courier. */
export interface SavedPayPalRecord {
  humanId: string;
  vaultId: string;
  email?: string | null;
}

/* ---------------- merchants ---------------- */

export const MERCHANTS: Merchant[] = [
  {
    resource: STORE_RESOURCE,
    name: config.store.name,
    homepage: config.store.url,
    scopes: [...ALL_SCOPES],
  },
];

export function normalizeResource(resource: string): string {
  try {
    const url = new URL(resource);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return resource;
  }
}

export function findMerchant(resource: string | undefined): Merchant | undefined {
  if (!resource) return MERCHANTS.length === 1 ? MERCHANTS[0] : undefined;
  const wanted = normalizeResource(resource);
  return MERCHANTS.find((m) => normalizeResource(m.resource) === wanted);
}

/* ---------------- identity helpers ---------------- */

/** A per-merchant pseudonym, so two merchants can't correlate the same human. */
export function pairwiseSubject(humanId: string, resource: string): string {
  const mac = createHmac("sha256", config.sessionSecret)
    .update(`${humanId}|${normalizeResource(resource)}`)
    .digest("base64url");
  return `pp_${mac.slice(0, 22)}`;
}

/** A Courier ID number, e.g. CR-7Q3F-JU: stable per courier, suffixed with its initials. */
export function courierIdNo(humanId: string, name: string, courierId = humanId): string {
  const seed = courierId === humanId ? `courier-id|${humanId}` : `courier-id|${humanId}|${courierId}`;
  const mac = createHmac("sha256", config.sessionSecret)
    .update(seed)
    .digest("base64url")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const initials = name
    .normalize("NFD")
    .replace(/[^A-Za-z]/g, "")
    .slice(0, 2)
    .toUpperCase()
    .padEnd(2, "X");
  return `CR-${mac.slice(0, 4)}-${initials}`;
}

/** All of a person's couriers, oldest first. */
export function listCouriers(humanId: string): Courier[] {
  return db
    .list<Courier>("couriers", (c) => c.humanId === humanId)
    .map((c) => ({ ...c, id: c.id ?? c.humanId }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** A courier by id, or the person's first courier. */
export function findCourier(humanId: string, courierId?: string | null): Courier | undefined {
  const all = listCouriers(humanId);
  return courierId ? all.find((c) => c.id === courierId) : all[0];
}

export function newCourierId(): string {
  return newId("cr");
}

export function saveCourier(courier: Courier): void {
  db.put("couriers", courier.id, courier);
}

/** The name a connection acts under: its courier's, or the client's until it has one. */
export function connectionAgent(connection: Connection): string {
  return (
    listCouriers(connection.humanId).find((c) => c.clientId === connection.clientId)?.name ?? connection.clientName
  );
}

/** True when PayPal's age range says the person is under 18. */
export function isMinor(ageRange: string | null): boolean {
  if (!ageRange) return false;
  const match = ageRange.match(/\d+/);
  if (!match) return false;
  const lower = Number(match[0]);
  return lower < 18 && !/^18/.test(ageRange);
}

/* ---------------- visa helpers ---------------- */

export function effectiveStatus(visa: Visa): Visa["status"] {
  if (visa.status === "active" && new Date(visa.expiresAt).getTime() <= Date.now()) return "expired";
  return visa.status;
}

/** The errand a connection is on right now, if any: its newest active visa. */
export function activeTicket(connection: Connection): Visa | undefined {
  return db
    .list<Visa>(
      "visas",
      (v) =>
        v.humanId === connection.humanId &&
        v.clientId === connection.clientId &&
        v.resource === connection.resource &&
        effectiveStatus(v) === "active",
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export function activeHolds(visaId: string): Hold[] {
  const now = Date.now();
  return db.list<Hold>("holds", (h) => h.visaId === visaId && !h.committed && new Date(h.expiresAt).getTime() > now);
}

export function remainingBudget(visa: Visa): number {
  const held = activeHolds(visa.id).reduce((sum, h) => sum + h.amountCents, 0);
  return Math.max(0, visa.spendLimitCents - visa.spentCents - held);
}
