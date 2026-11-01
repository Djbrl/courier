import { randomUUID } from "node:crypto";
import path from "node:path";
import { config, internalFetch, paypal, ROOT_DIR } from "@courier/shared";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import {
  claimsOf,
  forgetVisa,
  logRequest,
  ownerId,
  PRM_PATH,
  protectedResourceMetadata,
  type RequestLogEntry,
  requireVisa,
} from "./auth.ts";
import { CATALOG } from "./catalog.ts";
import { db, type Order } from "./db.ts";
import { createMcpServer, settleOrder } from "./mcp.ts";
import { merchantDashboard, paymentResult, receiptPage, storefront } from "./views.ts";

const app = express();
app.set("trust proxy", "loopback");
app.disable("x-powered-by");

app.use(
  "/assets",
  express.static(path.join(ROOT_DIR, "packages/shared/assets"), {
    maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
  }),
);

/* ---------------- OAuth Protected Resource Metadata (RFC 9728) ---------------- */

const sendPrm = (_req: express.Request, res: express.Response) => {
  res.set("Access-Control-Allow-Origin", "*").json(protectedResourceMetadata);
};
app.get(PRM_PATH, sendPrm);
app.get("/.well-known/oauth-protected-resource", sendPrm);

/* ---------------- MCP endpoint ---------------- */

app.use("/mcp", (req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, X-Demo-Source",
  );
  res.set("Access-Control-Expose-Headers", "WWW-Authenticate, Mcp-Session-Id");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

/**
 * Sessions let the shop talk back mid-call: when Courier needs the person's OK, the tool asks them in their chat app
 * (an MCP elicitation), which needs a session and a streamed response. A client that initializes gets a session bound
 * to its connection or visa; anything else (raw one-off calls) is served statelessly.
 */
interface McpSession {
  transport: StreamableHTTPServerTransport;
  owner: string;
  lastSeen: number;
}
const sessions = new Map<string, McpSession>();
const SESSION_IDLE_MS = 30 * 60 * 1000;

setInterval(() => {
  for (const [id, sess] of sessions)
    if (Date.now() - sess.lastSeen > SESSION_IDLE_MS) void sess.transport.close().finally(() => sessions.delete(id));
}, 60_000).unref();

const ownerOf = (req: express.Request) => ownerId(claimsOf((req as express.Request & { auth?: AuthInfo }).auth));

/** The session this request belongs to, if it names one this caller owns. Replies with an error otherwise. */
function ownSession(req: express.Request, res: express.Response): McpSession | null {
  const sess = sessions.get(String(req.headers["mcp-session-id"]));
  if (!sess || sess.owner !== ownerOf(req)) {
    res.status(404).json({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null });
    return null;
  }
  sess.lastSeen = Date.now();
  return sess;
}

async function serve(
  transport: StreamableHTTPServerTransport,
  req: express.Request,
  res: express.Response,
  body?: unknown,
) {
  try {
    await transport.handleRequest(req, res, body);
  } catch (error) {
    console.error("[mcp] error", error);
    if (!res.headersSent)
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
  }
}

app.post("/mcp", express.json({ limit: "1mb" }), requireVisa, async (req, res) => {
  if (req.headers["mcp-session-id"]) {
    const sess = ownSession(req, res);
    if (sess) await serve(sess.transport, req, res, req.body);
    return;
  }
  const server = createMcpServer();
  if (isInitializeRequest(req.body)) {
    const owner = ownerOf(req);
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => void sessions.set(id, { transport, owner, lastSeen: Date.now() }),
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
      void server.close();
    };
    await server.connect(transport);
    await serve(transport, req, res, req.body);
    return;
  }
  // Stateless: a fresh server and transport for this one request.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await serve(transport, req, res, req.body);
});

// The session's own stream (GET) and its end (DELETE).
app.get("/mcp", requireVisa, async (req, res) => {
  const sess = ownSession(req, res);
  if (sess) await serve(sess.transport, req, res);
});
app.delete("/mcp", requireVisa, async (req, res) => {
  const sess = ownSession(req, res);
  if (sess) await serve(sess.transport, req, res);
});

/* ---------------- human-facing shop ---------------- */

app.get("/", (req, res) => {
  res.send(storefront(CATALOG, typeof req.query.c === "string" ? req.query.c : ""));
});

/** The public shelf, as humans see it (the Courier errand room renders its shop front from this). */
app.get("/catalog.json", (_req, res) => {
  res.set("Access-Control-Allow-Origin", "*").json({
    store: config.store.name,
    items: CATALOG.map((i) => ({
      id: i.id,
      title: i.title,
      artist: i.artist,
      category: i.category,
      genre: i.genre,
      priceCents: i.priceCents,
      stock: i.stock,
      blurb: i.blurb,
      hue: i.hue,
    })),
  });
});

app.get("/merchant", (_req, res) => {
  const orders = db.list<Order>("orders").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const requests = db.list<RequestLogEntry>("requests", undefined, 300).sort((a, b) => b.at.localeCompare(a.at));
  res.send(merchantDashboard(orders, requests));
});

app.post("/merchant/report/:visaId", express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const result = await internalFetch<{ bondOutcome: string }>(`${config.courier.url}/internal/report`, {
      body: {
        visaId: req.params.visaId,
        reason: "Reported by the merchant from the dashboard",
        evidence: { via: "merchant dashboard" },
      },
    });
    forgetVisa(req.params.visaId);
    logRequest({
      outcome: "blocked",
      reason: `Merchant reported visa · ${result.bondOutcome}`,
      status: 403,
      visaId: req.params.visaId,
    });
  } catch (error) {
    console.warn("[store] report failed", (error as Error).message);
  }
  res.redirect(303, "/merchant");
});

/** A receipt the person can open from their chat. The key is the only credential, and it shows no personal data. */
app.get("/receipts/:key", async (req, res) => {
  const found = db.list<Order>("orders", (o) => o.receiptKey === req.params.key, 1)[0];
  res.set("X-Robots-Tag", "noindex").set("Referrer-Policy", "no-referrer");
  if (!found) {
    res.status(404).send(receiptPage(undefined));
    return;
  }
  const order = found.status === "awaiting_approval" ? await settleOrder(found.id).catch(() => found) : found;
  res.send(receiptPage(order));
});

/* ---------------- PayPal return / cancel / webhooks ---------------- */

app.get("/paypal/return", async (req, res) => {
  const orderId = String(req.query.token ?? "");
  try {
    const order = await settleOrder(orderId);
    res.send(
      paymentResult(
        order,
        order.status === "paid",
        order.status === "paid"
          ? "Your courier's purchase is paid, and it's in your Courier home."
          : `The order is ${order.status}.`,
      ),
    );
  } catch (error) {
    console.error("[store] settle failed", error);
    res
      .status(400)
      .send(paymentResult(db.get<Order>("orders", orderId), false, "We couldn't confirm this payment with PayPal."));
  }
});

app.get("/paypal/cancel", async (req, res) => {
  const orderId = String(req.query.token ?? "");
  const order = db.get<Order>("orders", orderId);
  if (order && order.status === "awaiting_approval") {
    db.put("orders", order.id, { ...order, status: "cancelled" });
    await internalFetch(`${config.courier.url}/internal/spend/release`, { body: { holdId: order.holdId } }).catch(
      () => {},
    );
  }
  res.send(
    paymentResult(order, false, "You cancelled the payment. Nothing was charged, and your errand's budget is back."),
  );
});

app.post("/webhooks/paypal", express.json({ limit: "1mb" }), async (req, res) => {
  const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const valid = await paypal.verifyWebhook(headers, req.body).catch(() => false);
  if (!valid) {
    res.status(400).json({ error: "invalid signature" });
    return;
  }
  const event = req.body as { event_type: string; resource: any };
  // Handlers are idempotent: PayPal may deliver an event more than once.
  try {
    if (event.event_type === "CHECKOUT.ORDER.APPROVED") {
      await settleOrder(event.resource.id);
    } else if (event.event_type === "CUSTOMER.DISPUTE.CREATED") {
      const customId = event.resource?.disputed_transactions?.[0]?.custom;
      const order = db.list<Order>("orders", (o) => o.visaId === customId)[0];
      if (order) db.put("orders", order.id, { ...order, disputed: true });
    }
  } catch (error) {
    console.warn("[webhook] handler failed", (error as Error).message);
  }
  res.json({ ok: true });
});

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, paypal: paypal.mode });
});

app.listen(config.store.port, () => {
  console.log(`${config.store.name} → ${config.store.url}  (MCP: ${config.store.url}/mcp)`);
});
