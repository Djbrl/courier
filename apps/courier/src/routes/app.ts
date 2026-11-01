import { createHash } from "node:crypto";
import {
  ALL_SCOPES,
  COURIER_NAME_HINT,
  config,
  isCourierColor,
  isCourierName,
  randomToken,
  STORE_RESOURCE,
  type Visa,
  type VisaTokenClaims,
} from "@courier/shared";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import express, { Router } from "express";
import { decodeJwt } from "jose";
import { type AgentMemory, freshAccessToken, runAgent, type TokenHolder, tokenRequest, withStore } from "../agent.ts";
import { findAuthRequest } from "../auth/oauth.ts";
import { currentHuman } from "../auth/session.ts";
import {
  type Approval,
  type Connection,
  type Courier,
  courierIdNo,
  db,
  effectiveStatus,
  findCourier,
  type Human,
  listCouriers,
  newCourierId,
  remainingBudget,
  type Stamp,
  saveCourier,
} from "../db.ts";
import {
  claudeSetupPage,
  connectingPage,
  courierSetupPage,
  couriersPage,
  type Desk,
  deleteAccountPage,
  demoClientId,
  errandRoom,
  errandsPage,
  homePage,
  settingsPage,
  signInPage,
  startPage,
} from "../pages/index.ts";
import { decideApproval, revokeVisa, savedPayPal } from "../visas.ts";

/**
 * The first-run experience behind "Try the demo": sign in with PayPal, meet your courier, connect Claude, then run a
 * first errand. The errand uses the real flows end to end: the person's courier is a registered OAuth client of the
 * Courier (PKCE + resource indicator), it gets a visa through the normal consent screen, and it shops through the
 * store's MCP server. Without ANTHROPIC_API_KEY a transparent scripted agent stands in for Claude.
 */

const CALLBACK = `${config.courier.url}/errand/callback`;

/** One errand at a time per courier: its tokens and chat memory. Keyed by courier id. */
interface ErrandSession extends AgentMemory, TokenHolder {
  courierId: string;
  humanId: string;
  visaId?: string;
  pkceVerifier?: string;
  state?: string;
}

function errandSession(courier: Courier): ErrandSession {
  const s = db.get<ErrandSession>("errand_sessions", courier.id);
  return s ? { ...s, courierId: courier.id } : { courierId: courier.id, humanId: courier.humanId, history: [] };
}

function saveErrand(s: ErrandSession): void {
  db.put("errand_sessions", s.courierId, s);
}

/** The errand room's OAuth client for a courier. Its name is the courier's name, so the visa (and the merchant) see "Juno". */
function ensureDemoClient(courier: Courier): string {
  const clientId = demoClientId(courier.id);
  const client: OAuthClientInformationFull = {
    client_id: clientId,
    client_name: courier.name,
    redirect_uris: [CALLBACK],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_id_issued_at: Math.floor(Date.now() / 1000),
  };
  db.put("clients", clientId, client);
  return clientId;
}

function requireHuman(req: express.Request, res: express.Response): Human | null {
  const human = currentHuman(req);
  if (!human) res.redirect(302, "/start");
  return human;
}

export const appRouter = Router();
appRouter.use(express.urlencoded({ extended: false }));

/* ---------------- onboarding ---------------- */

/** The courier named by ?c= (or the person's first), or a redirect to make one. */
function requireCourier(
  req: express.Request,
  res: express.Response,
  courierId?: string,
): { human: Human; courier: Courier } | null {
  const human = requireHuman(req, res);
  if (!human) return null;
  const courier = findCourier(human.id, courierId ?? (typeof req.query.c === "string" ? req.query.c : null));
  if (!courier) {
    res.redirect(302, "/start/courier");
    return null;
  }
  return { human, courier };
}

/** The Claude that's waiting on this courier, when someone made one in the middle of connecting. */
function connectingRequest(value: unknown): string | undefined {
  return typeof value === "string" && findAuthRequest(value) ? value : undefined;
}

appRouter.get("/start", (req, res) => {
  const human = currentHuman(req);
  if (!human) {
    res.send(startPage());
    return;
  }
  res.redirect(302, findCourier(human.id) ? "/app" : "/start/courier");
});

appRouter.get("/start/how", (_req, res) => {
  res.redirect(302, "/start/courier");
});

appRouter.get("/start/courier", (req, res) => {
  const human = requireHuman(req, res);
  if (!human) return;
  const editing = typeof req.query.c === "string" ? findCourier(human.id, req.query.c) : undefined;
  const adding = !editing && req.query.new === "1" && listCouriers(human.id).length > 0;
  const reqId = connectingRequest(req.query.req);
  // First run, already made one: keep going rather than making a second by accident.
  const existing = !editing && !adding ? findCourier(human.id) : undefined;
  if (existing) {
    res.redirect(302, reqId ? `/consent/${reqId}` : `/start/claude?c=${existing.id}&first=1`);
    return;
  }
  res.send(courierSetupPage(human, editing, { adding, reqId }));
});

appRouter.post("/start/courier", (req, res) => {
  const human = requireHuman(req, res);
  if (!human) return;
  const editing = req.body.c ? findCourier(human.id, String(req.body.c)) : undefined;
  const adding = !editing && req.body.new === "1";
  const name = String(req.body.name ?? "").trim();
  const humanName = String(req.body.human ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
  const color = isCourierColor(req.body.color) ? req.body.color : "cobalt";
  const taken = listCouriers(human.id).some((c) => c.id !== editing?.id && c.name.toLowerCase() === name.toLowerCase());
  if (!isCourierName(name) || taken || !humanName) {
    const error = !humanName
      ? "Tell your courier your first name."
      : taken
        ? `You already have a courier called ${name}.`
        : `That name won't work. ${COURIER_NAME_HINT}`;
    res
      .status(400)
      .send(courierSetupPage(human, editing, { adding, error, name, reqId: connectingRequest(req.body.req) }));
    return;
  }
  const firstRun = !editing && !findCourier(human.id);
  // A person's first courier uses their id, which is how errand sessions find it.
  const id = editing?.id ?? (firstRun ? human.id : newCourierId());
  const courier: Courier = {
    ...editing,
    id,
    humanId: human.id,
    name,
    color,
    model: "Claude",
    idNo: courierIdNo(human.id, name, id),
    mode: editing?.mode ?? "demo",
    createdAt: editing?.createdAt ?? new Date().toISOString(),
  };
  saveCourier(courier);
  db.put("humans", human.id, { ...human, displayName: humanName });
  ensureDemoClient(courier);
  const reqId = connectingRequest(req.body.req);
  res.redirect(303, reqId ? `/consent/${reqId}` : editing ? `/app/couriers?c=${id}` : `/start/claude?c=${id}&first=1`);
});

appRouter.get("/start/claude", (req, res) => {
  const ctx = requireCourier(req, res);
  if (!ctx) return;
  if (ctx.courier.mode !== "claude") saveCourier({ ...ctx.courier, mode: "claude" });
  res.send(
    claudeSetupPage(ctx.human, ctx.courier, { onboarding: req.query.first === "1", step: Number(req.query.step) || 1 }),
  );
});

appRouter.get("/start/here", (req, res) => {
  const ctx = requireCourier(req, res);
  if (ctx) res.send(connectingPage(ctx.human, ctx.courier));
});

/* ---------------- the signed-in app ---------------- */

function desk(human: Human): Desk {
  const visas = db
    .list<Visa>("visas", (v) => v.humanId === human.id && v.status !== "pending_bond" && v.status !== "pending_paypal")
    .map((v) => ({ ...v, effective: effectiveStatus(v), remainingCents: remainingBudget(v) }))
    .sort(
      (a, b) =>
        Number(b.effective === "active") - Number(a.effective === "active") || b.createdAt.localeCompare(a.createdAt),
    );
  const stamps = db.list<Stamp>("stamps", (s) => s.humanId === human.id, 500).sort((a, b) => b.at.localeCompare(a.at));
  const approvals = db.list<Approval>("approvals", (a) => a.humanId === human.id && a.status === "pending");
  const connections = db.list<Connection>("connections", (c) => c.humanId === human.id && c.status === "active");
  return { human, couriers: listCouriers(human.id), visas, stamps, approvals, connections };
}

/** The app needs a courier; people who signed in without one finish onboarding first. */
function requireDesk(req: express.Request, res: express.Response): Desk | null {
  const human = currentHuman(req);
  if (!human) {
    res.send(signInPage());
    return null;
  }
  const d = desk(human);
  if (!d.couriers.length) {
    res.redirect(302, "/start/courier");
    return null;
  }
  return d;
}

const q = (v: unknown) => (typeof v === "string" ? v : undefined);

appRouter.get("/app", (req, res) => {
  const d = requireDesk(req, res);
  if (d) res.send(homePage(d, { welcome: req.query.welcome === "1", courierId: q(req.query.c) }));
});

appRouter.get("/app/account/delete", (req, res) => {
  const d = requireDesk(req, res);
  if (d) res.send(deleteAccountPage(d));
});

appRouter.get("/app/errands", (req, res) => {
  const d = requireDesk(req, res);
  if (d) res.send(errandsPage(d, { tab: q(req.query.tab), errandId: q(req.query.e) }));
});

appRouter.get("/app/couriers", (req, res) => {
  const d = requireDesk(req, res);
  if (d) res.send(couriersPage(d, { courierId: q(req.query.c) }));
});

appRouter.get("/app/settings", (req, res) => {
  const d = requireDesk(req, res);
  if (d) res.send(settingsPage(d, savedPayPal(d.human.id)?.email));
});

appRouter.get("/app/connections", (_req, res) => {
  res.redirect(302, "/app/settings");
});

/** Live status for the connector walkthrough (and anything else that wants to poll). */
appRouter.get("/app/api/status", (req, res) => {
  const human = currentHuman(req);
  if (!human) {
    res.status(401).json({ error: "Sign in first." });
    return;
  }
  const d = desk(human);
  res.json({
    couriers: d.couriers.map((c) => ({
      id: c.id,
      name: c.name,
      claude: Boolean(c.clientId),
      clientName: c.clientName ?? null,
    })),
    errandsOut: d.visas.filter((v) => v.effective === "active").length,
    approvals: d.approvals.length,
    errandRoom: config.anthropicConfigured ? "claude" : "demo",
  });
});

/* ---------------- an errand: OAuth as the courier ---------------- */

appRouter.get("/errand/new", (req, res) => {
  const ctx = requireCourier(req, res);
  if (!ctx) return;
  const clientId = ensureDemoClient(ctx.courier);
  const s = errandSession(ctx.courier);
  s.pkceVerifier = randomToken(48);
  s.state = `${ctx.courier.id}.${randomToken(16)}`;
  saveErrand(s);
  const url = new URL(`${config.courier.url}/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", CALLBACK);
  url.searchParams.set("code_challenge", createHash("sha256").update(s.pkceVerifier).digest("base64url"));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("scope", ALL_SCOPES.join(" "));
  url.searchParams.set("state", s.state);
  url.searchParams.set("resource", STORE_RESOURCE);
  res.redirect(302, url.toString());
});

appRouter.get("/errand/callback", async (req, res) => {
  const human = requireHuman(req, res);
  if (!human) return;
  const state = String(req.query.state ?? "");
  const courier = findCourier(human.id, state.slice(0, state.lastIndexOf(".")));
  if (!courier || req.query.error) {
    res.redirect(302, "/app");
    return;
  }
  const s = errandSession(courier);
  if (!s.state || state !== s.state || req.query.iss !== config.courier.url || !s.pkceVerifier) {
    res.redirect(302, "/app");
    return;
  }
  try {
    const t = await tokenRequest({
      grant_type: "authorization_code",
      code: String(req.query.code),
      redirect_uri: CALLBACK,
      client_id: demoClientId(courier.id),
      code_verifier: s.pkceVerifier,
      resource: STORE_RESOURCE,
    });
    const claims = decodeJwt(t.access_token!) as unknown as VisaTokenClaims;
    // One errand at a time per courier: its previous errand ends when a new one starts.
    const previous = s.visaId && s.visaId !== claims.visa.id ? db.get<Visa>("visas", s.visaId) : undefined;
    if (previous && effectiveStatus(previous) === "active") await revokeVisa(previous.id, "Replaced by a new errand");
    Object.assign(s, {
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000,
      visaId: claims.visa.id,
      history: [],
      lastOrderId: undefined,
      pendingApproval: undefined,
      state: undefined,
      pkceVerifier: undefined,
    });
    saveErrand(s);
    res.redirect(302, `/errand?c=${courier.id}`);
  } catch (error) {
    console.error("[errand] token exchange failed", error);
    res.redirect(302, "/app");
  }
});

/* ---------------- the errand room ---------------- */

function activeVisa(s: ErrandSession): Visa | null {
  const visa = s.visaId ? db.get<Visa>("visas", s.visaId) : undefined;
  return visa && effectiveStatus(visa) === "active" ? visa : null;
}

appRouter.get("/errand", (req, res) => {
  // Coming back from paying at the shop (?order=…, no courier): find the courier that placed that order.
  const human = currentHuman(req);
  const order = req.query.order;
  const owner =
    human && !req.query.c && typeof order === "string"
      ? listCouriers(human.id).find((c) => errandSession(c).lastOrderId === order)
      : undefined;
  const ctx = requireCourier(req, res, owner?.id);
  if (!ctx) return;
  const s = errandSession(ctx.courier);
  const visa = activeVisa(s);
  if (!visa || !s.accessToken) {
    res.redirect(302, `/app?c=${ctx.courier.id}`);
    return;
  }
  res.send(errandRoom(desk(ctx.human), visa, ctx.courier));
});

const api = Router();
api.use(express.json());

/** The signed-in person's errand, with a usable token, or a JSON error. */
async function errandFor(req: express.Request, res: express.Response) {
  const human = currentHuman(req);
  if (!human) {
    res.status(401).json({ error: "Sign in first." });
    return null;
  }
  const courier = findCourier(human.id, q(req.query.c));
  if (!courier) {
    res.status(404).json({ error: "That courier doesn't exist." });
    return null;
  }
  const s = errandSession(courier);
  const visa = activeVisa(s);
  const token = visa ? await freshAccessToken(s, demoClientId(courier.id), () => saveErrand(s)) : null;
  if (!visa || !token) {
    res.status(409).json({ error: "This errand has ended. Start a new one from your Courier home.", ended: true });
    return null;
  }
  return { human, s, visa, token, courier };
}

function visaState(visa: Visa) {
  const fresh = db.get<Visa>("visas", visa.id) ?? visa;
  return {
    status: effectiveStatus(fresh),
    spentCents: fresh.spentCents,
    spendLimitCents: fresh.spendLimitCents,
    remainingCents: remainingBudget(fresh),
  };
}

async function chat(ctx: NonNullable<Awaited<ReturnType<typeof errandFor>>>, message: string) {
  const name = ctx.courier.name;
  return withStore(
    ctx.token,
    (client) => runAgent(ctx.s, client, message, () => saveErrand(ctx.s), name),
    `Courier: ${name}`,
  );
}

api.get("/state", async (req, res) => {
  const ctx = await errandFor(req, res);
  if (ctx) res.json({ visa: visaState(ctx.visa), pendingApproval: ctx.s.pendingApproval?.approvalId ?? null });
});

api.post("/chat", async (req, res) => {
  const ctx = await errandFor(req, res);
  if (!ctx) return;
  const message = String(req.body?.message ?? "")
    .trim()
    .slice(0, 500);
  if (!message) {
    res.status(400).json({ error: "Say something first." });
    return;
  }
  try {
    const out = await chat(ctx, message);
    res.json({ ...out, visa: visaState(ctx.visa) });
  } catch (error) {
    const refused = error instanceof StreamableHTTPError && error.code === 401;
    res.status(refused ? 409 : 500).json({
      error: refused ? "The shop refused the ID. The errand may have been called back." : (error as Error).message,
      ended: refused,
    });
  }
});

api.post("/approve", async (req, res) => {
  const ctx = await errandFor(req, res);
  if (!ctx) return;
  const approval = db.get<Approval>("approvals", String(req.body?.approvalId ?? ""));
  if (!approval || approval.humanId !== ctx.human.id || approval.visaId !== ctx.visa.id) {
    res.status(404).json({ error: "That request doesn't exist." });
    return;
  }
  const decided = decideApproval(approval, req.body?.decision === "approved" ? "approved" : "denied");
  if (decided.status !== "approved") {
    ctx.s.pendingApproval = undefined;
    saveErrand(ctx.s);
    res.json({ steps: [], reply: "OK, I'll leave it.", decision: decided.status, visa: visaState(ctx.visa) });
    return;
  }
  try {
    const out =
      ctx.s.pendingApproval?.approvalId === approval.id
        ? await chat(ctx, "go ahead")
        : { steps: [], reply: "Thanks, noted." };
    res.json({ ...out, decision: decided.status, visa: visaState(ctx.visa) });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

api.get("/order/:id", async (req, res) => {
  const ctx = await errandFor(req, res);
  if (!ctx) return;
  try {
    const result: any = await withStore(
      ctx.token,
      (client) => client.callTool({ name: "order_status", arguments: { order_id: req.params.id } }),
      `Courier: ${ctx.courier.name}`,
    );
    res.json({ ...(result.structuredContent ?? {}), visa: visaState(ctx.visa) });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

appRouter.use("/errand/api", api);
