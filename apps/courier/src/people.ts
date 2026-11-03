import { type CourierColor, newId } from "@courier/shared";
import { courierIdNo, db, findCourier, type Human, type SavedPayPalRecord, saveCourier } from "./db.ts";

/**
 * People a person can chip in with. Each has their own courier and their own PayPal, and a limit only their courier
 * knows: asked for a share, it says what fits and never why. In the demo everyone starts with the same three, simulated
 * people who pay on the simulator with a saved PayPal, so a split goes through without anyone else at the keyboard.
 */

export interface Contact {
  id: string;
  /** Whose contact this is. */
  ownerId: string;
  /** The contact's own person record. */
  humanId: string;
  name: string;
  /** How they know each other, so "my brother" finds them too. */
  relation: string;
  courierName: string;
  color: CourierColor;
  /** The most they'll put into one thing. Private to their courier: the owner only ever sees what it offers. */
  limitCents: number;
  createdAt: string;
}

const SEEDS: Pick<Contact, "name" | "relation" | "courierName" | "color" | "limitCents">[] = [
  { name: "Leo", relation: "brother", courierName: "Otto", color: "tang", limitCents: 5000 },
  { name: "Priya", relation: "friend", courierName: "Mika", color: "ink", limitCents: 4000 },
  { name: "Noor", relation: "flatmate", courierName: "Rémy", color: "hivis", limitCents: 2500 },
];

/** Something to split with each of them, to start from. */
const IDEAS: Record<string, string> = {
  Leo: "the Late Night Jazz box set for Dad",
  Priya: "flowers for Noor’s birthday",
  Noor: "dinner for the flat tonight",
};
export const ideaFor = (contact: Contact) => IDEAS[contact.name] ?? "something together";

/** A simulated person with a courier and a saved PayPal at the simulator, ready to pay their share. */
function seed(owner: Human, s: (typeof SEEDS)[number]): Contact {
  const now = new Date().toISOString();
  const humanId = newId("hum");
  db.put<Human>("humans", humanId, {
    id: humanId,
    payerId: `demo-${humanId}`,
    verified: false,
    simulated: true,
    ageRange: null,
    accountType: null,
    displayName: s.name,
    createdAt: now,
    lastLoginAt: now,
  });
  saveCourier({
    id: humanId,
    humanId,
    name: s.courierName,
    color: s.color,
    model: "Claude",
    idNo: courierIdNo(humanId, s.courierName),
    mode: "demo",
    createdAt: now,
  });
  const email = `${s.name.toLowerCase()}@sim-paypal.test`;
  const vaultId = newId("VT").replace("_", "-");
  db.put("sim_payment_tokens", vaultId, { id: vaultId, setupTokenId: "seeded", email, deleted: false });
  db.put<SavedPayPalRecord>("saved_paypal", humanId, { humanId, vaultId, email });
  const id = newId("ct");
  return db.put<Contact>("contacts", id, { id, ownerId: owner.id, humanId, ...s, createdAt: now });
}

/** A person's contacts. Everyone gets the demo three the first time they look. */
export function contactsOf(owner: Human): Contact[] {
  const found = db.list<Contact>("contacts", (c) => c.ownerId === owner.id, Infinity);
  const have = found.length ? found : SEEDS.map((s) => seed(owner, s));
  return have.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name));
}

/** Finds contacts by name or by how they're related ("my brother"). Agent-supplied, so only exact words match. */
export function findContacts(owner: Human, names: unknown): { found: Contact[]; unknown: string[] } {
  const all = contactsOf(owner);
  const asked = (Array.isArray(names) ? names : [names]).map((n) => String(n ?? "").trim()).filter(Boolean);
  const found: Contact[] = [];
  const unknown: string[] = [];
  for (const name of asked.slice(0, 5)) {
    const key = name
      .toLowerCase()
      .replace(/^(my|our)\s+/, "")
      .trim();
    const contact = all.find((c) => c.name.toLowerCase() === key || c.relation === key);
    if (!contact) unknown.push(name);
    else if (!found.includes(contact)) found.push(contact);
  }
  return { found, unknown };
}

export const contactLine = (contacts: Contact[]) =>
  contacts.map((c) => `${c.name} (${c.relation}, courier ${c.courierName})`).join(", ");

export interface Split {
  shares: { contact: Contact; cents: number; short: boolean }[];
  /** What the person pays: their even part, plus whatever the others couldn't. */
  mineCents: number;
  /** How much of that is covering someone else. */
  coverCents: number;
}

/**
 * An even split, asked of each contact's courier. A courier offers the ask if it fits their limit, or the most that does;
 * the person covers the difference. Worked out here in code from the shop's price, never by a model.
 */
export function planSplit(priceCents: number, contacts: Contact[]): Split {
  const each = Math.floor(priceCents / (contacts.length + 1));
  const shares = contacts.map((contact) => {
    const cents = Math.min(each, contact.limitCents);
    return { contact, cents, short: cents < each };
  });
  const mineCents = priceCents - shares.reduce((s, x) => s + x.cents, 0);
  return { shares, mineCents, coverCents: mineCents - (priceCents - each * contacts.length) };
}

export const contactCourier = (contact: Contact) => findCourier(contact.humanId);
