/**
 * End-to-end test of the whole flow, acting like an MCP client (e.g. Claude) plus a human in a browser.
 * Runs through `npm run test:e2e`, which starts throwaway servers with simulated PayPal.
 */

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const STORE = process.env.STORE_URL ?? "http://localhost:4100";
const MCP = `${STORE}/mcp`;
const REDIRECT = "http://localhost:4999/callback";

let passed = 0;
async function step(name: string, fn: () => Promise<void>) {
  const started = performance.now();
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name} \x1b[2m(${Math.round(performance.now() - started)}ms)\x1b[0m`);
  } catch (error) {
    console.error(`  ✗ ${name}\n    ${(error as Error).stack}`);
    process.exit(1);
  }
}

/* ---------- a tiny browser: cookie jar + manual redirects ---------- */
class Browser {
  jar = new Map<string, string>();
  cookieHeader() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  store(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const idx = pair.indexOf("=");
      const name = pair.slice(0, idx);
      const value = pair.slice(idx + 1);
      if (/Max-Age=0/i.test(c)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }
  async req(url: string, init: { method?: string; form?: Record<string, string | string[]> } = {}) {
    let body: string | undefined;
    const headers: Record<string, string> = { cookie: this.cookieHeader() };
    if (init.form) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(init.form))
        for (const one of ([] as string[]).concat(v)) params.append(k, one);
      body = params.toString();
      headers["content-type"] = "application/x-www-form-urlencoded";
    }
    const res = await fetch(url, {
      method: init.method ?? (init.form ? "POST" : "GET"),
      headers,
      body,
      redirect: "manual",
    });
    this.store(res);
    return res;
  }
  /** Follows redirects until leaving the given origins (e.g. the agent's redirect_uri). */
  async follow(url: string, stopAt: string, init: { method?: string; form?: Record<string, string | string[]> } = {}) {
    let res = await this.req(url, init);
    let location = res.headers.get("location");
    let hops = 0;
    while (location && hops++ < 15) {
      const next = new URL(location, url).toString();
      if (next.startsWith(stopAt)) return { res, location: next };
      url = next;
      res = await this.req(next);
      location = res.headers.get("location");
    }
    return { res, location: null as string | null, url };
  }
}

const b64url = (buf: Buffer) => buf.toString("base64url");

async function mcpClient(token: string, answer?: (message: string) => string) {
  // With `answer`, the client can show dialogs (MCP elicitation), as Claude does; `answer` plays the person.
  const client = new Client(
    { name: "e2e", version: "1" },
    answer ? { capabilities: { elicitation: { form: {} } } } : undefined,
  );
  if (answer)
    client.setRequestHandler(ElicitRequestSchema, async (req) => ({
      action: "accept",
      content: { answer: answer(req.params.message) },
    }));
  await client.connect(
    new StreamableHTTPClientTransport(new URL(MCP), {
      requestInit: { headers: { Authorization: `Bearer ${token}`, "X-Demo-Source": "e2e" } },
    }),
  );
  return client;
}

function structured(result: any) {
  return result.structuredContent ?? {};
}

interface Flow {
  client: { client_id: string };
  courier: string;
  asMeta: any;
}

async function discover(): Promise<Flow> {
  const res = await fetch(MCP, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(res.status, 401);
  const www = res.headers.get("www-authenticate") ?? "";
  const prmUrl = www.match(/resource_metadata="([^"]+)"/)?.[1];
  assert.ok(prmUrl, "resource_metadata in WWW-Authenticate");
  const prm = await (await fetch(prmUrl!)).json();
  assert.equal(prm.resource, MCP);
  const courier = prm.authorization_servers[0];
  const asMeta = await (await fetch(`${courier}/.well-known/oauth-authorization-server`)).json();
  assert.equal(asMeta.issuer, courier, "issuer must equal the authorization server identifier");
  const reg = await fetch(asMeta.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "E2E Claude",
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  assert.equal(reg.status, 201);
  return { client: await reg.json(), courier, asMeta };
}

async function authorize(
  flow: Flow,
  browser: Browser,
  persona: string,
  consent: Record<string, string | string[]> | null,
) {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(8));
  const url = new URL(flow.asMeta.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: flow.client.client_id,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "store:browse store:reserve store:buy",
    state,
    resource: MCP,
  }).toString();

  // /authorize → /connect/:id
  const first = await browser.req(url.toString());
  assert.equal(first.status, 302);
  const connect = new URL(first.headers.get("location")!, flow.courier).toString();
  const reqId = connect.split("/connect/")[1];

  // Continue with PayPal → simulator login page
  const start = await browser.req(`${flow.courier}/auth/paypal/start?req=${reqId}&switch=1`);
  const simLogin = new URL(start.headers.get("location")!);
  const loginPost = await browser.req(`${flow.courier}/sim-paypal/login`, {
    form: {
      persona,
      redirect_uri: simLogin.searchParams.get("redirect_uri")!,
      state: simLogin.searchParams.get("state")!,
    },
  });
  const callback = loginPost.headers.get("location")!;
  const cb = await browser.req(callback);
  if (!consent) return { refusal: await cb.text(), cbStatus: cb.status };
  assert.equal(cb.status, 302, "callback should redirect to consent");
  assert.ok(cb.headers.get("location")!.includes(`/consent/${reqId}`));

  // Consent → maybe saving PayPal → maybe bond approval → redirect to the agent with a code
  let followed: { location: string | null; url?: string } = await browser.follow(
    `${flow.courier}/consent/${reqId}`,
    REDIRECT,
    { form: consent },
  );
  let redirect = followed.location;
  if (!redirect && consent.autopay) {
    // Saved PayPal: we're on the simulator's "Save PayPal" page; agree (or cancel).
    const setupId = followed.url!.split("/sim-paypal/vault/")[1];
    assert.ok(setupId, `expected the Save PayPal page, got ${followed.url}`);
    followed = await browser.follow(`${flow.courier}/sim-paypal/vault/${setupId}`, REDIRECT, {
      form: { decision: String(consent.autopay_decision ?? "approve") },
    });
    redirect = followed.location;
  }
  if (!redirect && consent.bond) {
    // Bond: we're on the simulator's approval page; approve the hold.
    const orderId = followed.url!.split("/sim-paypal/checkout/")[1];
    const approve = await browser.follow(`${flow.courier}/sim-paypal/checkout/${orderId}`, REDIRECT, {
      form: { decision: "approve" },
    });
    redirect = approve.location;
  }
  assert.ok(redirect, "expected a redirect back to the agent");
  const back = new URL(redirect!);
  assert.equal(back.searchParams.get("state"), state);
  assert.equal(back.searchParams.get("iss"), flow.courier, "RFC 9207 iss");
  const code = back.searchParams.get("code")!;
  assert.ok(code);

  const tokenRes = await fetch(flow.asMeta.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id: flow.client.client_id,
      code_verifier: verifier,
      resource: MCP,
    }),
  });
  const tokens = await tokenRes.json();
  assert.equal(tokenRes.status, 200, JSON.stringify(tokens));
  return { tokens, reqId };
}

const decode = (jwt: string) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());

/* ---------------- the run ---------------- */

console.log("\nCourier end-to-end\n");
const browser = new Browser();
let flow!: Flow;
let tokens: any;
let client!: Client;
let visaId = "";

await step("Discovery: 401 → protected resource metadata → AS metadata → dynamic client registration", async () => {
  flow = await discover();
});

await step("Unverified PayPal account is refused", async () => {
  const out = await authorize(flow, new Browser(), "sam", null);
  assert.match(out.refusal!, /isn&#39;t verified|isn't verified/);
});

await step("Under-18 PayPal account is refused", async () => {
  const out = await authorize(flow, new Browser(), "riley", null);
  assert.match(out.refusal!, /for adults/);
});

await step(
  "Verified human signs in with PayPal, issues a visa, agent gets a token (PKCE + resource + iss)",
  async () => {
    const out = await authorize(flow, browser, "ada", {
      decision: "approve",
      scopes: ["store:browse", "store:reserve", "store:buy"],
      spend_limit: "60",
      per_purchase_limit: "40",
      duration: "24h",
      intent: "Jazz records for my dad",
    });
    tokens = out.tokens;
    const claims = decode(tokens.access_token);
    assert.equal(claims.aud, MCP);
    assert.equal(claims.human.verified, true);
    assert.match(claims.sub, /^pp_/);
    assert.equal(claims.visa.spend_limit.value, "60.00");
    assert.ok(!JSON.stringify(claims).includes("SIMPAYER"), "no PayPal id leaks to the merchant");
    visaId = claims.visa.id;
  },
);

await step("MCP: list tools and whoami over MCP", async () => {
  client = await mcpClient(tokens.access_token);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "get_item",
    "hold_item",
    "order_status",
    "request_purchase",
    "search_catalog",
    "whoami",
  ]);
  const who = await client.callTool({ name: "whoami", arguments: {} });
  assert.equal(structured(who).visa.id, visaId);
});

let orderId = "";
await step("Search jazz under $40 and check out a $28 record → PayPal order carries the visa id", async () => {
  const search = await client.callTool({ name: "search_catalog", arguments: { query: "jazz", max_price: 40 } });
  assert.ok(structured(search).results.length > 0);
  const checkout = await client.callTool({ name: "request_purchase", arguments: { item_ids: ["jr-002"] } });
  const sc = structured(checkout);
  assert.ok(sc.approve_url, JSON.stringify(checkout));
  orderId = sc.order_id;
  // The human approves the payment.
  const approve = await browser.follow(sc.approve_url, `${STORE}/paypal/return`, {
    form: { decision: "approve" },
    method: "POST",
  });
  assert.ok(approve.location, "redirect to merchant return URL");
  const ret = await fetch(approve.location!);
  assert.match(await ret.text(), /<h1 class="big">Paid\./);
  const status = await client.callTool({ name: "order_status", arguments: { order_id: orderId } });
  assert.equal(structured(status).status, "paid");
});

await step("Over the per-purchase limit is denied in code (no model call)", async () => {
  const r = await client.callTool({ name: "request_purchase", arguments: { item_ids: ["jr-026"] } });
  assert.equal(r.isError, true);
  assert.equal(structured(r).code, "per_purchase_limit");
});

await step("Off-intent purchase asks the human; after approval the retry goes through", async () => {
  const r = await client.callTool({ name: "request_purchase", arguments: { item_ids: ["jr-022"] } });
  const sc = structured(r);
  assert.equal(sc.decision, "ask_human", JSON.stringify(r));
  const page = await browser.req(sc.approval_url);
  assert.equal(page.status, 200);
  const decide = await browser.req(sc.approval_url, { form: { decision: "approved" } });
  assert.equal(decide.status, 303);
  const retry = await client.callTool({
    name: "request_purchase",
    arguments: { item_ids: ["jr-022"], approval_id: sc.approval_id },
  });
  assert.ok(structured(retry).approve_url, JSON.stringify(retry));
});

await step("Remaining budget is enforced across purchases ($28 spent + $13 held, $35 > $19 left)", async () => {
  const r = await client.callTool({ name: "request_purchase", arguments: { item_ids: ["jr-027"] } });
  assert.equal(structured(r).code, "spend_limit", JSON.stringify(r));
});

await step(
  "In-chat dialog: Courier asks inside the chat app; no stops it, yes lets it through (and covers buying it too)",
  async () => {
    const asked: string[] = [];
    let reply = "No";
    const chat = await mcpClient(tokens.access_token, (message) => {
      asked.push(message);
      return reply;
    });
    const no = await chat.callTool({ name: "hold_item", arguments: { item_id: "jr-021" } });
    assert.equal(no.isError, true, JSON.stringify(no));
    assert.equal(structured(no).code, "human_denied");
    reply = "Yes, allow it";
    const yes = await chat.callTool({ name: "hold_item", arguments: { item_id: "jr-033" } });
    assert.ok(structured(yes).reservation_id, JSON.stringify(yes));
    assert.equal(asked.length, 2);
    assert.match(asked[1]!, /^Courier: .+ wants to hold Night Bus Freestyles/);
    // That yes also covers buying the same item: no second question.
    const buy = await chat.callTool({ name: "request_purchase", arguments: { item_ids: ["jr-033"] } });
    assert.ok(structured(buy).approve_url, JSON.stringify(buy));
    assert.equal(asked.length, 2);
    await chat.close();
  },
);

await step("In-chat dialog closed without an answer: Courier falls back to the approval link", async () => {
  // Some clients decline dialogs on their own; that must never count as the person's "no".
  const chat = new Client({ name: "e2e", version: "1" }, { capabilities: { elicitation: { form: {} } } });
  chat.setRequestHandler(ElicitRequestSchema, async () => ({ action: "decline" }));
  await chat.connect(
    new StreamableHTTPClientTransport(new URL(MCP), {
      requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    }),
  );
  const r = await chat.callTool({ name: "hold_item", arguments: { item_id: "jr-017" } });
  const sc = structured(r);
  assert.equal(sc.decision, "ask_human", JSON.stringify(r));
  assert.match(String(sc.approval_url), /\/approvals\//);
  await chat.close();
});

await step("Refresh token rotates and still works", async () => {
  const res = await fetch(flow.asMeta.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: flow.client.client_id,
      resource: MCP,
    }),
  });
  const next = await res.json();
  assert.equal(res.status, 200, JSON.stringify(next));
  const reuse = await fetch(flow.asMeta.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: flow.client.client_id,
    }),
  });
  assert.equal(reuse.status, 400, "old refresh token must not be reusable");
  tokens = next;
});

await step("Courier names work like usernames: bad names are refused", async () => {
  for (const name of ["Your courier", "x", "1Juno", "Thirteenchars", "<b>Juno</b>"]) {
    const res = await browser.req(`${flow.courier}/start/courier`, { form: { name, human: "Maya", color: "cobalt" } });
    assert.equal(res.status, 400, `"${name}" should be refused`);
    assert.match(await res.text(), /2–12 letters, numbers or hyphens/);
  }
});

await step("Courier home shows the errand; its detail shows every step", async () => {
  // Making a courier is part of onboarding; the Claude that connected first becomes it.
  const made = await browser.req(`${flow.courier}/start/courier`, {
    form: { name: "Juno", human: "Maya", color: "cobalt" },
  });
  assert.equal(made.status, 303);
  const home = await (await browser.req(`${flow.courier}/app`)).text();
  assert.match(home, /Verified PayPal account/);
  assert.match(home, /Jazz records for my dad/);
  assert.match(home, /In Claude: Juno/);
  const detail = await (await browser.req(`${flow.courier}/app/errands?e=${visaId}`)).text();
  assert.match(detail, /Bought Saltwater Standards/);
});

await step("A stranger can't cancel someone else's errand through the bond link", async () => {
  await fetch(`${flow.courier}/bond/cancel?visa=${visaId}`, { redirect: "manual" });
  const page = await (await browser.req(`${flow.courier}/app/errands?e=${visaId}`)).text();
  assert.match(page, /Call back/);
});

await step("Revoking the visa locks the agent out within seconds", async () => {
  const res = await browser.req(`${flow.courier}/app/visas/${visaId}/revoke`, { form: {} });
  assert.equal(res.status, 303);
  await new Promise((r) => setTimeout(r, 3200));
  const raw = await fetch(MCP, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${tokens.access_token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "whoami", arguments: {} } }),
  });
  assert.equal(raw.status, 401);
});

await step(
  "Saved PayPal: one OK on the ticket, then purchases are paid straight away; calling back removes it",
  async () => {
    const b = browser;
    const out = await authorize(flow, b, "ada", {
      decision: "approve",
      scopes: ["store:browse", "store:buy"],
      spend_limit: "60",
      per_purchase_limit: "40",
      duration: "24h",
      intent: "Jazz records",
      autopay: "1",
    });
    const claims = decode(out.tokens.access_token);
    assert.equal(claims.visa.autopay, true);
    assert.ok(!JSON.stringify(claims).includes("VT-"), "the saved PayPal token never reaches the shop or agent");
    const asked: string[] = [];
    const chat = await mcpClient(out.tokens.access_token, (message) => {
      asked.push(message);
      return "Yes, allow it";
    });

    // On the ticket: paid at once, no PayPal page, no question.
    const buy = await chat.callTool({ name: "request_purchase", arguments: { item_ids: ["jr-011"] } });
    const sc = structured(buy);
    assert.equal(sc.status, "paid", JSON.stringify(buy));
    assert.equal(sc.paid_with, "saved_paypal");
    assert.equal(sc.approve_url, undefined);
    assert.equal(sc.remaining_budget, "35.00");
    assert.equal(asked.length, 0);
    assert.equal(
      structured(await chat.callTool({ name: "order_status", arguments: { order_id: sc.order_id } })).status,
      "paid",
    );

    // Off the ticket: one question, and the yes pays it.
    const rap = await chat.callTool({ name: "request_purchase", arguments: { item_ids: ["jr-034"] } });
    assert.equal(structured(rap).status, "paid", JSON.stringify(rap));
    assert.equal(asked.length, 1);
    assert.match(asked[0]!, /Yes pays with your saved PayPal/);
    assert.equal(structured(rap).remaining_budget, "9.00");

    // Spend landed on the errand; the shop sees the paid orders.
    const errand = await (await b.req(`${flow.courier}/app/errands?e=${claims.visa.id}`)).text();
    assert.match(errand, /pays with saved PayPal/);
    assert.match(errand, /Paid with saved PayPal/);

    // Calling the courier back deletes the saved PayPal at PayPal.
    assert.equal((await b.req(`${flow.courier}/app/visas/${claims.visa.id}/revoke`, { form: {} })).status, 303);
    const after = await (await b.req(`${flow.courier}/app/errands?e=${claims.visa.id}`)).text();
    assert.match(after, /Saved PayPal removed/);
    await chat.close();
  },
);

await step("Not saving PayPal is fine: the errand goes ahead and purchases get a PayPal page", async () => {
  const out = await authorize(flow, new Browser(), "malik", {
    decision: "approve",
    scopes: ["store:browse", "store:buy"],
    spend_limit: "60",
    per_purchase_limit: "40",
    duration: "1h",
    intent: "Jazz records",
    autopay: "1",
    autopay_decision: "cancel",
  });
  const claims = decode(out.tokens.access_token);
  assert.equal(claims.visa.autopay, false);
  const chat = await mcpClient(out.tokens.access_token);
  const buy = await chat.callTool({ name: "request_purchase", arguments: { item_ids: ["jr-030"] } });
  assert.ok(structured(buy).approve_url, JSON.stringify(buy));
  await chat.close();
});

await step("Bonded visa: $5 hold authorized; merchant report suspends the visa and captures the bond", async () => {
  const out = await authorize(flow, browser, "ada", {
    decision: "approve",
    scopes: ["store:browse", "store:buy"],
    spend_limit: "30",
    per_purchase_limit: "30",
    duration: "1h",
    intent: "",
    bond: "1",
  });
  const claims = decode(out.tokens.access_token);
  assert.equal(claims.visa.bond.status, "authorized");
  const report = await fetch(`${STORE}/merchant/report/${claims.visa.id}`, { method: "POST", redirect: "manual" });
  assert.equal(report.status, 303);
  const page = await (await browser.req(`${flow.courier}/app/errands?e=${claims.visa.id}`)).text();
  assert.match(page, /bond captured/);
});

await step("Release the bots: every attack is blocked or flagged", async () => {
  const res = await fetch(`${flow.courier}/bots/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const { results } = await res.json();
  for (const r of results) console.log(`      ${r.outcome.padEnd(8)} ${r.name}: ${r.detail}`);
  assert.ok(
    results.every((r: any) => r.outcome !== "allowed"),
    "no attack may be allowed",
  );
});

console.log(`\n${passed} steps passed.\n`);
process.exit(0);
