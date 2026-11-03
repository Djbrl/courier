import { ALL_SCOPES, SHOPS, type Shop, type Visa } from "@courier/shared";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { withStore } from "./agent.ts";
import { mintAccessToken } from "./auth/oauth.ts";
import { db, type Human } from "./db.ts";
import { demoClientId } from "./pages/shared.ts";
import {
  type Contact,
  contactCourier,
  contactLine,
  contactsOf,
  findContacts,
  planSplit,
  type Split,
} from "./people.ts";
import { issueErrand, revokeVisa } from "./visas.ts";

/**
 * Chipping in, shared by the errand room and the Courier connector. Code reads the price from the shop and works out
 * the split; the model only names the item and the people. Each contact's courier pays its own share, on its own
 * errand, with that contact's saved PayPal.
 */

export const usd = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;

/** One item split with contacts. The person pays first; then each contact's courier pays their share. */
export interface GroupRun {
  groupId: string;
  orderId: string;
  shopSlug: string;
  item: Record<string, unknown>;
  priceCents: number;
  mineCents: number;
  shares: { contactId: string; name: string; courier: string; cents: number }[];
  /** Set once the contacts have been asked to pay, so a second look at the order can't ask again. */
  collected?: boolean;
}

/** Who paid what, as the chat and the connector show it. */
export interface GroupTicket {
  t: "group";
  group_id: string;
  shop: string;
  item: Record<string, unknown>;
  total: string;
  payers: { name: string; courier: string; cents: number; paid: boolean; you?: boolean }[];
}

/** A split worked out for one item, before anything is bought. */
export interface ChipQuote {
  shop: Shop;
  itemId: string;
  item: Record<string, any>;
  priceCents: number;
  contacts: Contact[];
  split: Split;
}

/**
 * Checks the people and the item, and works out the split. `getItem` asks the shop, so the price is the shop's.
 * Returns what to tell the courier when something is off.
 */
export async function quoteChipIn(
  owner: Human,
  shop: Shop,
  itemId: string,
  names: unknown,
  getItem: (itemId: string) => Promise<Record<string, any> | null>,
): Promise<ChipQuote | { problem: string }> {
  const { found, unknown } = findContacts(owner, names);
  if (unknown.length || !found.length)
    return {
      problem: `${unknown.length ? `${unknown.join(", ")} isn't one of their contacts. ` : ""}They can chip in with: ${contactLine(contactsOf(owner))}.`,
    };
  const item = await getItem(itemId);
  if (!item?.price) return { problem: `${shop.name} has no item ${itemId}. Search the shop for its id.` };
  if (!item.in_stock) return { problem: `${item.title} is sold out.` };
  const priceCents = Math.round(Number(item.price) * 100);
  return { shop, itemId, item, priceCents, contacts: found, split: planSplit(priceCents, found) };
}

/** The split in words: the price, what anyone short can put in, and who pays what. Never anyone's limit. */
export function splitText(q: ChipQuote): string {
  const { split } = q;
  return (
    `${q.item.title} is ${usd(q.priceCents)}. ` +
    split.shares
      .filter((x) => x.short)
      .map((x) => `${x.contact.courierName} says ${x.contact.name} can put in ${usd(x.cents)}. `)
      .join("") +
    `Their share would be ${usd(split.mineCents)}${split.coverCents ? `, covering ${usd(split.coverCents)} more than an even split` : ""}; ` +
    split.shares.map((x) => `${x.contact.name} pays ${usd(x.cents)}`).join(", ") +
    "."
  );
}

/** What the person's own errand is for. No names: the errand travels to the shop in their token. */
export const shareIntent = (q: ChipQuote) => `A share of ${q.item.title}`;

export function groupRun(q: ChipQuote, groupId: string, orderId: string): GroupRun {
  return {
    groupId,
    orderId,
    shopSlug: q.shop.slug,
    item: {
      id: q.itemId,
      title: q.item.title,
      artist: q.item.artist,
      category: q.item.category,
      hue: q.item.hue,
      price: q.item.price,
    },
    priceCents: q.priceCents,
    mineCents: q.split.mineCents,
    shares: q.split.shares.map((x) => ({
      contactId: x.contact.id,
      name: x.contact.name,
      courier: x.contact.courierName,
      cents: x.cents,
    })),
  };
}

/** A contact's courier pays their share: its own errand and token, their own saved PayPal. */
async function payShare(owner: Human, run: GroupRun, share: GroupRun["shares"][number]): Promise<boolean> {
  const contact = db.get<Contact>("contacts", share.contactId);
  const human = contact && db.get<Human>("humans", contact.humanId);
  const courier = contact && contactCourier(contact);
  const shop = SHOPS.find((s) => s.slug === run.shopSlug);
  if (!contact || contact.ownerId !== owner.id || !human || !courier || !shop) return false;
  const clientId = demoClientId(courier.id);
  // The intent goes to the shop in the token, so it names the item and nobody.
  const visa = issueErrand({
    connection: { clientId, scopes: [...ALL_SCOPES] },
    human,
    courierName: courier.name,
    what: `Chip in on ${run.item.title}`,
    budget: Math.ceil(share.cents / 100),
    auto: false,
  });
  let paid = false;
  try {
    const { token } = await mintAccessToken(visa, human, clientId, { expiresInSeconds: 60, audience: shop.resource });
    const out = (await withStore(
      token,
      (client: Client) =>
        client.callTool({
          name: "request_purchase",
          arguments: { item_ids: [run.item.id], share: { cents: share.cents, group_id: run.groupId } },
        }),
      `Courier: ${courier.name}`,
      shop.resource,
    )) as CallToolResult;
    paid = (out.structuredContent as { status?: string } | undefined)?.status === "paid";
    if (!paid) {
      const said = out.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
      console.warn(`[errand] ${contact.name}'s share didn't go through: ${said.slice(0, 200)}`);
    }
  } catch (error) {
    console.warn(`[errand] ${contact.name}'s share failed`, error);
  }
  // Its one job is done either way.
  const fresh = db.get<Visa>("visas", visa.id);
  if (paid && fresh) db.put<Visa>("visas", visa.id, { ...fresh, status: "expired", revokeReason: "Done" });
  else await revokeVisa(visa.id, "The share didn't go through");
  return paid;
}

/** Groups whose contacts are being asked right now, so two looks at the same order can't ask twice. */
export const collecting = new Set<string>();

/** Once the person's share is paid: each contact's courier pays theirs, in turn. */
export async function collectShares(owner: Human, courierName: string, run: GroupRun): Promise<GroupTicket> {
  const paid: boolean[] = [];
  for (const share of run.shares) paid.push(await payShare(owner, run, share));
  run.collected = true;
  return {
    t: "group",
    group_id: run.groupId,
    shop: SHOPS.find((s) => s.slug === run.shopSlug)?.name ?? run.shopSlug,
    item: run.item,
    total: (run.priceCents / 100).toFixed(2),
    payers: [
      { name: "You", courier: courierName, cents: run.mineCents, paid: true, you: true },
      ...run.shares.map((s, i) => ({ name: s.name, courier: s.courier, cents: s.cents, paid: paid[i]! })),
    ],
  };
}
