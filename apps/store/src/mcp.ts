import {
  config,
  findShop,
  internalFetch,
  JUNIPER,
  money,
  newId,
  paypal,
  RECEIPT_CARD,
  RECEIPT_CARD_MIME,
  RECEIPT_CARD_URI,
  randomToken,
  type Shop,
  type VisaTokenClaims,
} from "@courier/shared";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import {
  type AgentClaims,
  agentName,
  claimsOf,
  forgetVisa,
  hasTicket,
  logRequest,
  ownerId,
  type TicketClaims,
  withFreshTicket,
} from "./auth.ts";
import { findItem, type Item, searchCatalog, shelfOf } from "./catalog.ts";
import { db, type Order, type Reservation } from "./db.ts";
import { receiptUrl } from "./views.ts";

/* ---------------- helpers ---------------- */

function text(body: string, structured?: Record<string, unknown>, isError = false): CallToolResult {
  return {
    content: [{ type: "text", text: body }],
    ...(structured ? { structuredContent: structured } : {}),
    ...(isError ? { isError: true } : {}),
  };
}

function itemView(item: Item) {
  return {
    id: item.id,
    title: item.title,
    artist: item.artist,
    category: item.category,
    genre: item.genre,
    price: (item.priceCents / 100).toFixed(2),
    currency: "USD",
    in_stock: item.stock > 0,
    description: item.blurb,
  };
}

/** The receipt details a chat app can show, and the link for the person to open. */
function receiptView(order: Order, shop: Shop, remaining: string | null = null) {
  return {
    order_id: order.id,
    shop: shop.name,
    status: order.status,
    paid_with: order.paidWith ?? null,
    total: (order.totalCents / 100).toFixed(2),
    currency: "USD",
    agent: order.agent,
    items: order.items.map((line) => {
      const item = findItem(line.id);
      return {
        id: line.id,
        title: line.title,
        artist: item?.artist ?? null,
        hue: item?.hue ?? 210,
        price: (line.priceCents / 100).toFixed(2),
      };
    }),
    receipt_url: order.receiptKey ? receiptUrl(order) : null,
    remaining_budget: remaining,
  };
}

const TICKET_HINT = z
  .object({
    purpose: z
      .string()
      .max(160)
      .optional()
      .describe("What it's for, in the user's words, e.g. 'Jazz records for my dad'."),
    max_per_item: z.number().positive().optional().describe("The per-item limit the user mentioned, in USD."),
    max_total: z.number().positive().optional().describe("The total budget the user mentioned, in USD."),
  })
  .optional()
  .describe("Used to prefill a ticket if the user doesn't have one yet. The user reviews and edits it.");

const TICKET_TIMEOUT_MS = 5 * 60 * 1000;
const WAIT_MS = 40_000;
const PASS_TTL_MS = 15 * 60 * 1000;

/**
 * One-time passes for the budget field in the chat card. A budget has to come from the person, never the model, so the
 * pass travels in the result's _meta for the card alone and the tool that takes it is hidden from the model.
 */
const budgetPasses = new Map<
  string,
  { connectionId: string; hint: z.infer<typeof TICKET_HINT>; price: number; expires: number }
>();

function budgetPass(connectionId: string, hint: z.infer<typeof TICKET_HINT>, price: number): string {
  for (const [key, pass] of budgetPasses) if (pass.expires < Date.now()) budgetPasses.delete(key);
  const pass = randomToken(24);
  budgetPasses.set(pass, { connectionId, hint, price, expires: Date.now() + PASS_TTL_MS });
  return pass;
}

/**
 * No errand yet: get one without sending the person away if we can. They set a budget in a dialog in their chat app,
 * which the model can't answer, and with PayPal already saved the purchase carries on in this same call. A first-time
 * PayPal approval opens in the browser while this call waits. Clients that can't show dialogs get a link instead.
 */
async function getTicket(
  server: McpServer,
  shop: Shop,
  claims: AgentClaims,
  items: Item[],
  hint: z.infer<typeof TICKET_HINT>,
): Promise<{ claims: TicketClaims } | { stop: CallToolResult }> {
  const agent = agentName(claims);
  const price = Math.ceil(items.reduce((sum, i) => sum + i.priceCents, 0) / 100);
  const askCourier = (extra: object) =>
    internalFetch<{ url?: string; issued?: boolean }>(
      `${config.courier.url}/internal/connections/${claims.connection!.id}/ticket`,
      { body: { purpose: hint?.purpose, maxPerItem: hint?.max_per_item, maxTotal: hint?.max_total, price, ...extra } },
    );
  const caps = server.server.getClientCapabilities()?.elicitation as { form?: object; url?: object } | undefined;
  console.log(`[store] budget needed; client dialogs: ${caps ? Object.keys(caps).join(",") || "form" : "none"}`);
  const suggested = Math.min(500, hint?.max_total ?? Math.max(price, 60));

  let url: string | undefined;
  try {
    if (caps && (caps.form || !caps.url)) {
      const answer = await server.server.elicitInput(
        {
          mode: "form",
          message: `Courier: ${agent} wants ${items.map((i) => i.title).join(", ")} for $${price}. What's the most it can spend on this errand?`,
          requestedSchema: {
            type: "object",
            properties: {
              budget: {
                type: "integer",
                title: "Budget, in dollars",
                minimum: 1,
                maximum: 500,
                default: suggested,
              },
            },
            required: ["budget"],
          },
        },
        { timeout: TICKET_TIMEOUT_MS },
      );
      if (answer.action === "accept" && typeof answer.content?.budget === "number") {
        const ticket = await askCourier({ budgetFromPerson: answer.content.budget });
        if (ticket.issued) {
          const ready = await withFreshTicket(claims, shop);
          if (hasTicket(ready)) return { claims: ready };
        }
        url = ticket.url;
      }
    }
    url ??= (await askCourier({})).url!;
    if (caps?.url) {
      const opened = await server.server.elicitInput(
        { mode: "url", message: `Courier: finish setting ${agent}'s budget.`, url, elicitationId: randomToken(12) },
        { timeout: TICKET_TIMEOUT_MS },
      );
      for (const until = Date.now() + TICKET_TIMEOUT_MS; opened.action === "accept" && Date.now() < until; ) {
        const ready = await withFreshTicket(claims, shop);
        if (hasTicket(ready)) return { claims: ready };
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  } catch (error) {
    console.warn("[store] in-chat ticket failed", (error as Error).message);
    url ??= (await askCourier({})).url!;
  }
  return {
    stop: {
      ...text(
        `${agent} needs a budget from the user before it can hold or buy anything. You can't set it for them.\n` +
          `Tell them in one line that they can set it in the card above, or at this link: ${url}\n` +
          `Then call wait_for_budget straight away, and again each time it says to. As soon as it says the budget is ` +
          `set, call this same tool again without asking them anything.`,
        {
          decision: "needs_ticket",
          ticket_url: url,
          agent,
          suggested_budget: suggested,
          items: items.map((i) => ({ ...itemView(i), hue: i.hue })),
          total: price.toFixed(2),
        },
      ),
      _meta: { "courier/budget_pass": budgetPass(claims.connection!.id, hint, price) },
    },
  };
}

function requireScope(claims: AgentClaims, scope: string, shop: Shop): CallToolResult | null {
  if (claims.scope.split(" ").includes(scope)) return null;
  return text(
    `This errand doesn't include "${scope}". Ask the user to start a new errand for ${shop.name} that allows it.`,
    { error: "insufficient_scope", required_scope: scope },
    true,
  );
}

function stamp(visaId: string, shop: Shop, kind: string, title: string, detail = ""): void {
  void internalFetch(`${config.courier.url}/internal/stamps`, {
    body: { visaId, kind, title, detail, merchantName: shop.name },
  }).catch(() => {});
}

/* ---------------- abuse detection: per-visa rate limit ---------------- */

const callLog = new Map<string, number[]>();
const reported = new Set<string>();
const RATE_LIMIT = 40;

async function rateLimited(claims: AgentClaims): Promise<CallToolResult | null> {
  const now = Date.now();
  const owner = ownerId(claims);
  const calls = (callLog.get(owner) ?? []).filter((t) => now - t < 60_000);
  calls.push(now);
  callLog.set(owner, calls);
  if (calls.length <= RATE_LIMIT) return null;
  // Without a ticket there's nothing to suspend or claim, so the calls are just refused.
  if (!hasTicket(claims)) return text("Too many requests. Slow down.", { error: "rate_limited" }, true);
  if (!reported.has(claims.visa.id)) {
    reported.add(claims.visa.id);
    try {
      const result = await internalFetch<{ bondOutcome: string }>(`${config.courier.url}/internal/report`, {
        body: {
          visaId: claims.visa.id,
          reason: `Request flood: ${calls.length} tool calls in 60 seconds`,
          evidence: { calls: calls.length, window: "60s", sub: claims.sub, agent: claims.visa.agent },
        },
      });
      forgetVisa(claims.visa.id);
      logRequest({
        outcome: "blocked",
        reason: `Agent reported for flooding · ${result.bondOutcome}`,
        status: 429,
        sub: claims.sub,
        visaId: claims.visa.id,
        agent: claims.visa.agent,
      });
    } catch (error) {
      console.warn("[store] report failed", (error as Error).message);
    }
  }
  return text(
    "Too many requests. This agent has been reported to Courier and its visa is suspended.",
    { error: "rate_limited" },
    true,
  );
}

/* ---------------- spend authority ---------------- */

interface SpendDecision {
  decision: "approve" | "ask_human" | "deny";
  reason: string;
  code?: string;
  holdId?: string | null;
  approvalId?: string;
  approvalUrl?: string;
  intent?: { model: string; probability: number; reason: string; latencyMs: number } | null;
  remainingCents?: number;
  /** The errand has saved PayPal: Courier can charge this checkout straight away. */
  autopay?: boolean;
}

function spendCheck(
  shop: Shop,
  claims: VisaTokenClaims,
  action: "reserve" | "checkout",
  items: Item[],
  approvalId?: string,
  note?: string,
) {
  return internalFetch<SpendDecision>(`${config.courier.url}/internal/spend/check`, {
    body: {
      visaId: claims.visa.id,
      sub: claims.sub,
      resource: shop.resource,
      action,
      items: items.map((i) => ({
        title: `${i.title} (${i.artist})`,
        category: `${i.category} ${i.genre}`,
        priceCents: i.priceCents,
        quantity: 1,
      })),
      totalCents: items.reduce((s, i) => s + i.priceCents, 0),
      approvalId,
      agentNote: note,
    },
  });
}

function decisionText(decision: SpendDecision, what: string): CallToolResult | null {
  if (decision.decision === "deny") {
    return text(
      `Not allowed: ${decision.reason}\nThe person's visa does not permit ${what}. Tell the user why, and don't retry the same request.`,
      { decision: "deny", code: decision.code ?? null, reason: decision.reason },
      true,
    );
  }
  if (decision.decision === "ask_human") {
    return text(
      `Needs the user's OK first: ${decision.reason}\n` +
        `Send the user this link to approve or decline: ${decision.approvalUrl}\n` +
        `After they decide, call the same tool again with approval_id="${decision.approvalId}".`,
      {
        decision: "ask_human",
        reason: decision.reason,
        approval_url: decision.approvalUrl,
        approval_id: decision.approvalId,
      },
    );
  }
  return null;
}

/* ---------------- asking the person inside their chat app ---------------- */

const ASK_TIMEOUT_MS = 5 * 60 * 1000;
const YES = "Yes, allow it";
const NO = "No";

/**
 * When Courier needs the person's OK, ask them right in their chat app with an MCP elicitation instead of handing the
 * agent a link. The client shows it to the human; the model can't answer it. A form (a dialog in Claude) when the client
 * supports one, else a URL elicitation that opens Courier's approval page. Returns null when the client can't ask, the
 * person dismissed it, or it timed out: the caller falls back to the approval link.
 */
async function askInChat(
  server: McpServer,
  claims: VisaTokenClaims,
  decision: SpendDecision,
  what: string,
  paysNow: boolean,
): Promise<"approved" | "denied" | null> {
  const caps = server.server.getClientCapabilities()?.elicitation as { form?: object; url?: object } | undefined;
  if (!caps || !decision.approvalId) return null;
  const formOk = Boolean(caps.form) || !caps.url; // an empty elicitation capability means forms (the original spec)
  const message = `Courier: ${claims.visa.agent} wants ${what}. ${decision.reason} Allow it?${paysNow ? " Yes pays with your saved PayPal." : ""}`;
  try {
    if (formOk) {
      const answer = await server.server.elicitInput(
        {
          mode: "form",
          message,
          requestedSchema: {
            type: "object",
            properties: { answer: { type: "string", title: `Let ${claims.visa.agent} do this?`, enum: [YES, NO] } },
            required: ["answer"],
          },
        },
        { timeout: ASK_TIMEOUT_MS },
      );
      // Only a picked answer counts. Some clients decline dialogs on their own without showing them, so a bare
      // decline or cancel falls back to the approval link instead of being read as the person's "no".
      if (answer.action !== "accept" || (answer.content?.answer !== YES && answer.content?.answer !== NO)) return null;
      const verdict = answer.content.answer === YES ? "approved" : "denied";
      const out = await internalFetch<{ status: "approved" | "denied" }>(
        `${config.courier.url}/internal/approvals/${decision.approvalId}/decide`,
        {
          body: { visaId: claims.visa.id, decision: verdict },
        },
      );
      return out.status;
    }
    const opened = await server.server.elicitInput(
      { mode: "url", message, url: decision.approvalUrl!, elicitationId: decision.approvalId },
      { timeout: ASK_TIMEOUT_MS },
    );
    if (opened.action !== "accept") return null;
    // They opened Courier's page; wait for their answer there.
    const until = Date.now() + ASK_TIMEOUT_MS;
    while (Date.now() < until) {
      const { status } = await internalFetch<{ status: string }>(
        `${config.courier.url}/internal/approvals/${decision.approvalId}`,
      );
      if (status === "approved" || status === "denied") return status;
      await new Promise((r) => setTimeout(r, 1500));
    }
    return null;
  } catch (error) {
    console.warn("[store] in-chat ask failed", (error as Error).message);
    return null;
  }
}

/**
 * Run Courier's check; if it needs the person, ask them in the chat app and, when they say yes, check again with
 * their approval. Returns the decision the tool should act on.
 */
async function checkWithPerson(
  server: McpServer,
  shop: Shop,
  claims: VisaTokenClaims,
  action: "reserve" | "checkout",
  items: Item[],
  what: string,
  approvalId?: string,
  note?: string,
): Promise<SpendDecision> {
  const first = await spendCheck(shop, claims, action, items, approvalId, note);
  if (first.decision !== "ask_human") return first;
  const answer = await askInChat(server, claims, first, what, action === "checkout" && claims.visa.autopay === true);
  if (answer === "denied")
    return { decision: "deny", code: "human_denied", reason: "The user said no in the Courier dialog." };
  if (answer === "approved") return spendCheck(shop, claims, action, items, first.approvalId, note);
  return first;
}

/* ---------------- the MCP server ---------------- */

export function createMcpServer(shop: Shop): McpServer {
  const shelf = shelfOf(shop.slug);
  const server = new McpServer(
    { name: shop.slug, title: `Courier · ${shop.name}`, version: "0.1.0" },
    {
      instructions:
        `${shop.name} (${shop.sells}) is a shop reached through the user's Courier: a PayPal-verified errand ` +
        `pass with a spending limit. Courier, not you, enforces the limit, so don't refuse or warn on your own: call ` +
        `hold_item or request_purchase. If Courier needs the user, it asks them itself (a dialog in this app, or a link to ` +
        `give them; then retry with the approval_id). request_purchase only spends inside the limits the user set in Courier: if they ` +
        `saved PayPal there, it pays straight away and returns a receipt; otherwise it returns a PayPal link for them to ` +
        `pay (sandbox, no real money). Browsing works without a budget; if there's none yet, pass ticket_hint with what ` +
        `they asked for: if they named an amount, put it in ticket_hint.max_total to fill in the form for them. hold_item and ` +
        `request_purchase get the budget from the user themselves. If they return needs_ticket, follow what it says: ` +
        `you can't set a budget, so point the user to the card or link, then call wait_for_budget until it's set and ` +
        `retry without asking. After a purchase, always give the user the ` +
        `receipt_url so they can see it. Keep it quick: when the user wants something, call request_purchase straight away; ` +
        `don't hold it first, and don't ask the user to confirm before calling (their budget and Courier already did). Use ` +
        `hold_item only when the user asks to put something aside. If Courier gives you an approval link, share it in one ` +
        `line and stop; retry with the approval_id when the user says they answered.`,
    },
  );

  const auth = (extra: { authInfo?: AuthInfo }) => claimsOf(extra.authInfo);

  server.registerTool(
    "wait_for_budget",
    {
      title: "Wait for the user to set a budget",
      description:
        "After a tool returned needs_ticket and you told the user where to set a budget, call this. It returns once the " +
        "budget is set, or after about 40 seconds so you can call it again. Stop after 10 calls and ask the user to say when it's done.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (_args, extra) => {
      const claims = auth(extra);
      for (const until = Date.now() + WAIT_MS; Date.now() < until; await new Promise((r) => setTimeout(r, 2000))) {
        if (hasTicket(await withFreshTicket(claims, shop))) {
          return text("The budget is set. Call the tool you were using again now, without asking the user.", {
            ready: true,
          });
        }
      }
      return text("Not set yet. Call wait_for_budget again.", { ready: false });
    },
  );

  // Only the chat card calls this. See budgetPasses.
  server.registerTool(
    "set_budget",
    {
      title: "Set the budget the user typed in the card",
      description: "For the Courier card only. Models can't use this: it needs a pass only the card has.",
      inputSchema: { budget: z.number().int().min(1).max(500), pass: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      _meta: { ui: { resourceUri: RECEIPT_CARD_URI, visibility: ["app"] } },
    },
    async ({ budget, pass }, extra) => {
      const claims = auth(extra);
      const held = budgetPasses.get(pass);
      budgetPasses.delete(pass);
      if (!held || held.expires < Date.now() || held.connectionId !== claims.connection?.id) {
        return text("That budget form has expired.", { error: "invalid_pass" }, true);
      }
      const ticket = await internalFetch<{ url?: string; issued?: boolean }>(
        `${config.courier.url}/internal/connections/${held.connectionId}/ticket`,
        {
          body: {
            purpose: held.hint?.purpose,
            maxPerItem: held.hint?.max_per_item,
            maxTotal: held.hint?.max_total,
            price: held.price,
            budgetFromPerson: budget,
          },
        },
      );
      return text(ticket.issued ? "The budget is set." : "One PayPal approval left.", {
        issued: Boolean(ticket.issued),
        url: ticket.url,
      });
    },
  );

  // A card for chat apps that can show one (MCP Apps). Others ignore it and use the text, which has the same link.
  server.registerResource(
    "receipt-card",
    RECEIPT_CARD_URI,
    { title: "Courier receipt", mimeType: RECEIPT_CARD_MIME },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: RECEIPT_CARD_MIME, text: RECEIPT_CARD }] }),
  );

  server.registerTool(
    "whoami",
    {
      title: "Show my courier ID",
      description:
        "Shows this agent's Courier ID and current ticket, if any: what it may do, its limits, and that a verified human issued it. No personal data is included.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async (_args, extra) => {
      const claims = auth(extra);
      const view = {
        merchant: shop.name,
        agent: agentName(claims),
        sent_by: { pseudonym: claims.sub, verified_human: claims.human.verified, age_range: claims.human.age_range },
        visa: claims.visa,
        scopes: claims.scope.split(" "),
        token_expires_at: new Date(claims.exp * 1000).toISOString(),
      };
      if (!hasTicket(claims))
        return text(
          `Connected to ${shop.name} as ${agentName(claims)}, for a verified human (${claims.sub}). No budget yet: it can browse, but holding or buying needs one.`,
          view,
        );
      return text(
        `Visa ${claims.visa.id} for ${shop.name}, issued by a verified human (${claims.sub}).\n` +
          `Allowed: ${view.scopes.join(", ")}. Budget ${claims.visa.spend_limit.value} ${claims.visa.spend_limit.currency}, ` +
          `max ${claims.visa.per_purchase_limit.value} per purchase.${claims.visa.intent ? ` Intent: "${claims.visa.intent}".` : ""}`,
        view,
      );
    },
  );

  server.registerTool(
    "search_catalog",
    {
      title: "Search the catalog",
      description: `Search ${shop.name} by keywords. Optionally filter by max price in USD and category.`,
      inputSchema: {
        query: z.string().describe("Keywords. Use an empty string to list everything."),
        max_price: z.number().positive().optional().describe("Maximum price in USD."),
        category: z.string().max(40).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, max_price, category }, extra) => {
      const claims = auth(extra);
      const limited = await rateLimited(claims);
      if (limited) return limited;
      const denied = requireScope(claims, "store:browse", shop);
      if (denied) return denied;
      const results = searchCatalog(query, max_price ? Math.round(max_price * 100) : undefined, category, shelf).slice(
        0,
        8,
      );
      if (claims.visa)
        stamp(
          claims.visa.id,
          shop,
          "browse",
          `Browsed ${shop.name}`,
          query ? `Searched "${query}"` : "Listed the catalog",
        );
      if (!results.length) return text(`No items match "${query}".`, { results: [] });
      return text(
        results
          .map(
            (i) =>
              `${i.id} · ${i.title} by ${i.artist} · ${i.category} · ${money(i.priceCents)}${i.stock ? "" : " (sold out)"}`,
          )
          .join("\n"),
        { results: results.map(itemView) },
      );
    },
  );

  server.registerTool(
    "get_item",
    {
      title: "Get item details",
      description: "Get details for one item by id.",
      inputSchema: { item_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ item_id }, extra) => {
      const claims = auth(extra);
      const limited = await rateLimited(claims);
      if (limited) return limited;
      const denied = requireScope(claims, "store:browse", shop);
      if (denied) return denied;
      const item = shelf.find((i) => i.id === item_id);
      if (!item) return text(`No item with id ${item_id}.`, undefined, true);
      return text(
        `${item.title} by ${item.artist}: ${item.blurb} ${money(item.priceCents)}, ${item.stock} in stock.`,
        itemView(item),
      );
    },
  );

  server.registerTool(
    "hold_item",
    {
      title: "Hold an item (no payment)",
      description:
        "Put an item aside for the user for 15 minutes, only when the user asks to hold something. To buy, call " +
        "request_purchase directly instead. No money moves. Courier checks it against the user's errand and, if it doesn't " +
        "fit, asks the user first.",
      inputSchema: {
        item_id: z.string(),
        approval_id: z.string().optional().describe("Pass this after the user approved a flagged request."),
        ticket_hint: TICKET_HINT,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ item_id, approval_id, ticket_hint }, extra) => {
      const asked = auth(extra);
      const limited = await rateLimited(asked);
      if (limited) return limited;
      const denied = requireScope(asked, "store:reserve", shop);
      if (denied) return denied;
      const item = shelf.find((i) => i.id === item_id);
      if (!item) return text(`No item with id ${item_id}.`, undefined, true);
      if (item.stock <= 0) return text(`${item.title} is sold out.`, undefined, true);
      const got = hasTicket(asked) ? { claims: asked } : await getTicket(server, shop, asked, [item], ticket_hint);
      if ("stop" in got) return got.stop;
      const claims = got.claims;
      const decision = await checkWithPerson(
        server,
        shop,
        claims,
        "reserve",
        [item],
        `to hold ${item.title} (${money(item.priceCents)})`,
        approval_id,
      );
      const blocked = decisionText(decision, `reserving ${item.title}`);
      if (blocked) return blocked;
      const reservation: Reservation = {
        id: newId("rsv"),
        visaId: claims.visa.id,
        itemId: item.id,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      };
      db.put("reservations", reservation.id, reservation);
      return text(`Reserved ${item.title} until ${new Date(reservation.expiresAt).toLocaleTimeString("en-GB")}.`, {
        reservation_id: reservation.id,
        item: itemView(item),
        expires_at: reservation.expiresAt,
      });
    },
  );

  server.registerTool(
    "request_purchase",
    {
      title: "Buy items (within the user's Courier limits)",
      description:
        "Buy items the user wants. Courier checks the user's limits and errand first and asks the user itself if something " +
        "doesn't fit. If the user saved PayPal in Courier, it's paid straight away and you get a receipt; " +
        "otherwise you get a PayPal link for the user to pay, then call order_status. Call it directly whenever the user " +
        "asks to buy (no need to hold the item first or to confirm with the user).",
      inputSchema: {
        item_ids: z.array(z.string()).min(1).max(10),
        approval_id: z.string().optional().describe("Pass this after the user approved a flagged purchase."),
        note: z.string().max(280).optional().describe("Optional note about why you are buying this."),
        ticket_hint: TICKET_HINT,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      _meta: { ui: { resourceUri: RECEIPT_CARD_URI } },
    },
    async ({ item_ids, approval_id, note, ticket_hint }, extra) => {
      const asked = auth(extra);
      const limited = await rateLimited(asked);
      if (limited) return limited;
      const denied = requireScope(asked, "store:buy", shop);
      if (denied) return denied;

      const items: Item[] = [];
      for (const id of item_ids) {
        const item = shelf.find((i) => i.id === id);
        if (!item) return text(`No item with id ${id} at ${shop.name}.`, undefined, true);
        if (item.stock <= 0) return text(`${item.title} is sold out.`, undefined, true);
        items.push(item);
      }
      const totalCents = items.reduce((s, i) => s + i.priceCents, 0);
      const got = hasTicket(asked) ? { claims: asked } : await getTicket(server, shop, asked, items, ticket_hint);
      if ("stop" in got) return got.stop;
      const claims = got.claims;

      const what = `${items.map((i) => i.title).join(", ")} for ${money(totalCents)}`;
      const decision = await checkWithPerson(server, shop, claims, "checkout", items, what, approval_id, note);
      const blocked = decisionText(decision, `a ${money(totalCents)} purchase`);
      if (blocked) return blocked;

      const description = `${shop.name}: ${items.map((i) => i.title).join(", ")}`;
      const lines = items.map((i) => ({
        name: `${i.title} (${i.artist})`,
        unitCents: i.priceCents,
        quantity: 1,
        sku: i.id,
      }));
      const evidence = {
        visa: claims.visa,
        intent: decision.intent ?? { model: "human", reason: decision.reason },
        tokenJti: (claims as unknown as { jti: string }).jti,
        humanVerified: claims.human.verified,
      };
      const remaining = decision.remainingCents !== undefined ? (decision.remainingCents / 100).toFixed(2) : null;

      // Saved PayPal: Courier charges it right away, no PayPal page.
      let savedFailed = false;
      if (decision.autopay) {
        const charged = await internalFetch<{ orderId: string; status: string; captureId: string | null }>(
          `${config.courier.url}/internal/spend/charge`,
          {
            body: {
              visaId: claims.visa.id,
              holdId: decision.holdId,
              description,
              brandName: shop.name,
              items: lines,
            },
          },
        ).catch((e) => {
          console.warn("[store] saved PayPal charge failed", e.message);
          return null;
        });
        if (charged?.status === "COMPLETED") {
          const paid: Order = {
            id: charged.orderId,
            shop: shop.slug,
            visaId: claims.visa.id,
            sub: claims.sub,
            agent: claims.visa.agent,
            holdId: decision.holdId!,
            items: items.map((i) => ({ id: i.id, title: i.title, priceCents: i.priceCents, quantity: 1 })),
            totalCents,
            status: "paid",
            approveUrl: null,
            paidWith: "saved_paypal",
            captureId: charged.captureId,
            receiptKey: randomToken(18),
            createdAt: new Date().toISOString(),
            paidAt: new Date().toISOString(),
            evidence,
          };
          db.put("orders", paid.id, paid);
          await fulfil(paid);
          return text(
            `Bought ${items.map((i) => i.title).join(", ")} for ${money(totalCents)}, paid with the user's saved PayPal ` +
              `(order ${paid.id}).${remaining ? ` $${remaining} left on this errand.` : ""}\n` +
              `Give the user their receipt: ${receiptUrl(paid)}`,
            { ...receiptView(paid, shop, remaining), intent_check: decision.intent ?? null },
          );
        }
        savedFailed = true;
      }

      const order = await paypal.createOrder(
        {
          intent: "CAPTURE",
          amountCents: totalCents,
          currency: "USD",
          description,
          customId: claims.visa.id, // the visa travels with the payment as evidence
          returnUrl: `${config.store.url}/paypal/return`,
          cancelUrl: `${config.store.url}/paypal/cancel`,
          brandName: shop.name,
          items: lines,
        },
        `checkout-${decision.holdId}`,
      );

      const record: Order = {
        id: order.id,
        shop: shop.slug,
        visaId: claims.visa.id,
        sub: claims.sub,
        agent: claims.visa.agent,
        holdId: decision.holdId!,
        items: items.map((i) => ({ id: i.id, title: i.title, priceCents: i.priceCents, quantity: 1 })),
        totalCents,
        status: "awaiting_approval",
        approveUrl: order.approveUrl!,
        paidWith: "paypal_page",
        receiptKey: randomToken(18),
        createdAt: new Date().toISOString(),
        evidence,
      };
      db.put("orders", record.id, record);

      return text(
        (savedFailed
          ? "PayPal refused the saved payment, so the user pays on PayPal's page instead. Tell them that.\n"
          : "") +
          `PayPal checkout created for ${money(totalCents)} (${items.map((i) => i.title).join(", ")}).\n` +
          `Ask the user to approve the payment here: ${order.approveUrl}\n` +
          `Then call order_status with order_id="${order.id}".`,
        {
          ...receiptView(record, shop, remaining),
          approve_url: order.approveUrl,
          intent_check: decision.intent ?? null,
        },
      );
    },
  );

  server.registerTool(
    "order_status",
    {
      title: "Check an order",
      description: "Check whether an order is paid.",
      inputSchema: { order_id: z.string() },
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: RECEIPT_CARD_URI } },
    },
    async ({ order_id }, extra) => {
      const claims = auth(extra);
      const order = db.get<Order>("orders", order_id);
      // By person, not by ticket: an order stays theirs to check after its errand has ended.
      if (!order || order.sub !== claims.sub) return text(`No order ${order_id} for this courier.`, undefined, true);
      const settled = order.status === "awaiting_approval" ? await settleOrder(order.id) : order;
      return text(
        settled.status === "paid"
          ? `Paid: ${money(settled.totalCents)} for ${settled.items.map((i) => i.title).join(", ")}.${settled.receiptKey ? `\nGive the user their receipt: ${receiptUrl(settled)}` : ""}`
          : settled.status === "awaiting_approval"
            ? `Waiting for the user to approve the payment: ${settled.approveUrl}`
            : `Order ${settled.status}.`,
        receiptView(settled, shop),
      );
    },
  );

  return server;
}

/**
 * Captures an approved PayPal order and commits the spend to the visa. Idempotent, so it is safe to call from
 * the PayPal return URL, from order_status, and from webhooks.
 */
export async function settleOrder(orderId: string): Promise<Order> {
  const order = db.get<Order>("orders", orderId);
  if (!order) throw new Error("unknown order");
  if (order.status !== "awaiting_approval") return order;
  let remote = await paypal.getOrder(orderId);
  if (remote.status === "APPROVED") remote = await paypal.captureOrder(orderId, `capture-${orderId}`);
  if (remote.status !== "COMPLETED") return order;

  const paid: Order = {
    ...order,
    status: "paid",
    captureId: remote.captureId ?? null,
    paidAt: new Date().toISOString(),
  };
  db.put("orders", order.id, paid);
  await fulfil(paid);
  return paid;
}

/** A paid order: take the stock and commit the spend to the visa (idempotent on Courier side, one per hold). */
async function fulfil(order: Order): Promise<void> {
  for (const line of order.items) {
    const item = findItem(line.id);
    if (item) item.stock = Math.max(0, item.stock - line.quantity);
  }
  // Idempotent on Courier side (one commit per hold).
  await internalFetch(`${config.courier.url}/internal/spend/commit`, {
    body: {
      visaId: order.visaId,
      holdId: order.holdId,
      orderId: order.id,
      amountCents: order.totalCents,
      summary: `Bought ${order.items.map((i) => i.title).join(", ")}`,
      paidWith: order.paidWith,
      merchantName: (findShop(order.shop) ?? JUNIPER).name,
    },
  }).catch((e) => console.warn("[store] commit failed", e.message));
}
