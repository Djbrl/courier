import {
  avatar,
  type CreateOrderInput,
  courierLayout,
  html,
  money,
  newId,
  type OrderSummary,
  PP,
  randomToken,
  requireInternal,
  type VaultSetupInput,
} from "@courier/shared";
import express, { Router } from "express";
import { db } from "./db.ts";

/**
 * A small, clearly labelled stand-in for the PayPal sandbox, used when PAYPAL_CLIENT_ID/SECRET are not set, and for
 * demo people on any server.
 * It mimics the shapes the app needs (Log in with PayPal identity, Orders v2, authorizations) so the full product
 * can be demoed end to end. It is not PayPal and does not look like PayPal.
 */

interface SimPersona {
  key: string;
  name: string;
  payerId: string;
  verified: boolean;
  ageRange: string;
  note: string;
}

const PERSONAS: SimPersona[] = [
  {
    key: "maya",
    name: "Maya Chen",
    payerId: "SIMPAYERMAYA0",
    verified: true,
    ageRange: "25-34",
    note: "Verified account",
  },
  {
    key: "ada",
    name: "Ada Okafor",
    payerId: "SIMPAYERADA01",
    verified: true,
    ageRange: "25-34",
    note: "Verified account",
  },
  {
    key: "malik",
    name: "Malik Diallo",
    payerId: "SIMPAYERMLK02",
    verified: true,
    ageRange: "18-24",
    note: "Verified account",
  },
  {
    key: "sam",
    name: "Sam Reyes",
    payerId: "SIMPAYERSAM03",
    verified: false,
    ageRange: "25-34",
    note: "Unverified account",
  },
  { key: "riley", name: "Riley Chen", payerId: "SIMPAYERRLY04", verified: true, ageRange: "13-17", note: "Under 18" },
];

interface SimOrder extends CreateOrderInput {
  id: string;
  status: "CREATED" | "APPROVED" | "COMPLETED" | "VOIDED";
  createdAt: string;
  captureId?: string | null;
  authorizationId?: string | null;
}

interface SimAuthorization {
  id: string;
  orderId: string;
  amountCents: number;
  status: "CREATED" | "VOIDED" | "CAPTURED";
}

interface SimSetupToken extends VaultSetupInput {
  id: string;
  status: "PAYER_ACTION_REQUIRED" | "APPROVED" | "VAULTED" | "CANCELLED";
}

interface SimPaymentToken {
  id: string;
  setupTokenId: string;
  email: string;
  deleted: boolean;
}

function summary(order: SimOrder, base: string): OrderSummary {
  return {
    id: order.id,
    status: order.status,
    approveUrl: `${base}/sim-paypal/checkout/${order.id}`,
    customId: order.customId,
    amountCents: order.amountCents,
    captureId: order.captureId ?? null,
    authorizationId: order.authorizationId ?? null,
  };
}

function simBanner() {
  return html`<div class="sim-bar"><b>SIMULATED</b> Not PayPal · no real money</div>`;
}

export function simPaypalRouter(courierUrl: string): Router {
  const router = Router();
  router.use(express.urlencoded({ extended: false }));
  router.use(express.json());

  /* ---------- Log in with PayPal (simulated) ---------- */

  router.get("/login", (req, res) => {
    const redirectUri = String(req.query.redirect_uri ?? "");
    const state = String(req.query.state ?? "");
    res.send(
      courierLayout({
        title: "Simulated PayPal sign-in",
        bodyClass: "simf",
        body: html`
          ${simBanner()}
          <main class="sim-card">
            <span class="sk">Sandbox simulator</span>
            <h1>Sign in as a test buyer</h1>
            <p class="lead">Stands in for Log in with ${PP}. Each account takes a different path.</p>
            <form method="post" action="/sim-paypal/login" class="personas">
              <input type="hidden" name="redirect_uri" value="${redirectUri}">
              <input type="hidden" name="state" value="${state}">
              ${PERSONAS.map(
                (
                  p,
                  i,
                ) => html`<button class="persona ${i === 0 ? "rec" : ""}" name="persona" value="${p.key}" type="submit">
                  ${avatar(["#FFC629", "#D6FF2E", "#B7A3FF", "#FF8A3D", "#DEDDFF"][i % 5])}
                  <span><b>${p.name}</b><small>${p.note} · age ${p.ageRange}</small></span>
                  <span class="tagx">${i === 0 ? "Start here" : p.verified && p.ageRange !== "13-17" ? "Verified" : p.verified ? "Refused: under 18" : "Refused: unverified"}</span>
                </button>`,
              )}
            </form>
          </main>`,
      }),
    );
  });

  router.post("/login", (req, res) => {
    const persona = PERSONAS.find((p) => p.key === req.body.persona);
    const redirectUri = String(req.body.redirect_uri ?? "");
    if (!persona || !redirectUri.startsWith(courierUrl)) {
      res.status(400).send("Bad request");
      return;
    }
    const code = `simcode_${randomToken(16)}`;
    db.put("sim_login_codes", code, { code, persona: persona.key, expiresAt: Date.now() + 5 * 60 * 1000 });
    const url = new URL(redirectUri);
    url.searchParams.set("code", code);
    url.searchParams.set("state", String(req.body.state ?? ""));
    res.redirect(302, url.toString());
  });

  /* ---------- Checkout approval (simulated) ---------- */

  router.get("/checkout/:id", (req, res) => {
    const order = db.get<SimOrder>("sim_orders", req.params.id);
    if (!order) {
      res.status(404).send("Unknown order");
      return;
    }
    const isBond = order.intent === "AUTHORIZE";
    res.send(
      courierLayout({
        title: isBond ? "Approve a refundable hold" : "Approve payment",
        bodyClass: "simf",
        body: html`
          ${simBanner()}
          <main class="sim-card">
            <span class="sk">${order.brandName}</span>
            <h1>${isBond ? "Approve a refundable hold" : "Approve this payment"}</h1>
            <p class="lead">${order.description}</p>
            ${
              order.items?.length
                ? html`<ul class="sim-lines">${order.items.map(
                    (i) =>
                      html`<li><span>${i.quantity} × ${i.name}</span><span>${money(i.unitCents * i.quantity, order.currency)}</span></li>`,
                  )}</ul>`
                : ""
            }
            <p class="sim-tot"><span>${isBond ? "Hold amount" : "Total"}</span><b>${money(order.amountCents, order.currency)}</b></p>
            ${isBond ? html`<p class="fine" style="margin-top:8px">Nothing is charged now. The hold is released when the errand ends cleanly.</p>` : ""}
            ${
              order.status !== "CREATED"
                ? html`<p class="err">This order is already ${order.status.toLowerCase()}.</p>`
                : html`<form method="post" action="/sim-paypal/checkout/${order.id}" class="sim-acts">
                  <button class="btn" name="decision" value="approve" type="submit">${isBond ? "Approve hold" : "Pay now"}</button>
                  <button class="btn ghost" name="decision" value="cancel" type="submit">Cancel</button>
                </form>`
            }
          </main>`,
      }),
    );
  });

  router.post("/checkout/:id", (req, res) => {
    const order = db.get<SimOrder>("sim_orders", req.params.id);
    if (order?.status !== "CREATED") {
      res.status(409).send("Order is not awaiting approval");
      return;
    }
    if (req.body.decision === "approve") {
      db.put("sim_orders", order.id, { ...order, status: "APPROVED" });
      const url = new URL(order.returnUrl);
      url.searchParams.set("token", order.id);
      url.searchParams.set("PayerID", "SIMPAYER");
      res.redirect(302, url.toString());
    } else {
      const url = new URL(order.cancelUrl);
      url.searchParams.set("token", order.id);
      res.redirect(302, url.toString());
    }
  });

  /* ---------- Save PayPal for later (simulated Vault approval) ---------- */

  router.get("/vault/:id", (req, res) => {
    const setup = db.get<SimSetupToken>("sim_setup_tokens", req.params.id);
    if (!setup) {
      res.status(404).send("Unknown setup token");
      return;
    }
    res.send(
      courierLayout({
        title: "Save PayPal for later",
        bodyClass: "simf",
        body: html`
          ${simBanner()}
          <main class="sim-card">
            <span class="sk">${setup.brandName}</span>
            <h1>Save PayPal for ${setup.brandName}?</h1>
            <p class="lead">${setup.description}</p>
            <p class="fine" style="margin-top:8px">Nothing is charged now. You can remove it any time.</p>
            ${
              setup.status !== "PAYER_ACTION_REQUIRED"
                ? html`<p class="err">This request is already ${setup.status.toLowerCase()}.</p>`
                : html`<form method="post" action="/sim-paypal/vault/${setup.id}" class="sim-acts">
                  <button class="btn" name="decision" value="approve" type="submit">Agree and continue</button>
                  <button class="btn ghost" name="decision" value="cancel" type="submit">Cancel</button>
                </form>`
            }
          </main>`,
      }),
    );
  });

  router.post("/vault/:id", (req, res) => {
    const setup = db.get<SimSetupToken>("sim_setup_tokens", req.params.id);
    if (setup?.status !== "PAYER_ACTION_REQUIRED") {
      res.status(409).send("Setup token is not awaiting approval");
      return;
    }
    const approved = req.body.decision === "approve";
    db.put("sim_setup_tokens", setup.id, { ...setup, status: approved ? "APPROVED" : "CANCELLED" });
    const url = new URL(approved ? setup.returnUrl : setup.cancelUrl);
    url.searchParams.set("approval_token_id", setup.id);
    res.redirect(302, url.toString());
  });

  /* ---------- API (server-to-server, shared secret) ---------- */

  const api = Router();
  api.use(requireInternal);

  api.post("/login/token", (req, res) => {
    const record = db.get<{ persona: string; expiresAt: number }>("sim_login_codes", req.body.code);
    if (!record || record.expiresAt < Date.now()) {
      res.status(400).json({ message: "invalid code" });
      return;
    }
    db.delete("sim_login_codes", req.body.code);
    const persona = PERSONAS.find((p) => p.key === record.persona)!;
    res.json({
      payerId: persona.payerId,
      verified: persona.verified,
      ageRange: persona.ageRange,
      accountType: "PERSONAL",
      emailVerified: true,
      name: persona.name,
    });
  });

  api.post("/orders", (req, res) => {
    const input = req.body as CreateOrderInput & { idempotencyKey?: string };
    if (input.idempotencyKey) {
      const existing = db.get<{ orderId: string }>("sim_idempotency", input.idempotencyKey);
      if (existing) {
        res.json(summary(db.get<SimOrder>("sim_orders", existing.orderId)!, courierUrl));
        return;
      }
    }
    const order: SimOrder = {
      ...input,
      id: newId("SIM").replace("_", "-"),
      status: "CREATED",
      createdAt: new Date().toISOString(),
    };
    db.put("sim_orders", order.id, order);
    if (input.idempotencyKey) db.put("sim_idempotency", input.idempotencyKey, { orderId: order.id });
    res.status(201).json(summary(order, courierUrl));
  });

  api.get("/orders/:id", (req, res) => {
    const order = db.get<SimOrder>("sim_orders", req.params.id);
    if (!order) {
      res.status(404).json({ message: "not found" });
      return;
    }
    res.json(summary(order, courierUrl));
  });

  api.post("/orders/:id/capture", (req, res) => {
    const order = db.get<SimOrder>("sim_orders", req.params.id);
    if (!order) {
      res.status(404).json({ message: "not found" });
      return;
    }
    if (order.status === "COMPLETED") {
      res.json(summary(order, courierUrl));
      return;
    }
    if (order.status !== "APPROVED" || order.intent !== "CAPTURE") {
      res.status(422).json({ message: `ORDER_NOT_APPROVED (status ${order.status})` });
      return;
    }
    const done = { ...order, status: "COMPLETED" as const, captureId: newId("CAP").replace("_", "-") };
    db.put("sim_orders", order.id, done);
    res.json(summary(done, courierUrl));
  });

  api.post("/orders/:id/authorize", (req, res) => {
    const order = db.get<SimOrder>("sim_orders", req.params.id);
    if (!order) {
      res.status(404).json({ message: "not found" });
      return;
    }
    if (order.status === "COMPLETED") {
      res.json(summary(order, courierUrl));
      return;
    }
    if (order.status !== "APPROVED" || order.intent !== "AUTHORIZE") {
      res.status(422).json({ message: `ORDER_NOT_APPROVED (status ${order.status})` });
      return;
    }
    const auth: SimAuthorization = {
      id: newId("AUTH").replace("_", "-"),
      orderId: order.id,
      amountCents: order.amountCents,
      status: "CREATED",
    };
    db.put("sim_authorizations", auth.id, auth);
    const done = { ...order, status: "COMPLETED" as const, authorizationId: auth.id };
    db.put("sim_orders", order.id, done);
    res.json(summary(done, courierUrl));
  });

  api.post("/authorizations/:id/void", (req, res) => {
    const auth = db.get<SimAuthorization>("sim_authorizations", req.params.id);
    if (auth?.status !== "CREATED") {
      res.status(422).json({ message: "AUTHORIZATION_ALREADY_FINALIZED" });
      return;
    }
    db.put("sim_authorizations", auth.id, { ...auth, status: "VOIDED" });
    res.json({ status: "VOIDED" });
  });

  api.post("/authorizations/:id/capture", (req, res) => {
    const auth = db.get<SimAuthorization>("sim_authorizations", req.params.id);
    if (auth?.status !== "CREATED") {
      res.status(422).json({ message: "AUTHORIZATION_ALREADY_FINALIZED" });
      return;
    }
    db.put("sim_authorizations", auth.id, { ...auth, status: "CAPTURED" });
    res.json({ captureId: newId("CAP").replace("_", "-"), status: "COMPLETED" });
  });

  api.post("/vault/setup-tokens", (req, res) => {
    const input = req.body as VaultSetupInput & { idempotencyKey?: string };
    const setup: SimSetupToken = {
      id: newId("SETUP").replace("_", "-"),
      description: input.description,
      brandName: input.brandName,
      returnUrl: input.returnUrl,
      cancelUrl: input.cancelUrl,
      status: "PAYER_ACTION_REQUIRED",
    };
    db.put("sim_setup_tokens", setup.id, setup);
    res.status(201).json({ id: setup.id, approveUrl: `${courierUrl}/sim-paypal/vault/${setup.id}` });
  });

  api.post("/vault/payment-tokens", (req, res) => {
    const setup = db.get<SimSetupToken>("sim_setup_tokens", req.body.setupTokenId);
    if (setup?.status !== "APPROVED") {
      res.status(422).json({ message: `SETUP_TOKEN_NOT_APPROVED (status ${setup?.status ?? "unknown"})` });
      return;
    }
    const token: SimPaymentToken = {
      id: newId("VT").replace("_", "-"),
      setupTokenId: setup.id,
      email: "buyer@sim-paypal.test",
      deleted: false,
    };
    db.put("sim_payment_tokens", token.id, token);
    db.put("sim_setup_tokens", setup.id, { ...setup, status: "VAULTED" });
    res.status(201).json({ id: token.id, email: token.email });
  });

  api.delete("/vault/payment-tokens/:id", (req, res) => {
    const token = db.get<SimPaymentToken>("sim_payment_tokens", req.params.id);
    if (token) db.put("sim_payment_tokens", token.id, { ...token, deleted: true });
    res.status(204).end();
  });

  /** Test hook: whether a saved PayPal still exists. */
  api.get("/vault/payment-tokens/:id", (req, res) => {
    const token = db.get<SimPaymentToken>("sim_payment_tokens", req.params.id);
    if (!token || token.deleted) {
      res.status(404).json({ message: "RESOURCE_NOT_FOUND" });
      return;
    }
    res.json({ id: token.id });
  });

  api.post("/vault/charge", (req, res) => {
    const input = req.body as Omit<CreateOrderInput, "returnUrl" | "cancelUrl" | "intent"> & {
      vaultId: string;
      idempotencyKey?: string;
    };
    const token = db.get<SimPaymentToken>("sim_payment_tokens", input.vaultId);
    if (!token || token.deleted) {
      res.status(422).json({ message: "PAYMENT_SOURCE_INFO_CANNOT_BE_VERIFIED" });
      return;
    }
    if (input.idempotencyKey) {
      const existing = db.get<{ orderId: string }>("sim_idempotency", input.idempotencyKey);
      if (existing) {
        res.json(summary(db.get<SimOrder>("sim_orders", existing.orderId)!, courierUrl));
        return;
      }
    }
    const order: SimOrder = {
      ...input,
      intent: "CAPTURE",
      returnUrl: "",
      cancelUrl: "",
      id: newId("SIM").replace("_", "-"),
      status: "COMPLETED",
      captureId: newId("CAP").replace("_", "-"),
      createdAt: new Date().toISOString(),
    };
    db.put("sim_orders", order.id, order);
    if (input.idempotencyKey) db.put("sim_idempotency", input.idempotencyKey, { orderId: order.id });
    res.status(201).json({ ...summary(order, courierUrl), approveUrl: null });
  });

  router.use("/api", api);
  return router;
}
