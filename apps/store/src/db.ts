import { DocStore } from "@courier/shared";

export const db = new DocStore("store");

export interface Order {
  id: string; // PayPal order id
  /** Which shop sold it. Older orders were all Juniper Records'. */
  shop?: string;
  visaId: string;
  sub: string;
  agent: string;
  holdId: string;
  items: { id: string; title: string; priceCents: number; quantity: number }[];
  totalCents: number;
  status: "awaiting_approval" | "paid" | "cancelled" | "failed";
  /** PayPal's page for the person to pay; null when it was paid with the errand's saved PayPal. */
  approveUrl: string | null;
  /** "saved_paypal": paid straight away with the PayPal the person saved on their Courier ticket. */
  paidWith?: "paypal_page" | "saved_paypal";
  captureId?: string | null;
  /** The unguessable part of the receipt link. Older orders don't have one. */
  receiptKey?: string;
  createdAt: string;
  paidAt?: string | null;
  /** What the merchant can show in a dispute: the human's signed delegation and the decision trail. */
  evidence: {
    visa: unknown;
    intent: unknown;
    tokenJti: string;
    humanVerified: boolean;
  };
  disputed?: boolean;
}

export interface Reservation {
  id: string;
  visaId: string;
  itemId: string;
  expiresAt: string;
}
