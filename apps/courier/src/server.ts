import path from "node:path";
import {
  ALL_SCOPES,
  config,
  DURATIONS,
  type DurationKey,
  isScope,
  newId,
  paypal,
  ROOT_DIR,
  randomToken,
  type Scope,
  type Visa,
} from "@courier/shared";
import { createOAuthMetadata, mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import express from "express";
import { jwks } from "./auth/keys.ts";
import { CourierOAuthProvider, clientRedirect, findAuthRequest, issueAuthorizationCode } from "./auth/oauth.ts";
import { currentHuman, endSession, startSession } from "./auth/session.ts";
import {
  type Approval,
  type AuthRequest,
  type Connection,
  db,
  findCourier,
  findMerchant,
  type Human,
  isMinor,
  listCouriers,
  type SavedPayPalRecord,
  saveCourier,
} from "./db.ts";
import {
  accountDeletedPage,
  approvalPage,
  connectConsentPage,
  connectPage,
  consentPage,
  courierChoice,
  courierForClient,
  DEMO_CLIENT_PREFIX,
  developersPage,
  errorPage,
  landingPage,
  refusalPage,
  signInPage,
  ticketDeclinedPage,
  ticketReadyPage,
} from "./pages/index.ts";
import { simPaypalRouter } from "./paypal-simulator.ts";
import { appRouter } from "./routes/app.ts";
import { botsRouter } from "./routes/bots.ts";
import {
  addStamp,
  decideApproval,
  deleteAccount,
  disconnect,
  endEarlierErrands,
  internalRouter,
  issuedStamps,
  migrateSavedPayPal,
  removeSavedPayPal,
  revokeVisa,
  savedPayPal,
  sweepExpiredVisas,
} from "./visas.ts";

const app = express();
app.set("trust proxy", "loopback");
app.disable("x-powered-by");

const issuerUrl = new URL(config.courier.url);
const provider = new CourierOAuthProvider();

app.use(
  "/assets",
  express.static(path.join(ROOT_DIR, "packages/shared/assets"), {
    maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
  }),
);

/* ---------------- OAuth 2.1 authorization server ---------------- */

const metadata = {
  ...createOAuthMetadata({
    provider,
    issuerUrl,
    scopesSupported: [...ALL_SCOPES],
    serviceDocumentationUrl: new URL("/developers", issuerUrl),
  }),
  // RFC 8414: the issuer must exactly match the identifier clients use (no trailing slash), and the `iss` we send.
  issuer: config.courier.url,
  jwks_uri: new URL("/jwks.json", issuerUrl).href,
  authorization_response_iss_parameter_supported: true,
  client_id_metadata_document_supported: true,
};

app.get("/.well-known/oauth-authorization-server", (_req, res) => {
  res.set("Access-Control-Allow-Origin", "*").json(metadata);
});
app.get("/jwks.json", async (_req, res) => {
  res
    .set("Access-Control-Allow-Origin", "*")
    .set("Cache-Control", "public, max-age=300")
    .json(await jwks());
});

app.use(
  mcpAuthRouter({
    provider,
    issuerUrl,
    scopesSupported: [...ALL_SCOPES],
    serviceDocumentationUrl: new URL("/developers", issuerUrl),
    clientRegistrationOptions: { clientSecretExpirySeconds: 0 },
  }),
);

/* ---------------- Simulated PayPal (only without credentials) ---------------- */

if (paypal.mode === "simulated") {
  app.use("/sim-paypal", simPaypalRouter(config.courier.url));
}

/* ---------------- internal API for merchants ---------------- */

app.use("/internal", express.json(), internalRouter);

/* ---------------- pages ---------------- */

app.use(express.urlencoded({ extended: false }));

app.get("/", (req, res) => {
  res.send(landingPage(currentHuman(req)));
});

app.get("/developers", (req, res) => {
  res.send(developersPage(currentHuman(req)));
});

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, paypal: paypal.mode, intentModel: config.intent.model });
});

app.get("/connect/:id", (req, res) => {
  const request = findAuthRequest(req.params.id);
  if (!request) {
    res.status(400).send(errorPage(currentHuman(req), "This link has expired", "Ask your agent to connect again."));
    return;
  }
  const merchant = findMerchant(request.resource)!;
  const human = currentHuman(req);
  // Already signed in: PayPal has nothing to add, so go straight to the question.
  if (human) {
    res.redirect(302, `/consent/${request.id}`);
    return;
  }
  res.send(connectPage(request, merchant));
});

/* ---------- Log in with PayPal ---------- */

const PAYPAL_CALLBACK = `${config.courier.url}/auth/paypal/callback`;

app.get("/auth/paypal/start", (req, res) => {
  const reqId = typeof req.query.req === "string" ? req.query.req : undefined;
  if (reqId && !findAuthRequest(reqId)) {
    res.status(400).send(errorPage(null, "This link has expired", "Ask your agent to connect again."));
    return;
  }
  // Where to land after sign-in (onboarding uses this); same-site paths only.
  const next =
    typeof req.query.next === "string" && /^\/(?!\/)[\w\-/?=&.]*$/.test(req.query.next) ? req.query.next : null;
  const state = randomToken(18);
  db.put("paypal_states", state, { state, reqId: reqId ?? null, next, expiresAt: Date.now() + 15 * 60 * 1000 });
  res.redirect(302, paypal.loginUrl({ redirectUri: PAYPAL_CALLBACK, state }));
});

app.get("/auth/paypal/callback", async (req, res) => {
  const state = String(req.query.state ?? "");
  const code = String(req.query.code ?? "");
  const saved = db.get<{ reqId: string | null; next?: string | null; expiresAt: number }>("paypal_states", state);
  if (!saved || saved.expiresAt < Date.now() || !code) {
    res.status(400).send(errorPage(null, "Sign-in expired", "Please start again from your agent."));
    return;
  }
  db.delete("paypal_states", state);

  let identity: Awaited<ReturnType<typeof paypal.exchangeLoginCode>>;
  try {
    identity = await paypal.exchangeLoginCode(code, PAYPAL_CALLBACK);
  } catch (error) {
    console.error("[paypal] login failed", error);
    res
      .status(502)
      .send(errorPage(null, "PayPal sign-in failed", "PayPal didn't confirm the sign-in. Please try again."));
    return;
  }

  // One account per PayPal account.
  const existing = db.list<Human>("humans", (h) => h.payerId === identity.payerId, 1)[0];
  const now = new Date().toISOString();
  const human: Human = existing
    ? {
        ...existing,
        verified: identity.verified,
        ageRange: identity.ageRange,
        accountType: identity.accountType,
        displayName: existing.displayName ?? identity.name ?? null,
        lastLoginAt: now,
      }
    : (() => {
        const id = newId("hum");
        return {
          id,
          payerId: identity.payerId,
          verified: identity.verified,
          ageRange: identity.ageRange,
          accountType: identity.accountType,
          displayName: identity.name ?? null,
          createdAt: now,
          lastLoginAt: now,
        };
      })();
  db.put("humans", human.id, human);

  const request = saved.reqId ? findAuthRequest(saved.reqId) : null;

  if (!human.verified) {
    res.send(
      refusalPage(
        null,
        "This PayPal account isn't verified",
        "Couriers only work for verified PayPal accounts, so shops can trust there's a real person behind every agent. Verify your account with PayPal, then try again.",
        request ?? undefined,
      ),
    );
    return;
  }
  if (isMinor(human.ageRange)) {
    res.send(
      refusalPage(
        null,
        "Courier is for adults",
        "Couriers can spend money, so you need to be 18 or older. Nothing about you was shared with the shop.",
        request ?? undefined,
      ),
    );
    return;
  }

  startSession(res, human.id);
  res.redirect(302, request ? `/consent/${request.id}` : (saved.next ?? "/app"));
});

app.get("/logout", (_req, res) => {
  endSession(res);
  res.redirect(302, "/");
});

/* ---------- consent: connect a Claude, or issue a visa ---------- */

/** An outside client asking to connect, as opposed to the errand room or a ticket on an existing connection. */
const isConnectRequest = (request: AuthRequest) => !request.ticket && !request.clientId.startsWith(DEMO_CLIENT_PREFIX);

function newConnection(fields: Omit<Connection, "id">): Connection {
  const id = newId("conn");
  return db.put<Connection>("connections", id, { id, ...fields });
}

/** A ticket can only be written by the person whose Claude asked for it. */
const wrongPerson = (request: AuthRequest, human: Human) =>
  Boolean(request.ticket && request.ticket.humanId !== human.id);

app.get("/consent/:id", (req, res) => {
  const human = currentHuman(req);
  const request = findAuthRequest(req.params.id);
  if (!request || request.completed) {
    res.status(400).send(errorPage(human, "This link has expired", "Ask your agent to connect again."));
    return;
  }
  if (!human) {
    res.redirect(302, `/connect/${request.id}`);
    return;
  }
  if (wrongPerson(request, human)) {
    res
      .status(403)
      .send(
        errorPage(
          human,
          "This ticket is for someone else",
          "Sign in with the PayPal account that connected this Claude.",
        ),
      );
    return;
  }
  if (isConnectRequest(request)) {
    if (listCouriers(human.id).length) res.send(connectConsentPage(request, human));
    else res.redirect(302, `/start/courier?req=${request.id}`);
    return;
  }
  res.send(consentPage(request, findMerchant(request.resource)!, human, undefined, req.query.pay === "1"));
});

app.post("/consent/:id", async (req, res) => {
  const human = currentHuman(req);
  const request = findAuthRequest(req.params.id);
  if (!request || request.completed) {
    res.status(400).send(errorPage(human, "This link has expired", "Ask your agent to connect again."));
    return;
  }
  if (!human) {
    res.redirect(302, `/connect/${request.id}`);
    return;
  }
  if (wrongPerson(request, human)) {
    res
      .status(403)
      .send(
        errorPage(
          human,
          "This ticket is for someone else",
          "Sign in with the PayPal account that connected this Claude.",
        ),
      );
    return;
  }
  if (req.body.decision !== "approve") {
    db.update<AuthRequest>("auth_requests", request.id, (r) => ({ ...r, completed: true }));
    if (request.ticket) res.send(ticketDeclinedPage(human));
    else
      res.redirect(
        302,
        clientRedirect(request, { error: "access_denied", error_description: "The person said not now." }),
      );
    return;
  }

  if (isConnectRequest(request)) {
    const choice = courierChoice(human, request.clientId);
    if (choice) {
      const picked = choice.couriers.find((c) => c.id === req.body.courier) ?? findCourier(human.id, choice.preselect);
      if (!picked) {
        res.redirect(302, `/start/courier?req=${request.id}`);
        return;
      }
      saveCourier({
        ...picked,
        mode: "claude",
        clientId: request.clientId,
        clientName: request.clientName,
        boundAt: new Date().toISOString(),
      });
    }
    const connection =
      db.list<Connection>(
        "connections",
        (c) => c.humanId === human.id && c.clientId === request.clientId && c.status === "active",
        1,
      )[0] ??
      newConnection({
        humanId: human.id,
        clientId: request.clientId,
        clientName: request.clientName,
        resource: request.resource,
        scopes: request.scopes,
        status: "active",
        createdAt: new Date().toISOString(),
      });
    const code = issueAuthorizationCode(request, { connectionId: connection.id }, human);
    res.redirect(302, clientRedirect(request, { code }));
    return;
  }

  const merchant = findMerchant(request.resource)!;
  const rawScopes = ([] as string[]).concat(req.body.scopes ?? []);
  const scopes = rawScopes.filter(isScope).filter((s) => merchant.scopes.includes(s)) as Scope[];
  const spend = Math.round(Number(req.body.spend_limit) * 100);
  // A ticket is one budget. The agent's limits can still be narrower when a client asks for it.
  const perPurchase = req.body.per_purchase_limit ? Math.round(Number(req.body.per_purchase_limit) * 100) : spend;
  const duration = (req.body.duration in DURATIONS ? req.body.duration : "7d") as DurationKey;
  const intent = String(req.body.intent ?? "")
    .trim()
    .slice(0, 160);
  const wantsBond = req.body.bond === "1";
  const wantsAutopay = req.body.autopay === "1" && scopes.includes("store:buy");

  const problem =
    scopes.length === 0
      ? "Pick at least one permission."
      : !(spend >= 100 && spend <= 50_000)
        ? "The total budget must be between $1 and $500."
        : !(perPurchase >= 100 && perPurchase <= spend)
          ? "The per-purchase limit must be at least $1 and no more than the total budget."
          : null;
  if (problem) {
    res.status(400).send(consentPage(request, merchant, human, problem));
    return;
  }

  // One courier per Claude: an outside client (the person's own Claude) is bound to the courier they pick, and acts
  // as that courier from then on, in every chat.
  const choice = courierChoice(human, request.clientId);
  const picked = choice?.couriers.find((c) => c.id === req.body.courier);
  if (picked)
    saveCourier({
      ...picked,
      mode: "claude",
      clientId: request.clientId,
      clientName: request.clientName,
      boundAt: new Date().toISOString(),
    });
  const actingAs = courierForClient(human.id, request.clientId);

  const visa: Visa = {
    id: newId("visa"),
    humanId: human.id,
    clientId: request.clientId,
    agentName: actingAs?.name ?? request.clientName,
    resource: merchant.resource,
    merchantName: merchant.name,
    scopes,
    spendLimitCents: spend,
    perPurchaseLimitCents: perPurchase,
    spentCents: 0,
    currency: "USD",
    intent,
    status: "active",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + DURATIONS[duration].ms).toISOString(),
    bond: null,
  };

  db.put("visa_requests", visa.id, { visaId: visa.id, authRequestId: request.id, wantsBond });

  const saved = wantsAutopay ? savedPayPal(human.id) : undefined;
  if (saved) visa.autopay = { status: "on", email: saved.email };
  else if (wantsAutopay) {
    // Save PayPal on the account: one PayPal page now, none for later purchases or errands.
    try {
      const setup = await paypal.createVaultSetup(
        {
          description: `Your couriers may buy for you within the budgets you set, until you remove this in Courier.`,
          brandName: "Courier",
          returnUrl: `${config.courier.url}/autopay/return?visa=${visa.id}`,
          cancelUrl: `${config.courier.url}/autopay/cancel?visa=${visa.id}`,
        },
        `autopay-${visa.id}`,
      );
      if (!setup.approveUrl) throw new Error("PayPal returned no approval link");
      visa.status = "pending_paypal";
      visa.autopay = { status: "pending" };
      db.put("visas", visa.id, visa);
      db.put("visa_requests", visa.id, {
        visaId: visa.id,
        authRequestId: request.id,
        wantsBond,
        setupTokenId: setup.id,
      });
      res.redirect(302, setup.approveUrl);
      return;
    } catch (error) {
      // Saving PayPal isn't available (e.g. Vault is off on the PayPal app): the errand still works, with a PayPal
      // page per purchase.
      console.warn("[autopay] could not start saving PayPal:", (error as Error).message);
      visa.autopay = { status: "failed" };
    }
  }
  await continueIssuing(visa, request, human, wantsBond, res);
});

/** After the optional PayPal steps: take the $5 bond if asked for, then send the agent its code. */
async function continueIssuing(
  visa: Visa,
  request: AuthRequest,
  human: Human,
  wantsBond: boolean,
  res: express.Response,
) {
  if (wantsBond) {
    try {
      const order = await paypal.createOrder(
        {
          intent: "AUTHORIZE",
          amountCents: 500,
          currency: "USD",
          description: `Refundable bond for ${visa.agentName}'s visa at ${visa.merchantName}`,
          customId: visa.id,
          returnUrl: `${config.courier.url}/bond/return?visa=${visa.id}`,
          cancelUrl: `${config.courier.url}/bond/cancel?visa=${visa.id}`,
          brandName: "Courier",
        },
        `bond-${visa.id}`,
      );
      visa.status = "pending_bond";
      visa.bond = { amountCents: 500, orderId: order.id, authorizationId: null, status: "pending" };
      db.put("visas", visa.id, visa);
      res.redirect(302, order.approveUrl!);
    } catch (error) {
      console.error("[bond] could not create authorization order", error);
      res
        .status(502)
        .send(
          consentPage(
            request,
            findMerchant(request.resource)!,
            human,
            "PayPal couldn't create the bond. Try again without a bond.",
          ),
        );
    }
    return;
  }
  visa.status = "active";
  db.put("visas", visa.id, visa);
  issuedStamps(visa);
  await finishIssuing(visa, request, human, res);
}

/** The errand is live. The errand room gets its code; a connected Claude picks the ticket up on its next call. */
async function finishIssuing(visa: Visa, request: AuthRequest, human: Human, res: express.Response) {
  if (!request.ticket) {
    const code = issueAuthorizationCode(request, { visaId: visa.id }, human);
    res.redirect(302, clientRedirect(request, { code }));
    return;
  }
  db.update<AuthRequest>("auth_requests", request.id, (r) => ({ ...r, completed: true, visaId: visa.id }));
  await endEarlierErrands(visa);
  res.send(ticketReadyPage(human, visa));
}

/** The person's errand that's waiting on a PayPal step, if this browser is theirs and the request is still open. */
function pendingErrand(req: express.Request) {
  const human = currentHuman(req);
  const visa = db.get<Visa>("visas", String(req.query.visa ?? ""));
  const link = visa
    ? db.get<{ authRequestId: string; wantsBond?: boolean; setupTokenId?: string }>("visa_requests", visa.id)
    : undefined;
  const request = link ? findAuthRequest(link.authRequestId) : null;
  if (!human || !visa || visa.humanId !== human.id || !request || request.completed)
    return { human, visa: null, request: null, wantsBond: false, setupTokenId: undefined };
  return { human, visa, request, wantsBond: Boolean(link?.wantsBond), setupTokenId: link?.setupTokenId };
}

app.get("/autopay/return", async (req, res) => {
  const { human, visa, request, wantsBond, setupTokenId } = pendingErrand(req);
  if (!visa || !request || !setupTokenId || visa.autopay?.status !== "pending") {
    res.status(400).send(errorPage(human, "This link has expired", "Ask your agent to connect again."));
    return;
  }
  try {
    const token = await paypal.createVaultToken(setupTokenId, `vault-${visa.id}`);
    db.put<SavedPayPalRecord>("saved_paypal", visa.humanId, {
      humanId: visa.humanId,
      vaultId: token.id,
      email: token.email,
    });
    visa.autopay = { status: "on", email: token.email };
  } catch (error) {
    console.warn("[autopay] could not save PayPal:", (error as Error).message);
    visa.autopay = { status: "failed" };
  }
  await continueIssuing(visa, request, human!, wantsBond, res);
});

app.get("/autopay/cancel", async (req, res) => {
  const { human, visa, request, wantsBond } = pendingErrand(req);
  if (!visa || !request) {
    res.redirect(302, "/app");
    return;
  }
  // Not saving PayPal is fine: the errand goes ahead, and each purchase gets its own PayPal page.
  visa.autopay = { status: "declined" };
  await continueIssuing(visa, request, human!, wantsBond, res);
});

app.get("/bond/return", async (req, res) => {
  const human = currentHuman(req);
  const visa = db.get<Visa>("visas", String(req.query.visa ?? ""));
  const link = visa ? db.get<{ authRequestId: string }>("visa_requests", visa.id) : undefined;
  const request = link ? findAuthRequest(link.authRequestId) : null;
  if (!human || !visa || visa.humanId !== human.id || !visa.bond || !request || request.completed) {
    res.status(400).send(errorPage(human, "This link has expired", "Ask your agent to connect again."));
    return;
  }
  try {
    const order = await paypal.authorizeOrder(visa.bond.orderId, `bond-authorize-${visa.id}`);
    visa.bond = { ...visa.bond, authorizationId: order.authorizationId ?? null, status: "authorized" };
    visa.status = "active";
    db.put("visas", visa.id, visa);
  } catch (error) {
    console.error("[bond] authorize failed", error);
    res
      .status(502)
      .send(
        errorPage(
          human,
          "The bond didn't go through",
          "PayPal didn't authorize the hold. Ask your agent to connect again.",
        ),
      );
    return;
  }
  addStamp(visa, "bond", "Bond held", `$5.00 refundable hold on PayPal`);
  issuedStamps(visa);
  await finishIssuing(visa, request, human, res);
});

app.get("/bond/cancel", async (req, res) => {
  const found = db.get<Visa>("visas", String(req.query.visa ?? ""));
  // Only the person who started this errand can cancel it, and only while the bond is pending.
  const visa = found?.humanId === currentHuman(req)?.id && found?.status === "pending_bond" ? found : undefined;
  const link = visa ? db.get<{ authRequestId: string }>("visa_requests", visa.id) : undefined;
  const request = link ? findAuthRequest(link.authRequestId) : null;
  if (visa) await revokeVisa(visa.id, "Bond was not approved");
  if (!request) {
    res.redirect(302, "/app");
    return;
  }
  db.update<AuthRequest>("auth_requests", request.id, (r) => ({ ...r, completed: true }));
  if (request.ticket) {
    res.redirect(302, "/app");
    return;
  }
  res.redirect(
    302,
    clientRedirect(request, { error: "access_denied", error_description: "The bond was not approved." }),
  );
});

/* ---------- errands ---------- */

// The signed-in app (/app, /app/errands, …) lives in routes/app.ts.

app.post("/app/visas/:id/revoke", async (req, res) => {
  const human = currentHuman(req);
  const visa = db.get<Visa>("visas", req.params.id);
  if (!human || !visa || visa.humanId !== human.id) {
    res.status(404).send(errorPage(human, "Not found", "That visa doesn't exist."));
    return;
  }
  await revokeVisa(visa.id, "Called back by the person");
  const next = typeof req.body.next === "string" && req.body.next.startsWith("/app") ? req.body.next : "/app";
  res.redirect(303, next);
});

app.post("/app/connections/:id/revoke", async (req, res) => {
  const human = currentHuman(req);
  const connection = db.get<Connection>("connections", req.params.id);
  if (!human || connection?.humanId !== human.id) {
    res.status(404).send(errorPage(human, "Not found", "That connection doesn't exist."));
    return;
  }
  await disconnect(connection);
  res.redirect(303, "/app/settings");
});

app.post("/app/paypal/remove", async (req, res) => {
  const human = currentHuman(req);
  if (!human) {
    res.redirect(303, "/");
    return;
  }
  if (!(await removeSavedPayPal(human.id))) {
    res
      .status(502)
      .send(errorPage(human, "Your PayPal is still saved", "PayPal didn't confirm the removal. Please try again."));
    return;
  }
  res.redirect(303, "/app/settings");
});

app.post("/app/account/delete", async (req, res) => {
  const human = currentHuman(req);
  if (!human) {
    res.redirect(303, "/");
    return;
  }
  if (!(await deleteAccount(human))) {
    res
      .status(502)
      .send(
        errorPage(
          human,
          "Your account wasn't deleted",
          "PayPal didn't confirm it had released your saved PayPal or bond, so we kept your account. Your errands have been called back. Please try again.",
        ),
      );
    return;
  }
  endSession(res);
  res.redirect(303, "/account-deleted");
});

app.get("/account-deleted", (req, res) => {
  res.send(accountDeletedPage(currentHuman(req)));
});

/* ---------- approvals (ask_human) ---------- */

app.get("/approvals/:id", (req, res) => {
  const human = currentHuman(req);
  const approval = db.get<Approval>("approvals", req.params.id);
  if (!human) {
    res.send(signInPage());
    return;
  }
  if (!approval || approval.humanId !== human.id) {
    res.status(404).send(errorPage(human, "Not found", "This request doesn't exist or belongs to someone else."));
    return;
  }
  res.send(approvalPage(human, approval, db.get<Visa>("visas", approval.visaId)!));
});

app.post("/approvals/:id", (req, res) => {
  const human = currentHuman(req);
  const approval = db.get<Approval>("approvals", req.params.id);
  if (!human || !approval || approval.humanId !== human.id) {
    res.status(404).send(errorPage(human, "Not found", "This request doesn't exist."));
    return;
  }
  decideApproval(approval, req.body.decision === "approved" ? "approved" : "denied");
  res.redirect(303, `/approvals/${approval.id}`);
});

/* ---------- onboarding + errand room ("Try the demo") ---------- */

app.use(appRouter);

/* ---------- release the bots ---------- */

app.use("/bots", botsRouter);

/* ---------------- start ---------------- */

migrateSavedPayPal();
setInterval(() => void sweepExpiredVisas(), 60_000).unref();

app.listen(config.courier.port, config.bindHost, () => {
  console.log(`Courier  → ${config.courier.url}  (PayPal: ${paypal.mode}, intent: ${config.intent.model})`);
});
