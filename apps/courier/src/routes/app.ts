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
import { areFriends, befriend, friendsOf, friendToken, humanByFriendToken, unfriend } from "../friends.ts";
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
  errorPage,
  friendPage,
  homePage,
  peoplePage,
  runInvitePage,
  settingsPage,
  shopsPage,
  signInPage,
  signInStepPage,
  welcomePage,
} from "../pages/index.ts";
import { contactCourier, contactsOf, ideaFor } from "../people.ts";
import {
  answerApproval,
  blankChat,
  callBack,
  changeBudget,
  chatsOfHuman,
  chatTabs,
  chatView,
  chatWithOrder,
  checkOrder,
  deleteChat,
  endChat,
  findChat,
  isWorking,
  joinRun,
  messagesLeft,
  sendMessage,
  setNextBudget,
  spendMessage,
} from "../room.ts";
import { invitesFor, memberOf, runByToken, runFull, runOpen } from "../runs.ts";
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
  const chatByVisa = new Map<string, string>();
  for (const chat of chatsOfHuman(human.id))
    for (const id of chat.errandIds) chatByVisa.set(id, `/errand?c=${chat.courierId}&chat=${chat.id}`);
  return { human, couriers: listCouriers(human.id), visas, stamps, approvals, connections, chatByVisa };
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

appRouter.get("/app/people", (req, res) => {
  const d = requireDesk(req, res);
  if (!d) return;
  const people = contactsOf(d.human).map((contact) => ({
    contact,
    courier: contactCourier(contact),
    idea: ideaFor(contact),
  }));
  res.send(peoplePage(d, people, friendsOf(d.human.id), `${config.courier.url}/friend/${friendToken(d.human)}`));
});

appRouter.post("/app/people/remove", (req, res) => {
  const human = requireHuman(req, res);
  if (!human) return;
  if (typeof req.body.h === "string") unfriend(human.id, req.body.h);
  res.redirect(303, "/app/people");
});

/* ---------------- friends: a link that adds you ---------------- */

function friendBehind(req: express.Request, res: express.Response) {
  const owner = humanByFriendToken(String(req.params.token ?? ""));
  if (!owner)
    res.status(404).send(errorPage(currentHuman(req), "This link doesn't work", "Ask them for their link again."));
  return owner;
}

appRouter.get("/friend/:token", (req, res) => {
  const owner = friendBehind(req, res);
  if (!owner) return;
  const viewer = currentHuman(req);
  if (viewer?.id === owner.id) {
    res.redirect(302, "/app/people");
    return;
  }
  res.send(friendPage(owner, viewer, Boolean(viewer && areFriends(viewer.id, owner.id))));
});

appRouter.post("/friend/:token", (req, res) => {
  const owner = friendBehind(req, res);
  if (!owner) return;
  const viewer = currentHuman(req);
  if (!viewer) {
    res.redirect(303, `/friend/${owner.friendToken}`);
    return;
  }
  befriend(viewer, owner);
  // Someone new still needs a courier before anyone can ask them to an errand.
  res.redirect(303, findCourier(viewer.id) ? "/app/people" : "/start/courier");
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

/* ---------------- runs: errands with other people ---------------- */

/** The run behind a link, or a page saying why it can't be joined. A member is sent straight to their chat. */
function openRun(req: express.Request, res: express.Response) {
  const human = currentHuman(req);
  const run = runByToken(String(req.params.token ?? ""));
  if (!run || !runOpen(run)) {
    res.status(404).send(errorPage(human, "This invite has ended", "Ask whoever sent it for a new link."));
    return null;
  }
  const mine = human && memberOf(run, human.id);
  if (mine) {
    res.redirect(303, `/errand?c=${encodeURIComponent(mine.courierId)}&chat=${encodeURIComponent(mine.chatId)}`);
    return null;
  }
  if (runFull(run)) {
    res.status(409).send(errorPage(human, "This run is full", "Everyone who can join already has."));
    return null;
  }
  return { human, run };
}

const activeCouriers = (human: Human) => listCouriers(human.id).filter((c) => !c.revokedAt);

appRouter.get("/run/:token", (req, res) => {
  const found = openRun(req, res);
  if (found) res.send(runInvitePage(found.run, found.human, found.human ? activeCouriers(found.human) : []));
});

/** Joins with a courier the person has, or makes their first one here, so the link is the whole way in. */
appRouter.post("/run/:token/join", (req, res) => {
  const found = openRun(req, res);
  if (!found) return;
  const { run, human } = found;
  if (!human) {
    res.redirect(303, `/run/${run.token}`);
    return;
  }
  let courier = typeof req.body.c === "string" ? findCourier(human.id, req.body.c) : undefined;
  if (courier?.revokedAt) courier = undefined;
  if (!courier) {
    if (activeCouriers(human).length) {
      res.redirect(303, `/run/${run.token}`);
      return;
    }
    const name = String(req.body.name ?? "").trim();
    const humanName = String(req.body.human ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 24);
    if (!humanName || !isCourierName(name)) {
      const error = !humanName ? "Tell your courier your first name." : `That name won't work. ${COURIER_NAME_HINT}`;
      res.status(400).send(runInvitePage(run, human, [], error));
      return;
    }
    // A person's first courier uses their id, which is how errand sessions find it.
    courier = {
      id: human.id,
      humanId: human.id,
      name,
      color: "tang",
      model: "Claude",
      idNo: courierIdNo(human.id, name, human.id),
      mode: "demo",
      createdAt: new Date().toISOString(),
    };
    saveCourier(courier);
    db.put("humans", human.id, { ...human, displayName: humanName });
  }
  const fresh = db.get<Human>("humans", human.id) ?? human;
  const chat = joinRun(fresh, courier, run);
  res.redirect(303, `/errand?c=${encodeURIComponent(courier.id)}&chat=${encodeURIComponent(chat.id)}`);
});

/* ---------------- the errand room ---------------- */

appRouter.get("/errand/new", (req, res) => {
  res.redirect(302, typeof req.query.c === "string" ? `/errand?c=${encodeURIComponent(req.query.c)}` : "/errand");
});

appRouter.get("/errand", (req, res) => {
  // Coming back from paying at the shop (?order=…, no courier): find the chat that placed that order.
  const human = currentHuman(req);
  const back = human && typeof req.query.order === "string" ? chatWithOrder(human.id, req.query.order) : undefined;
  const ctx = requireCourier(req, res, back?.courierId);
  if (!ctx) return;
  // A message to start from opens in an empty chat, so it begins an errand of its own.
  const draft = q(req.query.say)?.slice(0, 200);
  const chat = back ?? (draft ? undefined : findChat(ctx.courier, req.query.chat)) ?? blankChat(ctx.courier);
  res.send(errandRoom(desk(ctx.human), ctx.courier, chatView(chat), chatTabs(ctx.courier), draft));
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
  return { human, courier };
}

/** As roomFor, for one of the courier's chats. */
function chatFor(req: express.Request, res: express.Response, id: unknown) {
  const ctx = roomFor(req, res);
  if (!ctx) return null;
  const chat = findChat(ctx.courier, id);
  if (!chat) {
    res.status(404).json({ error: "That chat doesn't exist." });
    return null;
  }
  return { ...ctx, chat };
}

const answer = (res: express.Response, ctx: NonNullable<ReturnType<typeof chatFor>>, extra = {}) =>
  res.json({
    ...extra,
    chat: chatView(ctx.chat),
    list: chatTabs(ctx.courier),
    left: messagesLeft(ctx.human),
    invites: invitesFor(ctx.human.id),
  });

api.post("/chats", (req, res) => {
  const ctx = roomFor(req, res);
  if (ctx) res.json({ chat: chatView(blankChat(ctx.courier)) });
});

api.get("/chats/:id", (req, res) => {
  const ctx = chatFor(req, res, req.params.id);
  if (ctx) answer(res, ctx);
});

/** Takes the message and answers straight away. The turn runs on, and the window watches the chat. */
api.post("/chat", (req, res) => {
  const ctx = chatFor(req, res, req.body?.chat);
  if (!ctx) return;
  const message = String(req.body?.message ?? "")
    .trim()
    .slice(0, 500);
  if (!message) {
    res.status(400).json({ error: "Say something first." });
    return;
  }
  if (ctx.chat.endedAt) {
    res.status(409).json({ error: "This errand is over. Start a new one for anything else." });
    return;
  }
  if (!spendMessage(ctx.human)) {
    res.status(429).json({ error: "Your free messages are used up.", left: 0 });
    return;
  }
  sendMessage(ctx.human, ctx.courier, ctx.chat, message);
  answer(res, ctx);
});

/** The budget element in the window: only the person's own click reaches this, never the courier. */
api.post("/budget", (req, res) => {
  const ctx = chatFor(req, res, req.body?.chat);
  if (!ctx) return;
  const dollars = parseBudget(String(req.body?.dollars ?? ""), true)?.dollars ?? 0;
  const problem =
    typeof req.body?.errand === "string"
      ? changeBudget(ctx.human, ctx.chat, req.body.errand, dollars)
      : setNextBudget(ctx.human, ctx.chat, dollars);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  answer(res, ctx);
});

api.post("/callback", async (req, res) => {
  const ctx = chatFor(req, res, req.body?.chat);
  if (!ctx) return;
  const problem = await callBack(ctx.human, ctx.courier, ctx.chat, String(req.body?.order ?? ""));
  if (problem) {
    res.status(409).json({ error: problem });
    return;
  }
  answer(res, ctx);
});

/** The person's own button: the errand closes, anything unpaid is called back, and in a run they leave it. */
api.post("/end", async (req, res) => {
  const ctx = chatFor(req, res, req.body?.chat);
  if (!ctx) return;
  if (isWorking(ctx.chat)) {
    res.status(409).json({ error: `${ctx.courier.name} is still working in that chat.` });
    return;
  }
  await endChat(ctx.human, ctx.courier, ctx.chat);
  answer(res, ctx);
});

api.post("/delete", async (req, res) => {
  const ctx = chatFor(req, res, req.body?.chat);
  if (!ctx) return;
  const problem = await deleteChat(ctx.human, ctx.courier, ctx.chat);
  if (problem) {
    res.status(409).json({ error: problem });
    return;
  }
  res.json({ list: chatTabs(ctx.courier), next: chatTabs(ctx.courier)[0]?.id ?? blankChat(ctx.courier).id });
});

api.post("/approve", (req, res) => {
  const ctx = chatFor(req, res, req.body?.chat);
  if (!ctx) return;
  const approval = db.get<Approval>("approvals", String(req.body?.approvalId ?? ""));
  if (!approval || approval.humanId !== ctx.human.id) {
    res.status(404).json({ error: "That request doesn't exist." });
    return;
  }
  const decided = decideApproval(approval, req.body?.decision === "approved" ? "approved" : "denied");
  answerApproval(ctx.human, ctx.courier, ctx.chat, approval.id, decided.status === "approved");
  answer(res, ctx);
});

api.get("/order/:id", async (req, res) => {
  const ctx = chatFor(req, res, req.query.chat);
  if (!ctx) return;
  try {
    const status = await checkOrder(ctx.human, ctx.courier, ctx.chat, req.params.id);
    if (!status) {
      res.status(404).json({ error: "That order isn't in this chat." });
      return;
    }
    answer(res, ctx, { status });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

appRouter.use("/errand/api", api);
