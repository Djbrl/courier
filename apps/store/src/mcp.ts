import { config, internalFetch, money, newId, paypal, STORE_RESOURCE, type VisaTokenClaims } from "@courier/shared";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import { claimsOf, forgetVisa, logRequest } from "./auth.ts";
import { CATALOG, findItem, type Item, searchCatalog } from "./catalog.ts";
import { db, type Order, type Reservation } from "./db.ts";

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

function requireScope(claims: VisaTokenClaims, scope: string): CallToolResult | null {
  if (claims.scope.split(" ").includes(scope)) return null;
  return text(
    `This visa doesn't include "${scope}". Ask the user to issue a new visa for ${config.store.name} that allows it.`,
    { error: "insufficient_scope", required_scope: scope },
    true,
  );
}

function stamp(visaId: string, kind: string, title: string, detail = ""): void {
  void internalFetch(`${config.courier.url}/internal/stamps`, { body: { visaId, kind, title, detail } }).catch(
    () => {},
  );
}

/* ---------------- abuse detection: per-visa rate limit ---------------- */

const callLog = new Map<string, number[]>();
const reported = new Set<string>();
const RATE_LIMIT = 40;

async function rateLimited(claims: VisaTokenClaims): Promise<CallToolResult | null> {
  const now = Date.now();
  const calls = (callLog.get(claims.visa.id) ?? []).filter((t) => now - t < 60_000);
  calls.push(now);
  callLog.set(claims.visa.id, calls);
  if (calls.length <= RATE_LIMIT) return null;
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
      resource: STORE_RESOURCE,
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
  claims: VisaTokenClaims,
  action: "reserve" | "checkout",
  items: Item[],
  what: string,
  approvalId?: string,
  note?: string,
): Promise<SpendDecision> {
  const first = await spendCheck(claims, action, items, approvalId, note);
  if (first.decision !== "ask_human") return first;
  const answer = await askInChat(server, claims, first, what, action === "checkout" && claims.visa.autopay === true);
  if (answer === "denied")
    return { decision: "deny", code: "human_denied", reason: "The user said no in the Courier dialog." };
  if (answer === "approved") return spendCheck(claims, action, items, first.approvalId, note);
  return first;
}

/* ---------------- the MCP server ---------------- */

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "juniper-records", title: `Courier · ${config.store.name}`, version: "0.1.0" },
    {
      instructions:
        `${config.store.name} is an independent record shop, reached through the user's Courier: a PayPal-verified errand ` +
        `pass with a spending limit and a stated purpose. Courier, not you, decides what fits the errand. If the user asks ` +
        `for something that seems outside their errand, do not refuse or warn on your own: call hold_item or request_purchase ` +
        `anyway. Courier either allows it, or asks the user itself (a dialog in this app, or a link to give them; then retry ` +
        `with the approval_id). request_purchase only spends inside the limits the user set on their Courier ticket: if they ` +
        `saved PayPal there, it pays straight away and returns a receipt; otherwise it returns a PayPal link for them to ` +
        `pay (sandbox, no real money). Keep it quick: when the user wants something, call request_purchase straight away; ` +
        `don't hold it first, and don't ask the user to confirm before calling (their ticket and Courier already did). Use ` +
        `hold_item only when the user asks to put something aside. If Courier gives you an approval link, share it in one ` +
        `line and stop; retry with the approval_id when the user says they answered.`,
    },
  );

  const auth = (extra: { authInfo?: AuthInfo }) => claimsOf(extra.authInfo);

  server.registerTool(
    "whoami",
    {
      title: "Show my visa",
      description:
        "Shows the Courier visa this agent is using: what it may do, its limits, and that a verified human issued it. No personal data is included.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async (_args, extra) => {
      const claims = auth(extra);
      const view = {
        merchant: config.store.name,
        sent_by: { pseudonym: claims.sub, verified_human: claims.human.verified, age_range: claims.human.age_range },
        visa: claims.visa,
        scopes: claims.scope.split(" "),
        token_expires_at: new Date(claims.exp * 1000).toISOString(),
      };
      return text(
        `Visa ${claims.visa.id} for ${config.store.name}, issued by a verified human (${claims.sub}).\n` +
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
      description:
        "Search Juniper Records by keywords (artist, title, genre, format). Optionally filter by max price in USD and category.",
      inputSchema: {
        query: z
          .string()
          .describe("Keywords, e.g. 'jazz vinyl' or 'cleaning kit'. Use an empty string to list everything."),
        max_price: z.number().positive().optional().describe("Maximum price in USD."),
        category: z.enum(["vinyl", "cassette", "cd", "accessory", "merch", "turntable"]).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, max_price, category }, extra) => {
      const claims = auth(extra);
      const limited = await rateLimited(claims);
      if (limited) return limited;
      const denied = requireScope(claims, "store:browse");
      if (denied) return denied;
      const results = searchCatalog(query, max_price ? Math.round(max_price * 100) : undefined, category).slice(0, 8);
      stamp(
        claims.visa.id,
        "browse",
        `Browsed ${config.store.name}`,
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
      const denied = requireScope(claims, "store:browse");
      if (denied) return denied;
      const item = findItem(item_id);
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
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ item_id, approval_id }, extra) => {
      const claims = auth(extra);
      const limited = await rateLimited(claims);
      if (limited) return limited;
      const denied = requireScope(claims, "store:reserve");
      if (denied) return denied;
      const item = findItem(item_id);
      if (!item) return text(`No item with id ${item_id}.`, undefined, true);
      if (item.stock <= 0) return text(`${item.title} is sold out.`, undefined, true);
      const decision = await checkWithPerson(
        server,
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
        "doesn't fit. If the user saved PayPal on their Courier ticket, it's paid straight away and you get a receipt; " +
        "otherwise you get a PayPal link for the user to pay, then call order_status. Call it directly whenever the user " +
        "asks to buy (no need to hold the item first or to confirm with the user).",
      inputSchema: {
        item_ids: z.array(z.string()).min(1).max(10),
        approval_id: z.string().optional().describe("Pass this after the user approved a flagged purchase."),
        note: z.string().max(280).optional().describe("Optional note about why you are buying this."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ item_ids, approval_id, note }, extra) => {
      const claims = auth(extra);
      const limited = await rateLimited(claims);
      if (limited) return limited;
      const denied = requireScope(claims, "store:buy");
      if (denied) return denied;

      const items: Item[] = [];
      for (const id of item_ids) {
        const item = findItem(id);
        if (!item) return text(`No item with id ${id}.`, undefined, true);
        if (item.stock <= 0) return text(`${item.title} is sold out.`, undefined, true);
        items.push(item);
      }
      const totalCents = items.reduce((s, i) => s + i.priceCents, 0);

      const what = `${items.map((i) => i.title).join(", ")} for ${money(totalCents)}`;
      const decision = await checkWithPerson(server, claims, "checkout", items, what, approval_id, note);
      const blocked = decisionText(decision, `a ${money(totalCents)} purchase`);
      if (blocked) return blocked;

      const description = `${config.store.name}: ${items.map((i) => i.title).join(", ")}`;
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
              brandName: config.store.name,
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
            createdAt: new Date().toISOString(),
            paidAt: new Date().toISOString(),
            evidence,
          };
          db.put("orders", paid.id, paid);
          await fulfil(paid);
          return text(
            `Bought ${items.map((i) => i.title).join(", ")} for ${money(totalCents)}, paid with the user's saved PayPal ` +
              `(order ${paid.id}).${remaining ? ` $${remaining} left on this errand.` : ""}`,
            {
              order_id: paid.id,
              status: "paid",
              paid_with: "saved_paypal",
              total: (totalCents / 100).toFixed(2),
              currency: "USD",
              intent_check: decision.intent ?? null,
              remaining_budget: remaining,
            },
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
          brandName: config.store.name,
          items: lines,
        },
        `checkout-${decision.holdId}`,
      );

      const record: Order = {
        id: order.id,
        visaId: claims.visa.id,
        sub: claims.sub,
        agent: claims.visa.agent,
        holdId: decision.holdId!,
        items: items.map((i) => ({ id: i.id, title: i.title, priceCents: i.priceCents, quantity: 1 })),
        totalCents,
        status: "awaiting_approval",
        approveUrl: order.approveUrl!,
        paidWith: "paypal_page",
        createdAt: new Date().toISOString(),
        evidence,
      };
      db.put("orders", record.id, record);

      return text(
        (savedFailed ? "The saved PayPal didn't go through, so the user pays on PayPal instead.\n" : "") +
          `PayPal checkout created for ${money(totalCents)} (${items.map((i) => i.title).join(", ")}).\n` +
          `Ask the user to approve the payment here: ${order.approveUrl}\n` +
          `Then call order_status with order_id="${order.id}".`,
        {
          order_id: order.id,
          approve_url: order.approveUrl,
          total: (totalCents / 100).toFixed(2),
          currency: "USD",
          intent_check: decision.intent ?? null,
          remaining_budget: remaining,
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
    },
    async ({ order_id }, extra) => {
      const claims = auth(extra);
      const order = db.get<Order>("orders", order_id);
      if (!order || order.visaId !== claims.visa.id)
        return text(`No order ${order_id} for this visa.`, undefined, true);
      const settled = order.status === "awaiting_approval" ? await settleOrder(order.id) : order;
      return text(
        settled.status === "paid"
          ? `Paid: ${money(settled.totalCents)} for ${settled.items.map((i) => i.title).join(", ")}.`
          : settled.status === "awaiting_approval"
            ? `Waiting for the user to approve the payment: ${settled.approveUrl}`
            : `Order ${settled.status}.`,
        {
          order_id: settled.id,
          status: settled.status,
          total: (settled.totalCents / 100).toFixed(2),
          items: settled.items.map((i) => ({ id: i.id, title: i.title, price: (i.priceCents / 100).toFixed(2) })),
        },
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
    const item = CATALOG.find((i) => i.id === line.id);
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
    },
  }).catch((e) => console.warn("[store] commit failed", e.message));
}
