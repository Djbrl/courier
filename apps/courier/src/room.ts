import {
  ALL_SCOPES,
  BUDGET_MAX,
  BUDGET_MIN,
  budgetFromCourier,
  CALL_BACK_MS,
  COURIER_RESOURCE,
  config,
  itemNamedIn,
  newId,
  parseBudget,
  SHOPS,
  type Shop,
  shopNamed,
  type Visa,
} from "@courier/shared";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  type AgentMemory,
  type CallTool,
  type PickedItem,
  quoteItems,
  runAgent,
  type Step,
  type ToolResult,
  withStore,
} from "./agent.ts";
import { mintAccessToken, mintShopConnectionToken } from "./auth/oauth.ts";
import { anyShop, type Connection, type Courier, db, effectiveStatus, type Human, remainingBudget } from "./db.ts";
import { demoClientId, firstName } from "./pages/shared.ts";
import { type Contact, contactCourier, contactLine, contactsOf, findContacts, planSplit } from "./people.ts";
import { addStamp, issueErrand, revokeVisa } from "./visas.ts";

/**
 * The errand room: chats with a courier, side by side. Turns run here in the background and write to the chat, so a person
 * can leave one running, start another, or come back later and read it. A budget comes from what the person types, read
 * here in code, or from the listed prices of what they picked. The courier can't make one up.
 */

/** What each person gets in this window. The full experience is Courier connected to their own agent. */
export const FREE_MESSAGES = 50;

export const messagesLeft = (human: Human) => Math.max(0, FREE_MESSAGES - (human.messagesSent ?? 0));

/** Counts a message, or says there are none left. Checked here in code, so nothing typed in a chat can change it. */
export function spendMessage(human: Human): boolean {
  if (!messagesLeft(human)) return false;
  human.messagesSent = (human.messagesSent ?? 0) + 1;
  db.put("humans", human.id, human);
  return true;
}

/** What the window draws. Written once, so a chat reads the same every time it's opened. */
export type ChatEvent =
  | { t: "me" | "say" | "dim"; text: string }
  | { t: "new"; what: string; limitCents: number }
  | { t: "items"; shop: string; results: Record<string, unknown>[] }
  | {
      t: "pay";
      order_id: string;
      shop_slug: string;
      shop_name: string;
      approve_url: string;
      total: string;
      items: Record<string, unknown>[];
      status: "open" | "paid" | "cancelled" | "called_back";
      errand_id?: string;
      /** A share of one item, paid with other people. Once it's paid, their couriers pay theirs. */
      group?: string;
      callBackUntil: number;
    }
  | {
      t: "receipt";
      order_id: string;
      shop: string;
      total: string;
      items: Record<string, unknown>[];
      receipt_url: string | null;
    }
  | {
      t: "group";
      group_id: string;
      shop: string;
      item: Record<string, unknown>;
      total: string;
      payers: { name: string; courier: string; cents: number; paid: boolean; you?: boolean }[];
    }
  | { t: "ask"; approval_id: string; reason: string; items: string[]; answered?: "ok" | "no" }
  | { t: "no"; reason: string };

export interface RoomChat extends AgentMemory {
  id: string;
  courierId: string;
  humanId: string;
  title: string;
  errandIds: string[];
  events: ChatEvent[];
  /** Messages sent while the courier is busy in this chat. They go out in order. */
  queue: string[];
  note?: string;
  amounts?: boolean;
  /** The courier told the person what it would get, and is waiting for their word. */
  confirm?: boolean;
  /** Items chipped in on from this chat, and who pays what. */
  groups?: GroupRun[];
  /** Goes up with every change to the events, so a window only redraws when it must. */
  rev: number;
  createdAt: string;
  updatedAt: string;
}

/** One item split with contacts. The person pays first; then each contact's courier pays their share. */
interface GroupRun {
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

/** Chats with a turn running. Those are the only copies; the database catches up as they change. */
const running = new Map<string, RoomChat>();

const touch = (chat: RoomChat) => {
  chat.rev++;
  chat.updatedAt = new Date().toISOString();
  db.put("room_chats", chat.id, chat);
};
const push = (chat: RoomChat, event: ChatEvent) => {
  chat.events.push(event);
  touch(chat);
};

export function findChat(courier: Courier, id: unknown): RoomChat | undefined {
  if (typeof id !== "string") return undefined;
  const chat = running.get(id) ?? db.get<RoomChat>("room_chats", id);
  return chat?.courierId === courier.id ? chat : undefined;
}

const chatsOf = (courier: Courier) =>
  db
    .list<RoomChat>("room_chats", (c) => c.courierId === courier.id, Infinity)
    .map((c) => running.get(c.id) ?? c)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

/** A chat to start in: the one left empty, if there is one. */
export function blankChat(courier: Courier): RoomChat {
  const empty = chatsOf(courier).find((c) => !c.events.length);
  if (empty) return empty;
  const id = newId("chat");
  const now = new Date().toISOString();
  return db.put<RoomChat>("room_chats", id, {
    id,
    courierId: courier.id,
    humanId: courier.humanId,
    title: "",
    errandIds: [],
    events: [],
    queue: [],
    history: [],
    rev: 0,
    createdAt: now,
    updatedAt: now,
  });
}

/** The chat holding one of a person's errands or orders. */
export function chatsOfHuman(humanId: string): RoomChat[] {
  return db.list<RoomChat>("room_chats", (c) => c.humanId === humanId, Infinity);
}

export const chatWithOrder = (humanId: string, orderId: string) =>
  chatsOfHuman(humanId).find((c) => c.events.some((e) => e.t === "pay" && e.order_id === orderId));

/** The room's own link to the shops. It isn't a Claude the person connected, so the app doesn't list it. */
function roomConnection(human: Human, courier: Courier): Connection {
  const clientId = demoClientId(courier.id);
  const found = db.list<Connection>(
    "connections",
    (c) => c.humanId === human.id && c.clientId === clientId && c.status === "active",
    1,
  )[0];
  if (found) return found;
  const id = newId("conn");
  return db.put<Connection>("connections", id, {
    id,
    humanId: human.id,
    clientId,
    clientName: courier.name,
    resource: COURIER_RESOURCE,
    scopes: [...ALL_SCOPES],
    status: "active",
    createdAt: new Date().toISOString(),
  });
}

const errandsOf = (chat: RoomChat) =>
  chat.errandIds.map((id) => db.get<Visa>("visas", id)).filter((v): v is Visa => Boolean(v && anyShop(v)));
const openErrands = (chat: RoomChat) => errandsOf(chat).filter((v) => effectiveStatus(v) === "active");

function errandView(chat: RoomChat) {
  const v = errandsOf(chat).at(-1);
  return v
    ? {
        id: v.id,
        what: v.intent,
        spentCents: v.spentCents,
        limitCents: v.spendLimitCents,
        remainingCents: remainingBudget(v),
        open: effectiveStatus(v) === "active",
      }
    : null;
}

/** One chat in the row of chats. */
function chatTab(chat: RoomChat) {
  const errand = errandView(chat);
  return {
    id: chat.id,
    title: chat.title,
    working: running.has(chat.id) || gathering.has(chat.id),
    toPay: chat.events.some((e) => e.t === "pay" && e.status === "open"),
    errand,
  };
}

export const chatTabs = (courier: Courier) =>
  chatsOf(courier)
    .filter((c) => c.events.length)
    .map(chatTab);

export function chatView(chat: RoomChat) {
  return {
    ...chatTab(chat),
    rev: chat.rev,
    note: chat.note ?? "",
    amounts: Boolean(chat.amounts),
    confirm: Boolean(chat.confirm),
    events: chat.events,
    pendingBudgetCents: chat.pendingBudget ? chat.pendingBudget * 100 : null,
  };
}

/** Why a person can't have this budget, or null. Their cap from Settings holds here too, though they typed the amount. */
function budgetProblem(human: Human, dollars: number): string | null {
  if (!Number.isInteger(dollars) || dollars < BUDGET_MIN) return `Budgets start at $${BUDGET_MIN}.`;
  if (dollars > BUDGET_MAX) return `The most one errand can have is $${BUDGET_MAX}.`;
  const cap = human.cap?.perErrandCents;
  if (cap && dollars * 100 > cap)
    return `$${dollars} is over your $${cap / 100} cap per errand. You can change it in [Settings](${config.courier.url}/app/settings), or give me a lower budget.`;
  return null;
}

/** What an errand is for, without the budget the person said in the same breath. */
const withoutBudget = (what: string) =>
  what
    .replace(
      /[,\s]*\b(?:under|below|less than|up to|max|no more than|about|around|budget(?: of| is)?|i have(?: about)?)\s*\$?\s*\d+(?:\.\d+)?(?:\s*(?:dollars?|bucks?|\$))?.*$/i,
      "",
    )
    .trim() || what;

function startErrand(human: Human, courier: Courier, chat: RoomChat, what: string, dollars: number): Visa {
  const visa = issueErrand({
    connection: { clientId: demoClientId(courier.id), scopes: [...ALL_SCOPES] },
    human,
    courierName: courier.name,
    what: withoutBudget(what),
    budget: dollars,
    auto: false,
  });
  chat.errandIds.push(visa.id);
  chat.title = visa.intent;
  chat.events.push({ t: "new", what: visa.intent, limitCents: visa.spendLimitCents });
  return visa;
}

/** Changes a budget, or says why it can't. Limits are read fresh at every purchase, so this applies at once. */
export function changeBudget(human: Human, chat: RoomChat, errandId: string, dollars: number): string | null {
  const problem = budgetProblem(human, dollars);
  if (problem) return problem;
  const visa = openErrands(chat).find((v) => v.id === errandId);
  if (!visa) return "That errand has ended.";
  const used = visa.spendLimitCents - remainingBudget(visa);
  if (dollars * 100 < used) return `It’s already used $${(used / 100).toFixed(2)} of this budget.`;
  db.put<Visa>("visas", visa.id, { ...visa, spendLimitCents: dollars * 100, perPurchaseLimitCents: dollars * 100 });
  addStamp(visa, "visa_issued", "You changed the budget", `Now up to $${dollars}`);
  return null;
}

export function setNextBudget(human: Human, chat: RoomChat, dollars: number): string | null {
  const problem = budgetProblem(human, dollars);
  if (problem) return problem;
  chat.pendingBudget = dollars;
  touch(chat);
  return null;
}

const fromMcp = (result: any): ToolResult => ({
  text: (result?.content ?? [])
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("\n"),
  isError: Boolean(result?.isError),
  data: result?.structuredContent ?? {},
});

async function askShop(
  shop: Shop,
  token: string,
  courier: Courier,
  tool: string,
  args: Record<string, unknown>,
): Promise<ToolResult & { data: Record<string, any> }> {
  const result = await withStore(
    token,
    (client: Client) => client.callTool({ name: tool, arguments: args }),
    `Courier: ${courier.name}`,
    shop.resource,
  );
  const out = fromMcp(result);
  return { ...out, data: { ...out.data, shop_slug: shop.slug, shop_name: shop.name } };
}

/* ---------------- after a purchase ---------------- */

const unpaid = (chat: RoomChat) => chat.events.some((e) => e.t === "pay" && e.status === "open");

/** An errand is over once what it bought is paid for and nothing is waiting. Its budget goes with it. */
function finishErrands(chat: RoomChat): void {
  if (unpaid(chat)) return;
  for (const visa of openErrands(chat)) {
    if (visa.spentCents > 0 && remainingBudget(visa) === visa.spendLimitCents - visa.spentCents)
      db.put<Visa>("visas", visa.id, { ...visa, status: "expired", revokeReason: "Done" });
  }
}

const pending = (chat: RoomChat, orderId: unknown) =>
  chat.events.find((e): e is Extract<ChatEvent, { t: "pay" }> => e.t === "pay" && e.order_id === orderId);

function settled(chat: RoomChat, card: Extract<ChatEvent, { t: "pay" }>, order: Record<string, any>): void {
  // Two windows or a popup and a timer can ask at once. Only the first answer writes the receipt.
  if (card.status !== "open") return;
  if (order.status === "paid" && card.group) {
    // Their share is in: the others' couriers pay now, and one ticket shows who paid what.
    card.status = "paid";
    chat.amounts = false;
    chat.note = "Collecting the other shares…";
    touch(chat);
    void othersPay(chat.id, card.group);
  } else if (order.status === "paid") {
    card.status = "paid";
    chat.events.push({
      t: "receipt",
      order_id: card.order_id,
      shop: card.shop_name,
      total: order.total,
      items: order.items ?? card.items,
      receipt_url: order.receipt_url ?? null,
    });
    chat.amounts = false;
    finishErrands(chat);
    if (unpaid(chat)) touch(chat);
    else push(chat, { t: "say", text: "All done. Let me know if you need anything else." });
  } else if (order.status === "cancelled") {
    card.status = "cancelled";
    chat.amounts = false;
    finishErrands(chat);
    push(chat, { t: "say", text: "No problem, I’ve put it back. Your budget is untouched." });
  }
}

/* ---------------- chipping in ---------------- */

const usd = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;

/** A contact's courier pays their share: its own errand and token, their own saved PayPal. */
async function payShare(owner: Human, run: GroupRun, share: GroupRun["shares"][number]): Promise<boolean> {
  const contact = db.get<Contact>("contacts", share.contactId);
  const human = contact && db.get<Human>("humans", contact.humanId);
  const courier = contact && contactCourier(contact);
  const shop = SHOPS.find((s) => s.slug === run.shopSlug);
  if (!contact || contact.ownerId !== owner.id || !human || !courier || !shop) return false;
  const clientId = demoClientId(courier.id);
  const visa = issueErrand({
    connection: { clientId, scopes: [...ALL_SCOPES] },
    human,
    courierName: courier.name,
    what: `Chip in with ${firstName(owner) ?? "a friend"} on ${run.item.title}`,
    budget: Math.ceil(share.cents / 100),
    auto: false,
  });
  let paid = false;
  try {
    const { token } = await mintAccessToken(visa, human, clientId, { expiresInSeconds: 60, audience: shop.resource });
    const out = await askShop(shop, token, courier, "request_purchase", {
      item_ids: [run.item.id],
      share: { cents: share.cents, group_id: run.groupId },
    });
    paid = out.data.status === "paid";
    if (!paid) console.warn(`[errand] ${contact.name}'s share didn't go through: ${out.text.slice(0, 200)}`);
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
const collecting = new Set<string>();
/** Chats waiting on those, which the window shows as busy. */
const gathering = new Set<string>();

async function collectShares(
  owner: Human,
  courier: Courier,
  run: GroupRun,
): Promise<Extract<ChatEvent, { t: "group" }>> {
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
      { name: "You", courier: courier.name, cents: run.mineCents, paid: true, you: true },
      ...run.shares.map((s, i) => ({ name: s.name, courier: s.courier, cents: s.cents, paid: paid[i]! })),
    ],
  };
}

/** After the person paid their share on PayPal's page: the others pay, and the chat gets the ticket. */
async function othersPay(chatId: string, groupId: string): Promise<void> {
  const chat = running.get(chatId) ?? db.get<RoomChat>("room_chats", chatId);
  const run = chat?.groups?.find((g) => g.groupId === groupId);
  const owner = chat && db.get<Human>("humans", chat.humanId);
  const courier = chat && db.get<Courier>("couriers", chat.courierId);
  if (!chat || !run || run.collected || !owner || !courier || collecting.has(groupId)) return;
  collecting.add(groupId);
  gathering.add(chatId);
  try {
    const ticket = await collectShares(owner, courier, run);
    // A turn may have started meanwhile; write to the copy that's current now.
    const live = running.get(chatId) ?? db.get<RoomChat>("room_chats", chatId);
    if (!live) return;
    const kept = live.groups?.find((g) => g.groupId === groupId);
    if (kept) kept.collected = true;
    live.events.push(ticket);
    live.note = "";
    finishErrands(live);
    const short = ticket.payers.filter((p) => !p.paid);
    push(
      live,
      short.length
        ? {
            t: "say",
            text: `${short.map((p) => p.name).join(" and ")}’s share didn’t go through, so it isn’t complete yet.`,
          }
        : { t: "say", text: "Everyone’s paid, so it’s on its way. Let me know if you need anything else." },
    );
  } finally {
    collecting.delete(groupId);
    gathering.delete(chatId);
  }
}

/** Asks the shop where an order stands, and writes the outcome into the chat. */
export async function checkOrder(human: Human, courier: Courier, chat: RoomChat, orderId: string) {
  const card = pending(chat, orderId);
  const shop = card && SHOPS.find((s) => s.slug === card.shop_slug);
  if (!card || !shop) return null;
  if (card.status !== "open") return card.status;
  const token = await mintShopConnectionToken(roomConnection(human, courier), human, shop.resource);
  const order = await askShop(shop, token, courier, "order_status", { order_id: orderId });
  settled(chat, card, order.data);
  return card.status;
}

async function cancelCard(human: Human, courier: Courier, card: Extract<ChatEvent, { t: "pay" }>) {
  const shop = SHOPS.find((s) => s.slug === card.shop_slug)!;
  const token = await mintShopConnectionToken(roomConnection(human, courier), human, shop.resource);
  return askShop(shop, token, courier, "cancel_order", { order_id: card.order_id });
}

/** Cancels an order at the shop, unless it turns out to be paid already. */
async function callOff(human: Human, courier: Courier, chat: RoomChat, card: Extract<ChatEvent, { t: "pay" }>) {
  const order = await cancelCard(human, courier, card);
  if (order.data.status !== "cancelled") {
    settled(chat, card, order.data);
    return false;
  }
  card.status = "called_back";
  touch(chat);
  return true;
}

/** The person changed their mind in time: the order is off and the budget is back. Moving on ends the window. */
export async function callBack(
  human: Human,
  courier: Courier,
  chat: RoomChat,
  orderId: string,
): Promise<string | null> {
  const card = pending(chat, orderId);
  if (card?.status !== "open" || Date.now() > card.callBackUntil) return "It’s too late to call that back.";
  if (!(await callOff(human, courier, chat, card))) return "Too late, that’s already paid.";
  if (!running.has(chat.id))
    chat.history.push({ role: "user", content: `(The person called back order ${orderId}. Nothing was charged.)` });
  push(chat, { t: "say", text: "Called back. Nothing was charged, and your budget is back. Want something else?" });
  return null;
}

/** Deleting a chat ends what it had running. The errand stays in the person's records, without the chat. */
export async function deleteChat(human: Human, courier: Courier, chat: RoomChat): Promise<string | null> {
  if (running.has(chat.id)) return `${courier.name} is still working in that chat.`;
  for (const event of chat.events)
    if (event.t === "pay" && event.status === "open") await cancelCard(human, courier, event).catch(() => {});
  for (const visa of openErrands(chat)) await revokeVisa(visa.id, "The chat was deleted");
  db.delete("room_chats", chat.id);
  return null;
}

/* ---------------- tools ---------------- */

function roomTools(human: Human, courier: Courier, chat: RoomChat, message: string): CallTool {
  const clientId = demoClientId(courier.id);
  const browse = async (shop: Shop, tool: string, args: Record<string, unknown>) =>
    askShop(
      shop,
      await mintShopConnectionToken(roomConnection(human, courier), human, shop.resource),
      courier,
      tool,
      args,
    );
  const noShop = (name: unknown): ToolResult => ({
    text: `There's no shop called "${String(name)}". The shops: ${SHOPS.map((x) => x.name).join(", ")}.`,
    isError: true,
  });
  const errand = (id: unknown) => openErrands(chat).find((v) => v.id === id);
  // Only an offer made before this message counts as agreed to. The courier can't offer and accept in one go.
  const offeredBefore = chat.offered;

  return async (name, args) => {
    const shop = typeof args.shop === "string" ? shopNamed(args.shop) : undefined;
    switch (name) {
      case "list_shops":
        return { text: SHOPS.map((x) => `${x.name}: ${x.sells}`).join("\n") };
      case "search_shop":
        if (!shop) return noShop(args.shop);
        return browse(shop, "search_catalog", {
          query: String(args.query ?? ""),
          ...(Number(args.max_price) > 0 ? { max_price: Number(args.max_price) } : {}),
        });
      case "start_errand": {
        const what = String(args.what ?? "")
          .trim()
          .slice(0, 160);
        if (!what) return { text: "Say what the errand is for.", isError: true };
        const proposed = budgetFromCourier(args.budget, message);
        const problem = proposed && budgetProblem(human, proposed);
        if (problem) {
          chat.awaiting = { what };
          chat.amounts = true;
          return { text: problem, isError: true };
        }
        if (proposed) chat.pendingBudget = proposed;
        const picked: PickedItem[] = Array.isArray(args.items) ? args.items.slice(0, 10) : [];
        if (!chat.pendingBudget && picked.length) {
          const quote = await quoteItems(picked, async (at, item_id) => {
            const found = await browse(at, "get_item", { item_id });
            return found.isError ? null : found.data;
          });
          if ("problem" in quote) return { text: quote.problem, isError: true };
          const key = picked
            .map((p) => `${p.shop}/${p.item_id}`)
            .sort()
            .join();
          const sure = key === offeredBefore || quote.lines.every((l) => itemNamedIn(l.title, message));
          if (!sure) {
            chat.offered = key;
            chat.confirm = true;
            const list = quote.lines.map((l) => `${l.title} $${l.price}`).join(", ");
            return {
              text: `You chose some of this, so they hear the price first: ${list}. Tell them that and the total, then stop.`,
              data: { needs_ok: true },
            };
          }
          const over = budgetProblem(human, quote.dollars);
          if (over) return { text: over, isError: true };
          chat.pendingBudget = quote.dollars;
          chat.offered = undefined;
        }
        if (!chat.pendingBudget) {
          chat.awaiting = { what };
          return {
            text: "The person hasn't named a budget. Ask them what it is, in one short line, then stop. You can't set it.",
            data: { needs_budget: true },
          };
        }
        const visa = startErrand(human, courier, chat, what, chat.pendingBudget);
        chat.pendingBudget = undefined;
        chat.awaiting = undefined;
        touch(chat);
        return {
          text: `Errand started, up to $${visa.spendLimitCents / 100}. Now find it and buy it with errand_id="${visa.id}".`,
          data: { errand_id: visa.id },
        };
      }
      case "change_budget": {
        const dollars = budgetFromCourier(args.budget, message);
        if (!dollars)
          return { text: "The person hasn't written that amount. Ask them what it should be.", isError: true };
        const problem = changeBudget(human, chat, String(args.errand_id), dollars);
        if (problem) return { text: problem, isError: true };
        touch(chat);
        return { text: `The budget is now $${dollars}.` };
      }
      // The scripted courier reads what's left here. It isn't offered to the model, which sees its errands in its prompt.
      case "errand": {
        const visa = errand(args.errand_id);
        return { text: "", data: { remaining: visa ? remainingBudget(visa) / 100 : 0 } };
      }
      case "buy": {
        if (!shop) return noShop(args.shop);
        const visa = errand(args.errand_id);
        if (!visa) return { text: "That errand isn't open. Call start_errand first.", isError: true };
        const { token } = await mintAccessToken(visa, human, clientId, {
          expiresInSeconds: 60,
          audience: shop.resource,
        });
        const itemIds = Array.isArray(args.item_ids) ? args.item_ids.map(String).slice(0, 10) : [];
        const out = await askShop(shop, token, courier, "request_purchase", {
          item_ids: itemIds,
          ...(typeof args.approval_id === "string" ? { approval_id: args.approval_id } : {}),
        });
        if (out.data.order_id) chat.lastOrderId = out.data.order_id;
        chat.pendingApproval =
          out.data.decision === "ask_human"
            ? { approvalId: out.data.approval_id, errandId: visa.id, shop: shop.name, itemIds }
            : undefined;
        return out;
      }
      case "order_status":
        if (!shop) return noShop(args.shop);
        return browse(shop, "order_status", { order_id: String(args.order_id ?? "") });
      // Shares come from the shop's price and each contact's courier, here in code. The model only names the item and people.
      case "chip_in": {
        if (!shop) return noShop(args.shop);
        const { found, unknown } = findContacts(human, args.with);
        if (unknown.length || !found.length)
          return {
            text: `${unknown.length ? `${unknown.join(", ")} isn't one of their contacts. ` : ""}They can chip in with: ${contactLine(contactsOf(human))}.`,
            isError: true,
          };
        const itemId = String(args.item_id ?? "");
        const item = await browse(shop, "get_item", { item_id: itemId });
        if (item.isError || !item.data.price)
          return { text: `${shop.name} has no item ${itemId}. Search the shop for its id.`, isError: true };
        if (!item.data.in_stock) return { text: `${item.data.title} is sold out.`, isError: true };
        const priceCents = Math.round(Number(item.data.price) * 100);
        const split = planSplit(priceCents, found);
        const names = found.map((c) => c.name).join(" and ");
        const key = `chip|${shop.name}|${itemId}|${found
          .map((c) => c.name)
          .sort()
          .join("+")}`;
        // Covering for someone is always asked first, and so is an item the person didn't name.
        const sure = key === offeredBefore || (!split.coverCents && itemNamedIn(String(item.data.title), message));
        if (!sure) {
          chat.offered = key;
          chat.confirm = true;
          const short = split.shares.filter((x) => x.short);
          return {
            text:
              `${item.data.title} is ${usd(priceCents)}. ` +
              short
                .map((x) => `${x.contact.courierName} says ${x.contact.name} can put in ${usd(x.cents)}. `)
                .join("") +
              `Their share would be ${usd(split.mineCents)}${split.coverCents ? `, covering ${usd(split.coverCents)} more than an even split` : ""}; ` +
              split.shares.map((x) => `${x.contact.name} pays ${usd(x.cents)}`).join(", ") +
              ". Tell them the split in one or two short sentences and ask if that's OK, then stop.",
            data: { needs_ok: true },
          };
        }
        chat.offered = undefined;
        const dollars = Math.ceil(split.mineCents / 100);
        const over = budgetProblem(human, dollars);
        if (over) return { text: over, isError: true };
        const what =
          String(args.what ?? "")
            .trim()
            .slice(0, 120) || `${item.data.title}, with ${names}`;
        const visa = startErrand(human, courier, chat, what, dollars);
        touch(chat);
        const { token } = await mintAccessToken(visa, human, clientId, {
          expiresInSeconds: 60,
          audience: shop.resource,
        });
        const out = await askShop(shop, token, courier, "request_purchase", {
          item_ids: [itemId],
          share: { cents: split.mineCents },
        });
        if (!out.data.group_id) {
          await revokeVisa(visa.id, "The share didn't go through");
          return { text: `That didn't go through: ${out.text}`, isError: true };
        }
        const run: GroupRun = {
          groupId: out.data.group_id,
          orderId: out.data.order_id,
          shopSlug: shop.slug,
          item: {
            id: itemId,
            title: item.data.title,
            artist: item.data.artist,
            category: item.data.category,
            hue: item.data.hue,
            price: item.data.price,
          },
          priceCents,
          mineCents: split.mineCents,
          shares: split.shares.map((x) => ({
            contactId: x.contact.id,
            name: x.contact.name,
            courier: x.contact.courierName,
            cents: x.cents,
          })),
        };
        chat.groups = [...(chat.groups ?? []), run];
        const data = { ...out.data, errand_id: visa.id };
        if (out.data.status === "paid") {
          collecting.add(run.groupId);
          const ticket = await collectShares(human, courier, run).finally(() => collecting.delete(run.groupId));
          return {
            text: `Paid their share with their saved PayPal, and ${names} paid theirs. Say so in one short sentence.`,
            data: { ...data, group_ticket: ticket },
          };
        }
        return {
          text: `Their share, ${usd(split.mineCents)}, is ready for them to pay. Once they do, ${split.shares.map((x) => x.contact.courierName).join(" and ")} pay${found.length > 1 ? "" : "s"} ${names}'s. Say that in one short sentence.`,
          data,
        };
      }
      // Asking in words works for as long as nothing is paid. Only the button's time runs out when they carry on chatting.
      case "call_back": {
        const cards = chat.events.filter(
          (e): e is Extract<ChatEvent, { t: "pay" }> =>
            e.t === "pay" && e.status === "open" && (!args.order_id || e.order_id === args.order_id),
        );
        if (!cards.length) return { text: "There's nothing unpaid to call back." };
        const done = await Promise.all(cards.map((card) => callOff(human, courier, chat, card)));
        return {
          text: done.every(Boolean)
            ? "Called back. Nothing was charged, and the budget is free again."
            : "Some of it was already paid, so it can't be called back. The rest is called back, and nothing was charged for it.",
        };
      }
      case "end_errand": {
        const visa = errand(args.errand_id);
        if (!visa) return { text: "That errand isn't open.", isError: true };
        for (const e of chat.events)
          if (e.t === "pay" && e.status === "open" && e.errand_id === visa.id) await callOff(human, courier, chat, e);
        await revokeVisa(visa.id, "Ended from the errand room");
        return { text: "The errand has ended, and anything unpaid on it is called back.", data: { ended: true } };
      }
      default:
        return { text: `Unknown tool ${name}.`, isError: true };
    }
  };
}

/* ---------------- a turn ---------------- */

const NOTES: Record<string, (step: Step) => string> = {
  search_shop: (s) => `Looking at ${s.data?.shop_name || s.args?.shop || "the shop"}…`,
  buy: (s) => `Checking out at ${s.data?.shop_name || s.args?.shop || "the shop"}…`,
  chip_in: () => "Asking the others’ couriers…",
  start_errand: () => "Writing the errand…",
};

/** The tools speak to the agent; strip the links and instructions meant for it. */
const clean = (text: string) =>
  text
    .replace(
      /\s*(Approve the payment here|Send the user this link to approve or decline|Ask the user to approve the payment here):?\s*https?:\/\/\S+/gi,
      "",
    )
    .replace(/\s*After they decide[^\n]*/g, "")
    .replace(/\s*Then call order_status[^\n]*/g, "")
    .trim();

/** Turns what the courier did into what the window shows, in the order a person should read it. */
function report(chat: RoomChat, steps: Step[], reply: string): void {
  if (reply) chat.events.push({ t: "say", text: clean(reply) });
  const buys = steps.filter((s) => (s.tool === "buy" || s.tool === "chip_in") && s.ok !== undefined);
  const paid = buys.some((s) => s.data?.status === "paid");
  for (const step of buys) {
    const d = step.data ?? {};
    if (d.approve_url && !pending(chat, d.order_id))
      chat.events.push({
        t: "pay",
        order_id: d.order_id,
        shop_slug: d.shop_slug,
        shop_name: d.shop_name,
        approve_url: d.approve_url,
        total: d.total,
        items: d.items ?? [],
        status: "open",
        callBackUntil: d.call_back_until ? Date.parse(d.call_back_until) : Date.now() + CALL_BACK_MS,
        errand_id: (d.errand_id ?? step.args.errand_id) as string,
        ...(d.group_id ? { group: d.group_id } : {}),
      });
    else if (d.group_ticket) chat.events.push(d.group_ticket);
    else if (d.status === "paid")
      chat.events.push({
        t: "receipt",
        order_id: d.order_id,
        shop: d.shop_name,
        total: d.total,
        items: d.items ?? [],
        receipt_url: d.receipt_url ?? null,
      });
    else if (d.decision === "ask_human")
      chat.events.push({
        t: "ask",
        approval_id: d.approval_id,
        reason: d.reason ?? "",
        items: (step.args.item_ids as string[]) ?? [],
      });
    else if (d.decision === "deny") chat.events.push({ t: "no", reason: d.reason ?? "It’s outside your limits." });
  }
  if (paid && !unpaid(chat)) chat.events.push({ t: "say", text: "All done. Let me know if you need anything else." });
  if (chat.confirm) return;
  // What it looked at and didn't buy from: one shelf per shop, shorter when there are several.
  const boughtAt = new Set(buys.map((s) => s.data?.shop_name));
  const shelves = new Map<string, Record<string, unknown>[]>();
  for (const s of steps)
    if (s.tool === "search_shop" && s.data?.results?.length && !boughtAt.has(s.data.shop_name))
      shelves.set(s.data.shop_name, s.data.results);
  for (const [shop, results] of shelves)
    chat.events.push({ t: "items", shop, results: results.slice(0, shelves.size > 1 ? 3 : 4) });
}

/** One message from the person. Their budget is dealt with here, first; the rest goes to the courier. */
async function roomTurn(human: Human, courier: Courier, chat: RoomChat, message: string): Promise<void> {
  const say = (text: string, amounts = false) => {
    chat.amounts = amounts;
    push(chat, { t: "say", text });
  };
  if (courier.revokedAt)
    return say(`I’ve been revoked. You can restore me on the [Couriers](${config.courier.url}/app/couriers) page.`);

  // In a chat about shopping, a bare number is dollars, whether or not the courier got round to asking.
  const named = parseBudget(message, true);
  const problem = named && budgetProblem(human, named.dollars);
  if (problem) {
    if (!named.only) chat.awaiting = { what: withoutBudget(message) };
    return say(problem, Boolean(chat.awaiting));
  }
  let resume: { what: string; errandId: string } | undefined;
  if (named?.only) {
    if (chat.awaiting) {
      const { what } = chat.awaiting;
      const visa = startErrand(human, courier, chat, what, named.dollars);
      chat.awaiting = undefined;
      resume = { what, errandId: visa.id };
    } else {
      const current = openErrands(chat).at(-1);
      if (current)
        return say(
          changeBudget(human, chat, current.id, named.dollars) ?? `Done, your budget’s now $${named.dollars}.`,
        );
      chat.pendingBudget = named.dollars;
      return say(`Got it, up to $${named.dollars}. What can I get you?`);
    }
  } else if (named) {
    chat.pendingBudget = named.dollars;
    chat.awaiting = undefined;
  }

  chat.amounts = false;
  chat.confirm = false;
  const out = await runAgent(
    {
      memory: chat,
      callTool: roomTools(human, courier, chat, message),
      courierName: courier.name,
      humanName: firstName(human) ?? "the person",
      errands: [
        ...openErrands(chat).map(
          (v) =>
            `${v.id}: "${v.intent}", $${(remainingBudget(v) / 100).toFixed(2)} left of $${v.spendLimitCents / 100}`,
        ),
        ...chat.events.flatMap((e) =>
          e.t === "pay" && e.status === "open"
            ? [`unpaid order ${e.order_id}: ${e.items.map((i) => i.title).join(", ")}, $${e.total}`]
            : [],
        ),
      ].join("; "),
      contacts: contactLine(contactsOf(human)),
      resume,
      onStep: (step) => {
        const note = NOTES[step.tool]?.(step);
        if (note) chat.note = note;
        touch(chat);
      },
      onHelpers: (count) => {
        chat.note = `Sending ${count} helpers…`;
        touch(chat);
      },
    },
    resume?.what ?? message,
  );

  // A courier can ask for a budget without using the tool. Hold on to the request, so the answer is read as a budget.
  const asked =
    /\bbudget\b/i.test(out.reply) &&
    !chat.pendingBudget &&
    !chat.confirm &&
    !out.steps.some((s) => s.tool === "buy" || s.data?.errand_id);
  if (asked && !openErrands(chat).length) chat.awaiting ??= { what: message };
  chat.amounts = Boolean(out.needsBudget || (asked && chat.awaiting));
  report(chat, out.steps, out.reply);
  touch(chat);
}

/** The person answered the courier's question. A yes sends it back to the shop. */
export function answerApproval(human: Human, courier: Courier, chat: RoomChat, approvalId: string, yes: boolean): void {
  for (const event of chat.events)
    if (event.t === "ask" && event.approval_id === approvalId) event.answered = yes ? "ok" : "no";
  if (yes) {
    sendMessage(human, courier, chat, "go ahead", true);
    return;
  }
  chat.pendingApproval = undefined;
  push(chat, { t: "say", text: "OK, I'll leave it." });
}

async function drain(human: Human, courier: Courier, chat: RoomChat): Promise<void> {
  running.set(chat.id, chat);
  try {
    for (let message = chat.queue.shift(); message !== undefined; message = chat.queue.shift()) {
      chat.note = "";
      touch(chat);
      await roomTurn(human, courier, chat, message).catch((error) => {
        console.error("[errand] turn failed", error);
        chat.events.push({ t: "dim", text: "That didn’t work. Try asking again." });
      });
    }
  } finally {
    running.delete(chat.id);
    chat.note = "";
    touch(chat);
  }
}

/**
 * Takes a message and answers in the background. Other chats keep going meanwhile; in this one, it waits its turn. A person
 * who moves on has left the purchase standing, so the time to call it back ends here.
 */
export function sendMessage(human: Human, courier: Courier, chat: RoomChat, message: string, quiet = false): void {
  for (const event of chat.events) if (event.t === "pay") event.callBackUntil = 0;
  if (!quiet) chat.events.push({ t: "me", text: message });
  if (!chat.title) chat.title = withoutBudget(message).slice(0, 60);
  chat.queue.push(message);
  touch(chat);
  if (!running.has(chat.id)) void drain(human, courier, chat);
}
