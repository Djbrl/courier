import * as z from "zod";

/** Scopes a merchant can request for an agent, with human-readable wording for the consent screen. */
export const SCOPES = {
  "store:browse": { label: "Browse the catalog", detail: "Search items and read prices.", risk: "low" },
  "store:reserve": { label: "Reserve items", detail: "Hold stock for 15 minutes on your behalf.", risk: "medium" },
  "store:buy": { label: "Buy on your behalf", detail: "Buy within your limits, paid with PayPal.", risk: "high" },
} as const;

export type Scope = keyof typeof SCOPES;
export const ALL_SCOPES = Object.keys(SCOPES) as Scope[];

export function isScope(value: string): value is Scope {
  return value in SCOPES;
}

/** Visa durations offered at consent. Bonded visas stay within PayPal's ~3 day authorization honor period. */
export const DURATIONS = {
  "1h": { label: "1 hour", ms: 60 * 60 * 1000 },
  "24h": { label: "24 hours", ms: 24 * 60 * 60 * 1000 },
  "3d": { label: "3 days", ms: 3 * 24 * 60 * 60 * 1000 },
  "7d": { label: "7 days", ms: 7 * 24 * 60 * 60 * 1000 },
} as const;
export type DurationKey = keyof typeof DURATIONS;

export const VisaStatus = z.enum(["pending_paypal", "pending_bond", "active", "revoked", "expired", "suspended"]);
export type VisaStatus = z.infer<typeof VisaStatus>;

export interface Visa {
  id: string;
  humanId: string;
  clientId: string;
  agentName: string;
  resource: string;
  merchantName: string;
  scopes: Scope[];
  spendLimitCents: number;
  perPurchaseLimitCents: number;
  spentCents: number;
  currency: string;
  intent: string;
  status: VisaStatus;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string | null;
  revokeReason?: string | null;
  bond?: {
    amountCents: number;
    orderId: string;
    authorizationId?: string | null;
    status: "pending" | "authorized" | "voided" | "captured" | "failed";
  } | null;
  /** Started by Claude under the person's cap, with no click. Counts toward their daily cap. */
  autoStarted?: boolean;
  /**
   * Saved PayPal: purchases on this errand are charged straight to the PayPal the person saved on their account (within
   * the limits). The payment token itself lives in Courier's "saved_paypal" collection, never on the visa.
   */
  autopay?: {
    status: "pending" | "on" | "declined" | "failed" | "removed";
    email?: string | null;
  } | null;
}

/** Claims carried in the JWT access token issued to an agent (the "visa" as seen by a merchant). */
export interface VisaTokenClaims {
  iss: string;
  aud: string;
  sub: string;
  exp: number;
  iat: number;
  jti: string;
  client_id: string;
  scope: string;
  human: {
    verified: boolean;
    age_range: string | null;
  };
  visa: {
    id: string;
    agent: string;
    merchant: string;
    spend_limit: { currency: string; value: string };
    per_purchase_limit: { currency: string; value: string };
    intent: string | null;
    expires_at: string;
    bond: { amount: string; status: string } | null;
    /** Purchases are paid straight away with the person's saved PayPal (no PayPal page per purchase). */
    autopay: boolean;
  };
}

/**
 * Claims of the access token a person's own Claude holds: who it acts for, with no limits of its own. Limits live on
 * the current errand's visa, which the shop gets from Courier as a short-lived signed token on each request.
 */
export interface ConnectionTokenClaims extends Omit<VisaTokenClaims, "visa"> {
  connection: { id: string; agent: string };
}

export function centsToValue(cents: number): string {
  return (cents / 100).toFixed(2);
}
