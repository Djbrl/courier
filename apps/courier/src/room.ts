import {
  ALL_SCOPES,
  BUDGET_MAX,
  BUDGET_MIN,
  COURIER_RESOURCE,
  newId,
  parseBudget,
  SHOPS,
  type Shop,
  shopNamed,
  type Visa,
} from "@courier/shared";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { type AgentMemory, type CallTool, runAgent, type Step, type ToolResult, withStore } from "./agent.ts";
import { mintAccessToken, mintShopConnectionToken } from "./auth/oauth.ts";
import { anyShop, type Connection, type Courier, db, effectiveStatus, type Human, remainingBudget } from "./db.ts";
import { demoClientId, firstName } from "./pages/shared.ts";
import { addStamp, issueErrand, revokeVisa } from "./visas.ts";

/**
 * The errand room: one running chat with a courier, and as many errands as the person asks for, each with its own budget,
 * at any shop. The budget comes from what the person types, read here in code. The courier can't set or change one.
 */

export interface RoomSession extends AgentMemory {
  courierId: string;
  humanId: string;
}

export function roomSession(courier: Courier): RoomSession {
  return (
    db.get<RoomSession>("room_sessions", courier.id) ?? { courierId: courier.id, humanId: courier.humanId, history: [] }
  );
}

export const saveRoom = (s: RoomSession) => db.put("room_sessions", s.courierId, s);

/** The errand room's own link to the shops. It isn't a Claude the person connected, so the app doesn't list it. */
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

/** This courier's errands from the room that are still out, oldest first. */
function openErrands(courier: Courier): Visa[] {
  const clientId = demoClientId(courier.id);
  return db
    .list<Visa>("visas", (v) => v.clientId === clientId && v.humanId === courier.humanId && anyShop(v), Infinity)
    .filter((v) => effectiveStatus(v) === "active")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function roomState(s: RoomSession, courier: Courier) {
  return {
    errands: openErrands(courier).map((v) => ({
      id: v.id,
      what: v.intent,
      spentCents: v.spentCents,
      limitCents: v.spendLimitCents,
      remainingCents: remainingBudget(v),
    })),
    pendingBudgetCents: s.pendingBudget ? s.pendingBudget * 100 : null,
    awaiting: Boolean(s.awaiting),
  };
}

const inRange = (dollars: number) => Number.isInteger(dollars) && dollars >= BUDGET_MIN && dollars <= BUDGET_MAX;
const RANGE = `Budgets go from $${BUDGET_MIN} to $${BUDGET_MAX}.`;

/** What an errand is for, without the budget the person said in the same breath. */
const withoutBudget = (what: string) =>
  what
    .replace(
      /[,\s]*\b(?:under|below|less than|up to|max|no more than|about|around|budget(?: of| is)?|i have(?: about)?)\s*\$?\s*\d+(?:\.\d+)?(?:\s*(?:dollars?|bucks?))?.*$/i,
      "",
    )
    .trim() || what;

/** Starts an errand on a budget the person set. Anything already bought for is finished, so errands read as a chain. */
function startErrand(human: Human, courier: Courier, what: string, dollars: number): Visa {
  for (const old of openErrands(courier)) {
    const held = old.spendLimitCents - old.spentCents - remainingBudget(old);
    if (old.spentCents > 0 && held === 0)
      db.put<Visa>("visas", old.id, { ...old, status: "expired", revokeReason: "Done" });
  }
  return issueErrand({
    connection: { clientId: demoClientId(courier.id), scopes: [...ALL_SCOPES] },
    human,
    courierName: courier.name,
    what: withoutBudget(what),
    budget: dollars,
    auto: false,
  });
}

/** Changes an errand's budget, or says why it can't. Limits are read fresh at every purchase, so this applies at once. */
export function changeBudget(courier: Courier, errandId: string, dollars: number): string | null {
  if (!inRange(dollars)) return RANGE;
  const visa = openErrands(courier).find((v) => v.id === errandId);
  if (!visa) return "That errand has ended.";
  const used = visa.spendLimitCents - remainingBudget(visa);
  if (dollars * 100 < used) return `It’s already used $${(used / 100).toFixed(2)} of this budget.`;
  db.put<Visa>("visas", visa.id, { ...visa, spendLimitCents: dollars * 100, perPurchaseLimitCents: dollars * 100 });
  addStamp(visa, "visa_issued", "You changed the budget", `Now up to $${dollars}`);
  return null;
}

export function setNextBudget(s: RoomSession, dollars: number): string | null {
  if (!inRange(dollars)) return RANGE;
  s.pendingBudget = dollars;
  saveRoom(s);
  return null;
}

export async function endErrand(courier: Courier, errandId: string): Promise<boolean> {
  const visa = openErrands(courier).find((v) => v.id === errandId);
  if (visa) await revokeVisa(visa.id, "Called back by the person");
  return Boolean(visa);
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

/** What a shop says about an order of this person's, for the window to watch a payment. */
export async function orderStatus(human: Human, courier: Courier, shopSlug: string, orderId: string) {
  const shop = SHOPS.find((s) => s.slug === shopSlug);
  if (!shop) return null;
  const token = await mintShopConnectionToken(roomConnection(human, courier), human, shop.resource);
  return askShop(shop, token, courier, "order_status", { order_id: orderId });
}

function roomTools(human: Human, courier: Courier, s: RoomSession): CallTool {
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
  const errand = (id: unknown) => openErrands(courier).find((v) => v.id === id);

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
        if (!s.pendingBudget) {
          s.awaiting = { what };
          return {
            text: "The person hasn't named a budget. Ask them what it is, in one short line, then stop. You can't set it.",
            data: { needs_budget: true },
          };
        }
        const visa = startErrand(human, courier, what, s.pendingBudget);
        s.pendingBudget = undefined;
        s.awaiting = undefined;
        return {
          text: `Errand started, up to $${visa.spendLimitCents / 100}. Now find it and buy it with errand_id="${visa.id}".`,
          data: { errand_id: visa.id },
        };
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
        if (out.data.order_id) s.lastOrderId = out.data.order_id;
        s.pendingApproval =
          out.data.decision === "ask_human"
            ? { approvalId: out.data.approval_id, errandId: visa.id, shop: shop.name, itemIds }
            : undefined;
        return out;
      }
      case "order_status":
        if (!shop) return noShop(args.shop);
        return browse(shop, "order_status", { order_id: String(args.order_id ?? "") });
      case "end_errand":
        return (await endErrand(courier, String(args.errand_id)))
          ? { text: "The errand has ended.", data: { ended: true } }
          : { text: "That errand isn't open.", isError: true };
      default:
        return { text: `Unknown tool ${name}.`, isError: true };
    }
  };
}

export interface RoomTurn {
  steps: Step[];
  reply: string;
  needsBudget?: boolean;
}

/** One message from the person. Their budget is dealt with here, first; the rest goes to the courier. */
export async function roomTurn(
  human: Human,
  courier: Courier,
  s: RoomSession,
  message: string,
  onStep: (step: Step) => void,
): Promise<RoomTurn> {
  const named = parseBudget(message, Boolean(s.awaiting));
  const said = (reply: string, needsBudget = false): RoomTurn => ({ steps: [], reply, needsBudget });
  let resume: { what: string; errandId: string } | undefined;

  if (named && !inRange(named.dollars)) return said(`${RANGE} What should it be?`, Boolean(s.awaiting));
  if (named?.only) {
    if (s.awaiting) {
      const { what } = s.awaiting;
      const visa = startErrand(human, courier, what, named.dollars);
      s.awaiting = undefined;
      resume = { what, errandId: visa.id };
    } else {
      const current = openErrands(courier).at(-1);
      if (current)
        return said(changeBudget(courier, current.id, named.dollars) ?? `Done, your budget’s now $${named.dollars}.`);
      s.pendingBudget = named.dollars;
      saveRoom(s);
      return said(`Got it, up to $${named.dollars}. What can I get you?`);
    }
  } else if (named) {
    s.pendingBudget = named.dollars;
    s.awaiting = undefined;
  }

  try {
    return await runAgent(
      {
        memory: s,
        callTool: roomTools(human, courier, s),
        courierName: courier.name,
        humanName: firstName(human) ?? "the person",
        errands: openErrands(courier)
          .map(
            (v) =>
              `${v.id}: "${v.intent}", $${(remainingBudget(v) / 100).toFixed(2)} left of $${v.spendLimitCents / 100}`,
          )
          .join("; "),
        resume,
        onStep,
      },
      resume?.what ?? message,
    );
  } finally {
    saveRoom(s);
  }
}
