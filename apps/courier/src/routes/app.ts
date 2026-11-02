import { COURIER_NAME_HINT, config, isCourierColor, isCourierName, parseBudget, type Visa } from "@courier/shared";
import express, { Router } from "express";
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
  DEMO_CLIENT_PREFIX,
  type Desk,
  deleteAccountPage,
  errandRoom,
  errandsPage,
  homePage,
  settingsPage,
  shopsPage,
  signInPage,
  signInStepPage,
  welcomePage,
} from "../pages/index.ts";
import {
  changeBudget,
  endErrand,
  orderStatus,
  roomSession,
  roomState,
  roomTurn,
  saveRoom,
  setNextBudget,
} from "../room.ts";
import { decideApproval, parseCap, savedPayPal } from "../visas.ts";

/**
 * The first-run experience behind "Try the demo": a welcome, sign in, meet your courier, optionally connect Claude, then
 * the dashboard and the errand room, where the courier takes errands in a running chat.
 */

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
    res.send(welcomePage());
    return;
  }
  res.redirect(302, findCourier(human.id) ? "/app" : "/start/courier");
});

appRouter.get("/start/sign-in", (req, res) => {
  const human = currentHuman(req);
  if (!human) {
    res.send(signInStepPage());
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
  const reqId = connectingRequest(req.body.req);
  res.redirect(
    303,
    reqId
      ? `/consent/${reqId}`
      : editing
        ? `/app/couriers?c=${id}`
        : `/start/claude?c=${id}${firstRun ? "&first=1" : ""}`,
  );
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
  const connections = db.list<Connection>(
    "connections",
    (c) => c.humanId === human.id && c.status === "active" && !c.clientId.startsWith(DEMO_CLIENT_PREFIX),
  );
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
  if (!d) return;
  // The tour runs once, on the first visit, and is marked here so a reload doesn't start it again.
  const tour = !d.human.touredAt;
  if (tour) db.put<Human>("humans", d.human.id, { ...d.human, touredAt: new Date().toISOString() });
  res.send(homePage(d, { welcome: req.query.welcome === "1", courierId: q(req.query.c), tour }));
});

appRouter.get("/app/account/delete", (req, res) => {
  const d = requireDesk(req, res);
  if (d) res.send(deleteAccountPage(d));
});

appRouter.get("/app/errands", (req, res) => {
  const d = requireDesk(req, res);
  if (d) res.send(errandsPage(d, { tab: q(req.query.tab), errandId: q(req.query.e) }));
});

appRouter.get("/app/shops", (req, res) => {
  const d = requireDesk(req, res);
  if (d) res.send(shopsPage(d));
});

appRouter.get("/app/couriers", (req, res) => {
  const d = requireDesk(req, res);
  if (d) res.send(couriersPage(d, { courierId: q(req.query.c) }));
});

appRouter.get("/app/settings", (req, res) => {
  const d = requireDesk(req, res);
  if (d) res.send(settingsPage(d, savedPayPal(d.human.id)?.email));
});

appRouter.post("/app/settings/cap", (req, res) => {
  const d = requireDesk(req, res);
  if (!d) return;
  db.put("humans", d.human.id, { ...d.human, cap: parseCap(req.body.cap_errand, req.body.cap_day) });
  res.redirect(303, "/app/settings");
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
      claude: Boolean(c.clientId) || d.connections.length > 0,
      clientName: c.clientName ?? null,
    })),
    errandsOut: d.visas.filter((v) => v.effective === "active").length,
    approvals: d.approvals.length,
    errandRoom: config.anthropicConfigured ? "claude" : "demo",
  });
});

/* ---------------- the errand room ---------------- */

appRouter.get("/errand/new", (req, res) => {
  res.redirect(302, typeof req.query.c === "string" ? `/errand?c=${encodeURIComponent(req.query.c)}` : "/errand");
});

appRouter.get("/errand", (req, res) => {
  // Coming back from paying at the shop (?order=…, no courier): find the courier that placed that order.
  const human = currentHuman(req);
  const order = req.query.order;
  const owner =
    human && !req.query.c && typeof order === "string"
      ? listCouriers(human.id).find((c) => roomSession(c).lastOrderId === order)
      : undefined;
  const ctx = requireCourier(req, res, owner?.id);
  if (ctx) res.send(errandRoom(desk(ctx.human), ctx.courier, roomState(roomSession(ctx.courier), ctx.courier)));
});

const api = Router();
api.use(express.json());

/** The signed-in person and the courier they're talking to, or a JSON error. */
function roomFor(req: express.Request, res: express.Response) {
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
  return { human, courier, s: roomSession(courier) };
}

api.get("/state", (req, res) => {
  const ctx = roomFor(req, res);
  if (ctx) res.json({ state: roomState(ctx.s, ctx.courier) });
});

/** Answers line by line: each step as it happens, then the courier's reply. */
async function streamTurn(
  res: express.Response,
  ctx: NonNullable<ReturnType<typeof roomFor>>,
  message: string,
): Promise<void> {
  res.set("Content-Type", "application/x-ndjson").set("Cache-Control", "no-store");
  const line = (value: unknown) => res.write(`${JSON.stringify(value)}\n`);
  try {
    const out = await roomTurn(ctx.human, ctx.courier, ctx.s, message, (step) => line({ step }));
    line({ ...out, state: roomState(ctx.s, ctx.courier) });
  } catch (error) {
    console.error("[errand] turn failed", error);
    line({ error: "That didn’t work. Try asking again.", state: roomState(ctx.s, ctx.courier) });
  }
  res.end();
}

api.post("/chat", async (req, res) => {
  const ctx = roomFor(req, res);
  if (!ctx) return;
  const message = String(req.body?.message ?? "")
    .trim()
    .slice(0, 500);
  if (!message) {
    res.status(400).json({ error: "Say something first." });
    return;
  }
  await streamTurn(res, ctx, message);
});

/** The budget element in the window: only the person's own click reaches this, never the courier. */
api.post("/budget", (req, res) => {
  const ctx = roomFor(req, res);
  if (!ctx) return;
  const dollars = parseBudget(String(req.body?.dollars ?? ""), true)?.dollars ?? 0;
  const problem =
    typeof req.body?.errand === "string"
      ? changeBudget(ctx.courier, req.body.errand, dollars)
      : setNextBudget(ctx.s, dollars);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  res.json({ state: roomState(ctx.s, ctx.courier) });
});

api.post("/end", async (req, res) => {
  const ctx = roomFor(req, res);
  if (!ctx) return;
  await endErrand(ctx.courier, String(req.body?.errand ?? ""));
  res.json({ state: roomState(ctx.s, ctx.courier) });
});

/** A clean chat. Errands that are out stay out, and stay in the window. */
api.post("/reset", (req, res) => {
  const ctx = roomFor(req, res);
  if (!ctx) return;
  saveRoom({ courierId: ctx.courier.id, humanId: ctx.human.id, history: [] });
  res.json({ ok: true });
});

api.post("/approve", async (req, res) => {
  const ctx = roomFor(req, res);
  if (!ctx) return;
  const approval = db.get<Approval>("approvals", String(req.body?.approvalId ?? ""));
  if (!approval || approval.humanId !== ctx.human.id) {
    res.status(404).json({ error: "That request doesn't exist." });
    return;
  }
  const decided = decideApproval(approval, req.body?.decision === "approved" ? "approved" : "denied");
  if (decided.status !== "approved") {
    ctx.s.pendingApproval = undefined;
    saveRoom(ctx.s);
    res.set("Content-Type", "application/x-ndjson");
    res.end(`${JSON.stringify({ steps: [], reply: "OK, I'll leave it.", state: roomState(ctx.s, ctx.courier) })}\n`);
    return;
  }
  await streamTurn(res, ctx, "go ahead");
});

api.get("/order/:id", async (req, res) => {
  const ctx = roomFor(req, res);
  if (!ctx) return;
  try {
    const order = await orderStatus(ctx.human, ctx.courier, String(req.query.shop ?? ""), req.params.id);
    if (!order) {
      res.status(404).json({ error: "That shop doesn't exist." });
      return;
    }
    res.json({ ...order.data, state: roomState(ctx.s, ctx.courier) });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

appRouter.use("/errand/api", api);
