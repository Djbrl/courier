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
  async req(url: string, init: { method?: string; form?: Record<string, string | string[]>; json?: unknown } = {}) {
    let body: string | undefined;
    const headers: Record<string, string> = { cookie: this.cookieHeader() };
    if (init.form) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(init.form))
        for (const one of ([] as string[]).concat(v)) params.append(k, one);
      body = params.toString();
      headers["content-type"] = "application/x-www-form-urlencoded";
    }
    if (init.json !== undefined) {
      body = JSON.stringify(init.json);
      headers["content-type"] = "application/json";
    }
    const res = await fetch(url, {
      method: init.method ?? (body === undefined ? "GET" : "POST"),
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

async function mcpClient(token: string, answer?: (message: string) => string, address = MCP) {
  // With `answer`, the client can show dialogs (MCP elicitation), as Claude does; `answer` plays the person.
  const client = new Client(
    { name: "e2e", version: "1" },
    answer ? { capabilities: { elicitation: { form: {} } } } : undefined,
  );
  if (answer)
    client.setRequestHandler(ElicitRequestSchema, async (req) => ({
      action: "accept",
      content:
        "requestedSchema" in req.params && req.params.requestedSchema.properties.budget
          ? { budget: Number(answer(req.params.message)) }
          : { answer: answer(req.params.message) },
    }));
  await client.connect(
    new StreamableHTTPClientTransport(new URL(address), {
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

async function discover(address = MCP): Promise<Flow> {
  const res = await fetch(address, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(res.status, 401);
  const www = res.headers.get("www-authenticate") ?? "";
  const prmUrl = www.match(/resource_metadata="([^"]+)"/)?.[1];
  assert.ok(prmUrl, "resource_metadata in WWW-Authenticate");
  const prm = await (await fetch(prmUrl!)).json();
  assert.equal(prm.resource, address);
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
  opts: { refused?: boolean; resource?: string; yes?: Record<string, string> } = {},
) {
  const resource = opts.resource ?? MCP;
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
    resource,
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
  if (opts.refused) return { refusal: await cb.text(), cbStatus: cb.status };
  assert.equal(cb.status, 302, "callback should redirect to consent");
  assert.ok(cb.headers.get("location")!.includes(`/consent/${reqId}`));

  // First time: the person names a courier in the middle of connecting, and comes straight back.
  const ask = await browser.req(`${flow.courier}/consent/${reqId}`);
  if (ask.status === 302) {
    assert.match(ask.headers.get("location")!, /\/start\/courier\?req=/);
    const made = await browser.req(`${flow.courier}/start/courier`, {
      form: { name: "Juno", human: "Maya", color: "cobalt", req: reqId },
    });
    assert.equal(made.status, 303);
    assert.ok(made.headers.get("location")!.includes(`/consent/${reqId}`));
  }

  // One yes, and the agent gets its code: no ticket, no PayPal page.
  const consent = await browser.req(`${flow.courier}/consent/${reqId}`, {
    form: { decision: "approve", ...opts.yes },
  });
  assert.equal(consent.status, 302);
  const back = new URL(consent.headers.get("location")!);
  assert.equal(back.origin + back.pathname, REDIRECT);
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
      resource,
    }),
  });
  const tokens = await tokenRes.json();
  assert.equal(tokenRes.status, 200, JSON.stringify(tokens));
  return { tokens, reqId };
}

/** The agent asks to hold something, gets a ticket link, and the person sends the ticket from it. */
async function writeTicket(browser: Browser, token: string, ticket: Record<string, string | string[]>) {
  const chat = await mcpClient(token);
  const asked = await chat.callTool({ name: "hold_item", arguments: { item_id: "jr-002" } });
  const url = String(structured(asked).ticket_url);
  assert.equal(structured(asked).decision, "needs_ticket", JSON.stringify(asked));

  let followed: { res: Response; location: string | null; url?: string } = await browser.follow(url, "http://none/", {
    form: ticket,
  });
  if (ticket.autopay) {
    // Saved PayPal: we're on the simulator's "Save PayPal" page; agree (or cancel).
    const setupId = followed.url!.split("/sim-paypal/vault/")[1];
    assert.ok(setupId, `expected the Save PayPal page, got ${followed.url}`);
    followed = await browser.follow(`${new URL(url).origin}/sim-paypal/vault/${setupId}`, "http://none/", {
      form: { decision: String(ticket.autopay_decision ?? "approve") },
    });
  }
  if (ticket.bond) {
    // Bond: we're on the simulator's approval page; approve the hold.
    const orderId = followed.url!.split("/sim-paypal/checkout/")[1];
    followed = await browser.follow(`${new URL(url).origin}/sim-paypal/checkout/${orderId}`, "http://none/", {
      form: { decision: "approve" },
    });
  }
  assert.match(await followed.res.text(), /has its budget/);
  await new Promise((r) => setTimeout(r, 3200)); // the shop caches a connection's standing for 3 seconds
  const who = structured(await chat.callTool({ name: "whoami", arguments: {} }));
  await chat.close();
  assert.ok(who.visa, "the ticket should be live on the next call");
  return who.visa;
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
  const out = await authorize(flow, new Browser(), "sam", { refused: true });
  assert.match(out.refusal!, /isn&#39;t verified|isn't verified/);
});

await step("Try with simulated PayPal: a new demo person, marked so in what shops are told", async () => {
  const browser = new Browser();
  const started = await browser.req(`${flow.courier}/auth/demo`, { form: { next: "/start/courier" } });
  assert.equal(started.status, 303);
  assert.equal(started.headers.get("location"), "/start/courier");
  const page = await browser.req(`${flow.courier}/start/courier`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Demo: simulated/);

  const elsewhere = await browser.req(`${flow.courier}/auth/demo`, { form: { next: "//evil.example" } });
  assert.equal(elsewhere.headers.get("location"), "/app");
  // A made-up person from the demo sign-in gives their name, and nothing else: each press is still a new person.
  const picker = await (await new Browser().req(`${flow.courier}/start/paypal`)).text();
  assert.equal((picker.match(/name="persona"/g) ?? []).length, 3, "three demo people to pick from");
  const amara = new Browser();
  await amara.req(`${flow.courier}/auth/demo`, { form: { next: "/start/courier", persona: "amara" } });
  assert.match(await (await amara.req(`${flow.courier}/start/courier`)).text(), /name="human" value="Amara"/);
  const odd = new Browser();
  await odd.req(`${flow.courier}/auth/demo`, { form: { next: "/start/courier", persona: "<script>" } });
  assert.match(await (await odd.req(`${flow.courier}/start/courier`)).text(), /name="human" value=""/);
});

await step("The errand room: chats side by side, at any shop, and only the person sets a budget", async () => {
  const person = new Browser();
  await person.req(`${flow.courier}/auth/demo`, { form: { next: "/start/courier" } });
  const made = await person.req(`${flow.courier}/start/courier`, {
    form: { name: "Rail", human: "Jo", color: "cobalt" },
  });
  const courierId = new URL(made.headers.get("location")!, flow.courier).searchParams.get("c")!;

  // The last step offers the dashboard or Claude, and the dashboard opens on the first look around, which runs once.
  const claude = await (await person.req(`${flow.courier}/start/claude?c=${courierId}&first=1`)).text();
  assert.match(claude, /href="\/app\?c=[^"]*welcome=1"><b>Try it here<\/b>/, "try it here opens the dashboard");
  assert.match(claude, /href="\/start\/claude\?c=[^"]*step=1&amp;first=1"/, "or set up Claude");
  assert.doesNotMatch(claude, />Step \d of 3/, "the progress lines say the step; no words do");
  assert.match(await (await person.req(`${flow.courier}/app`)).text(), /id="tour"/);
  assert.doesNotMatch(await (await person.req(`${flow.courier}/app`)).text(), /id="tour"/);

  const room = await (await person.req(`${flow.courier}/errand?c=${courierId}`)).text();
  assert.doesNotMatch(room, /Set the budget/);
  // Every page's own files get a version once, including one that already has it.
  const home = await new Browser().req(`${flow.courier}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /href="\/assets\/landing\.css\?v=[0-9a-f]+"/);
  // A deploy never meets a browser's cached copy of the page's script.
  assert.match(room, /src="\/assets\/errand\.js\?v=[0-9a-f]{8}"/);
  assert.match(room, /href="\/app\/shops">20 shops Rail can reach/, "the shops are one link, not a row of icons");

  const url = (path: string) => `${flow.courier}/errand/api/${path}${path.includes("?") ? "&" : "?"}c=${courierId}`;
  const api = async (path: string, body: unknown) => {
    const res = await person.req(url(path), { json: body });
    return { status: res.status, ...(await res.json()) };
  };
  const view = async (id: string) => (await person.req(url(`chats/${id}`))).json() as any;
  const newChat = async () => (await api("chats", {})).chat.id as string;
  const settled = async (id: string) => {
    for (let i = 0; i < 200; i++) {
      const out = await view(id);
      if (!out.chat.working) return out;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("the courier never finished");
  };
  const say = async (id: string, message: string) => {
    const before = (await view(id)).chat.events.length;
    assert.equal((await api("chat", { chat: id, message })).status, 200);
    const out = await settled(id);
    return { ...out, fresh: out.chat.events.slice(before) };
  };
  const cards = (out: any) => out.fresh.filter((e: any) => e.t === "pay");

  // Nothing is bought until the person names a budget, and it's read in code.
  const burgers = await newChat();
  const asked = await say(burgers, "A burger");
  assert.equal(asked.chat.amounts, true, JSON.stringify(asked.fresh));
  assert.equal(asked.chat.errand, null);

  // However they write it: "15$" counts as much as "$15".
  const first = await say(burgers, "15$");
  assert.equal(first.chat.errand.limitCents, 1500, JSON.stringify(first.fresh));
  const pay = cards(first)[0];
  assert.equal(pay.shop_slug, "floor-dash", JSON.stringify(first.fresh));
  assert.ok(pay.approve_url.includes("/sim-paypal/checkout/"));
  assert.ok(pay.callBackUntil > Date.now());
  assert.ok(pay.items[0].category, "items carry what the window draws their picture from");

  // Paying finishes the errand. Asking twice at once writes one receipt.
  await person.follow(pay.approve_url, "http://none/", { form: { decision: "approve" } });
  const orderUrl = url(`order/${pay.order_id}?chat=${burgers}`);
  await Promise.all([person.req(orderUrl), person.req(orderUrl)]);
  const paid = await view(burgers);
  assert.equal(paid.chat.events.filter((e: any) => e.t === "receipt").length, 1);
  assert.equal(paid.chat.events.at(-1).text, "All done. Let me know if you need anything else.");
  assert.equal(paid.chat.errand.open, false);
  assert.ok(paid.chat.errand.spentCents > 0);

  // Another chat is another errand, and they can run side by side.
  const novels = await newChat();
  const shoes = await newChat();
  assert.notEqual(novels, burgers);
  assert.equal(shoes, novels, "an empty chat is reused");
  const other = await newChat().then(async (id) => {
    await api("chat", { chat: id, message: "A good novel, under $20" });
    const second = await newChat();
    assert.notEqual(second, id);
    await api("chat", { chat: second, message: "Flowers for my mum, budget 25" });
    return [await settled(id), await settled(second)];
  });
  const [novel, flowers] = other;
  assert.equal(novel.chat.errand.what, "A good novel");
  assert.equal(novel.chat.errand.limitCents, 2000);
  assert.equal(flowers.chat.errand.limitCents, 2500);
  assert.equal(flowers.list.filter((t: any) => t.errand).length, 3);

  // Calling back undoes the purchase in time: nothing charged, budget free.
  const held = novel.chat.events.find((e: any) => e.t === "pay");
  assert.equal((await api("callback", { chat: novel.chat.id, order: held.order_id })).status, 200);
  const back = await view(novel.chat.id);
  assert.equal(back.chat.events.find((e: any) => e.t === "pay").status, "called_back");
  assert.equal(back.chat.errand.remainingCents, 2000);

  // Carrying on in the chat ends the time to call back, in code.
  const flowerCard = flowers.chat.events.find((e: any) => e.t === "pay");
  await say(flowers.chat.id, "What does Mike have?");
  assert.equal((await api("callback", { chat: flowers.chat.id, order: flowerCard.order_id })).status, 409);

  // Changing the budget is the person's click. It can't go below what's used, or past the limits.
  const errand = back.chat.errand.id;
  const budget = (dollars: string) => api("budget", { chat: novel.chat.id, errand, dollars });
  assert.equal((await budget("900")).status, 400);
  assert.equal((await budget("30")).chat.errand.limitCents, 3000);

  // What doesn't fit is refused in code.
  const small = await say(await newChat(), "Running shoes, budget 2");
  assert.equal(cards(small).length, 0, JSON.stringify(small.fresh));

  // Several things are one errand, with a helper for each and a card for each.
  const several = await say(await newChat(), "A burger, flowers and a good novel, budget $60");
  assert.equal(several.chat.errand.limitCents, 6000);
  assert.equal(cards(several).length, 3, JSON.stringify(several.fresh));

  // Browsing needs no errand. A price isn't a budget.
  const browsing = await newChat();
  const browse = await say(browsing, "What does Mike have?");
  assert.ok(browse.fresh.some((e: any) => e.t === "items" && e.results.length));
  assert.equal(browse.chat.errand, null);
  const priced = await say(browsing, "Buy the $149 turntable");
  assert.equal(priced.chat.amounts, true, JSON.stringify(priced.fresh));

  // Picking an item with a fixed price is enough: its price sets the budget, read from the shop.
  const picked = await say(await newChat(), "Get Double Smash Burger from Floor Dash");
  assert.equal(picked.chat.amounts, false, JSON.stringify(picked.fresh));
  assert.equal(picked.chat.errand.limitCents, 1200);
  assert.equal(cards(picked)[0].total, "11.50");
  await person.follow(cards(picked)[0].approve_url, "http://none/", { form: { decision: "approve" } });
  const ticket = (await (
    await person.req(url(`order/${cards(picked)[0].order_id}?chat=${picked.chat.id}`))
  ).json()) as any;
  assert.equal(ticket.chat.events.filter((e: any) => e.t === "receipt").length, 1);
  assert.equal(ticket.chat.amounts, false);

  // Asking in words calls back what's unpaid, though carrying on in the chat ended the button's time.
  const changed = await say(await newChat(), "Get Double Smash Burger from Floor Dash");
  const off = await say(changed.chat.id, "actually, call that off");
  const offCard = off.chat.events.find((e: any) => e.t === "pay");
  assert.equal(offCard.status, "called_back", JSON.stringify(off.fresh));
  assert.equal(off.chat.errand.remainingCents, off.chat.errand.limitCents);

  // A saved cap holds for budgets typed in the room too, and says where to change it.
  await person.req(`${flow.courier}/app/settings/cap`, { form: { cap_errand: "40", cap_day: "100" } });
  const over = await say(browsing, "$80");
  assert.match(over.fresh.at(-1).text, /over your \$40 cap per errand.*Settings/);
  assert.equal(over.chat.errand, null);

  // A past errand opens its chat from its page. Deleting the chat ends its errand; the record stays.
  const history = await (await person.req(`${flow.courier}/app/errands`)).text();
  const pages = [...history.matchAll(/href="(\/app\/errands\?e=[^"]+)"/g)].map((m) => m[1]!);
  const opened = await Promise.all(pages.map(async (p) => (await person.req(`${flow.courier}${p}`)).text()));
  assert.ok(
    opened.some((p) => p.includes(`chat=${burgers}`)),
    "a past errand links to its chat",
  );
  const gone = await api("delete", { chat: several.chat.id });
  assert.equal(gone.status, 200);
  assert.equal((await person.req(url(`chats/${several.chat.id}`))).status, 404);

  // A revoked courier ends its errands and starts no more, until it's restored.
  await person.req(`${flow.courier}/app/couriers/${courierId}/revoke`, { form: {} });
  const revoked = await say(await newChat(), "A burger, budget 20");
  assert.match(revoked.fresh.at(-1).text, /revoked/);
  assert.equal((await view(flowers.chat.id)).chat.errand.open, false);
  await person.req(`${flow.courier}/app/couriers/${courierId}/restore`, { form: {} });

  // The room's own link to the shops isn't a Claude the person connected.
  assert.match(await (await person.req(`${flow.courier}/app/settings`)).text(), /Not connected yet/);
  // A stranger can't see this courier's chat.
  assert.equal((await new Browser().req(url(`chats/${burgers}`))).status, 401);

  // The room is a demo with free messages. They're counted per person, so a new or deleted chat doesn't give any back.
  const welcomed = await (await person.req(`${flow.courier}/errand?c=${courierId}`)).text();
  assert.match(welcomed, /welcome to the Courier demo/);
  assert.match(welcomed, /connecting Courier’s MCP server/);
  const spending = await newChat();
  let left = (await view(spending)).left as number;
  assert.ok(left > 0 && left < 50, "earlier messages counted");
  const sent = await api("chat", { chat: spending, message: "What does Mike have?" });
  assert.equal(sent.left, left - 1);
  while (left-- > 1) await api("chat", { chat: spending, message: "What does Mike have?" });
  const done = await settled(spending);
  assert.equal(done.left, 0);
  const refused = await api("chat", { chat: spending, message: "One more?" });
  assert.equal(refused.status, 429);
  assert.notEqual((await view(spending)).chat.events.at(-1).text, "One more?");
  assert.equal((await api("delete", { chat: spending })).status, 200);
  assert.equal((await view(await newChat())).left, 0);
});

await step("Chipping in: each person pays their own share, and their limits stay with their courier", async () => {
  const person = new Browser();
  await person.req(`${flow.courier}/auth/demo`, { form: { next: "/start/courier" } });
  const made = await person.req(`${flow.courier}/start/courier`, {
    form: { name: "Juno", human: "Maya", color: "cobalt" },
  });
  const courierId = new URL(made.headers.get("location")!, flow.courier).searchParams.get("c")!;

  const people = await (await person.req(`${flow.courier}/app/people`)).text();
  for (const name of ["Leo", "Priya", "Noor"]) assert.match(people, new RegExp(`<b>${name}</b>`));
  assert.doesNotMatch(people, /\$50|\$40|\$25/, "what each can put in is their courier's to know");
  const invited = await (
    await person.req(`${flow.courier}/errand?c=${courierId}&say=${encodeURIComponent("Chip in with Leo on a gift")}`)
  ).text();
  assert.match(invited, /invite people to an errand/);
  assert.match(invited, /"draft":"Chip in with Leo on a gift"/);

  const url = (path: string) => `${flow.courier}/errand/api/${path}${path.includes("?") ? "&" : "?"}c=${courierId}`;
  const api = async (path: string, body: unknown) => (await person.req(url(path), { json: body })).json() as any;
  const view = async (id: string) => (await person.req(url(`chats/${id}`))).json() as any;
  const until = async (id: string, done: (out: any) => boolean) => {
    for (let i = 0; i < 200; i++) {
      const out = await view(id);
      if (done(out)) return out;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("the chat never got there");
  };
  const say = async (id: string, message: string) => {
    const before = (await view(id)).chat.events.length;
    await api("chat", { chat: id, message });
    const out = await until(id, (o) => !o.chat.working);
    return { ...out, fresh: out.chat.events.slice(before) };
  };
  const payUp = async (id: string, card: any) => {
    await person.follow(card.approve_url, "http://none/", { form: { decision: "approve" } });
    await person.req(url(`order/${card.order_id}?chat=${id}`));
    const out = await until(id, (o) => o.chat.events.some((e: any) => e.t === "group"));
    return out.chat.events.find((e: any) => e.t === "group");
  };

  const chat = (await api("chats", {})).chat.id;
  const stranger = await say(chat, "Chip in with Bob on the Late Night Jazz box set");
  assert.match(stranger.fresh.find((e: any) => e.t === "say").text, /Bob isn't one of their contacts.*Leo \(brother/);

  // Leo can only put in $50 of an even $60, so Maya would cover $10. She's asked before anything starts.
  const offer = await say(chat, "Chip in with Leo on the Late Night Jazz box set");
  assert.equal(offer.chat.confirm, true, JSON.stringify(offer.fresh));
  assert.equal(offer.chat.errand, null);
  const yes = await say(chat, "Go ahead");
  assert.equal(yes.chat.errand.limitCents, 7000);
  const card = yes.fresh.find((e: any) => e.t === "pay");
  assert.equal(card.total, "70.00");
  assert.ok(card.group);
  const ticket = await payUp(chat, card);
  assert.equal(ticket.total, "120.00");
  assert.deepEqual(
    ticket.payers.map((p: any) => [p.name, p.cents, p.paid]),
    [
      ["You", 7000, true],
      ["Leo", 5000, true],
    ],
  );
  assert.match((await view(chat)).chat.events.at(-1).text, /Everyone’s paid/);
  // Leo has nobody at the keyboard, so Otto's side of the thread is scripted: in, short of an even split, then paid.
  const thread = await until(chat, (o) =>
    o.chat.run?.lines.some((l: any) => l.courier === "Otto" && /All square/.test(l.text ?? "")),
  );
  const said = thread.chat.run.lines.map((l: any) => `${l.t}:${l.courier}:${l.text ?? l.total ?? ""}`);
  assert.ok(
    said.some((l: string) => /^joined:Otto/.test(l)),
    said.join("\n"),
  );
  assert.ok(
    said.some((l: string) => /^say:Otto:.*can put in \$50/.test(l)),
    said.join("\n"),
  );
  assert.ok(
    said.some((l: string) => /^paid:Otto:50/.test(l)),
    said.join("\n"),
  );

  // An even split that fits everyone, on an item they named, goes straight to paying.
  const three = (await api("chats", {})).chat.id;
  const even = await say(three, "Chip in with Leo and Priya on the Late Night Jazz box set");
  const share = even.fresh.find((e: any) => e.t === "pay");
  assert.equal(share?.total, "40.00", JSON.stringify(even.fresh));
  const split = await payUp(three, share);
  assert.deepEqual(
    split.payers.map((p: any) => p.cents),
    [4000, 4000, 4000],
  );
  assert.ok(split.payers.every((p: any) => p.paid));
});

await step("Runs: friends are asked by name, couriers pass things on, and each person pays their own", async () => {
  /** One person in their own browser, with a courier and their own view of the errand room. */
  const someone = async (name: string, courier: string, next = "/start/courier") => {
    const browser = new Browser();
    await browser.req(`${flow.courier}/auth/demo`, { form: { next } });
    const made = await browser.req(`${flow.courier}/start/courier`, {
      form: { name: courier, human: name, color: "cobalt" },
    });
    const id = new URL(made.headers.get("location")!, flow.courier).searchParams.get("c")!;
    return roomOf(browser, id);
  };
  const roomOf = (browser: Browser, id: string) => {
    const url = (path: string) => `${flow.courier}/errand/api/${path}${path.includes("?") ? "&" : "?"}c=${id}`;
    const view = async (chat: string) => (await browser.req(url(`chats/${chat}`))).json() as any;
    const until = async (chat: string, done: (out: any) => boolean) => {
      for (let i = 0; i < 200; i++) {
        const out = await view(chat);
        if (done(out)) return out;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error(`chat ${chat} never got there: ${JSON.stringify((await view(chat)).chat.events.slice(-3))}`);
    };
    return {
      browser,
      id,
      url,
      view,
      until,
      blank: async () => ((await (await browser.req(url("chats"), { json: {} })).json()) as any).chat.id as string,
      say: async (chat: string, message: string) => {
        await browser.req(url("chat"), { json: { chat, message } });
        return until(chat, (o) => !o.chat.working);
      },
      pay: async (chat: string, card: any) => {
        await browser.follow(card.approve_url, "http://none/", { form: { decision: "approve" } });
        await browser.req(url(`order/${card.order_id}?chat=${chat}`));
      },
    };
  };
  const chatIn = (location: string | null) => new URL(location!, flow.courier).searchParams.get("chat")!;

  // Luna adds Maya with Maya's own link. A made-up link goes nowhere.
  const maya = await someone("Maya", "Juno");
  const people = await (await maya.browser.req(`${flow.courier}/app/people`)).text();
  const link = /\/friend\/[\w-]+/.exec(people)![0];
  assert.equal((await maya.browser.req(`${flow.courier}/friend/not-a-real-token-at-all`)).status, 404);
  const luna = await someone("Luna", "Nova", link);
  assert.match(await (await luna.browser.req(`${flow.courier}${link}`)).text(), /Add Maya/);
  await luna.browser.req(`${flow.courier}${link}`, { method: "POST" });
  assert.match(
    await (await maya.browser.req(`${flow.courier}/app/people`)).text(),
    /<span class="fr-tag">Nova<\/span>[\s\S]*?<b>Luna<\/b><small>On Courier/,
  );

  // Maya's courier asks Luna by name; Luna sees it in her own Courier and joins.
  const mine = await maya.blank();
  const asked = await maya.say(mine, "Invite Luna for coffee at Beanbucks");
  const card = asked.chat.events.find((e: any) => e.t === "invite");
  assert.match(card.url, /\/run\/[\w-]+$/);
  assert.deepEqual(asked.chat.run.invited, ["Luna"]);
  const hers = await luna.blank();
  const pending = (await luna.view(hers)).invites;
  assert.equal(pending[0]?.from, "Maya");
  const page = await (await luna.browser.req(`${flow.courier}${pending[0].url}`)).text();
  assert.match(page, /Maya invited you/);
  assert.match(page, /Join with Nova/);
  const joined = await luna.browser.req(`${flow.courier}${pending[0].url}/join`, { form: { c: luna.id } });
  const lunaChat = chatIn(joined.headers.get("location"));
  await maya.until(mine, (o) => o.chat.events.some((e: any) => e.t === "run" && /Luna joined/.test(e.text)));
  assert.equal((await luna.view(lunaChat)).invites.length, 0);

  // What Luna says reaches Maya through the couriers' thread. A number in it is never Maya's budget.
  await luna.say(lunaChat, "tell them a flat white for me, and $90 is fine");
  const relayed = await maya.until(mine, (o) =>
    o.chat.events.some((e: any) => e.t === "them" && e.name === "Nova" && /flat white/.test(e.text)),
  );
  assert.ok(relayed.chat.events.find((e: any) => e.t === "them").face, "with Nova's face");
  assert.equal(relayed.chat.pendingBudgetCents, null);
  assert.equal(relayed.chat.run.lines.filter((l: any) => l.t === "say").length, 1);

  // Each pays their own, and the run shows who has.
  const got = await luna.say(lunaChat, "Get Flat White from Beanbucks");
  const lunaCard = got.chat.events.find((e: any) => e.t === "pay");
  assert.equal(lunaCard.total, "4.20");
  await luna.pay(lunaChat, lunaCard);
  const after = await maya.until(mine, (o) =>
    o.chat.events.some((e: any) => e.t === "run" && /Luna paid \$4\.20/.test(e.text)),
  );
  assert.deepEqual(
    after.chat.run.members.map((m: any) => [m.name, m.state]),
    [
      ["Maya", "none"],
      ["Luna", "paid"],
    ],
  );
  assert.ok((await luna.view(lunaChat)).chat.events.some((e: any) => e.t === "receipt"));

  // Someone with only the link comes in signed out, as a demo person, and names a courier on the way.
  const sam = new Browser();
  const runPath = new URL(card.url).pathname;
  assert.match(await (await sam.req(`${flow.courier}${runPath}`)).text(), /Join as a demo person/);
  await sam.req(`${flow.courier}/auth/demo`, { form: { next: runPath } });
  assert.match(await (await sam.req(`${flow.courier}${runPath}`)).text(), /Name your courier/);
  const samIn = await sam.req(`${flow.courier}${runPath}/join`, { form: { human: "Sam", name: "Pip" } });
  assert.match(samIn.headers.get("location")!, /\/errand\?c=.+&chat=/);
  const three = await maya.until(mine, (o) => o.chat.run.members.length === 3);
  assert.deepEqual(
    three.chat.run.members.map((m: any) => m.courier),
    ["Juno", "Nova", "Pip"],
  );
  // Opening the link again goes back to their own chat, not in twice.
  const again = await sam.req(`${flow.courier}${runPath}`);
  assert.equal(chatIn(again.headers.get("location")), chatIn(samIn.headers.get("location")));
  assert.equal((await maya.view(mine)).chat.run.members.length, 3);

  // Luna is done: she leaves, the others hear so, and her chat takes nothing more.
  const ended = (await (await luna.browser.req(luna.url("end"), { json: { chat: lunaChat } })).json()) as any;
  assert.equal(ended.chat.ended, true);
  assert.ok(ended.chat.events.some((e: any) => e.t === "ended"));
  const heard = await maya.until(mine, (o) =>
    o.chat.events.some((e: any) => e.t === "run" && /Luna left/.test(e.text)),
  );
  assert.deepEqual(
    heard.chat.run.members.map((m: any) => [m.name, m.left]),
    [
      ["Maya", false],
      ["Luna", true],
      ["Sam", false],
    ],
  );
  assert.equal((await luna.browser.req(luna.url("chat"), { json: { chat: lunaChat, message: "hello?" } })).status, 409);
  assert.equal(ended.list.find((t: any) => t.id === lunaChat).ended, true);
});

await step("Under-18 PayPal account is refused", async () => {
  const out = await authorize(flow, new Browser(), "riley", { refused: true });
  assert.match(out.refusal!, /for adults/);
});

await step("Connecting takes one yes, with no ticket or payment (PKCE + resource + iss)", async () => {
  const out = await authorize(flow, browser, "ada");
  tokens = out.tokens;
  const claims = decode(tokens.access_token);
  assert.equal(claims.aud, MCP);
  assert.equal(claims.human.verified, true);
  assert.match(claims.sub, /^pp_/);
  assert.equal(claims.visa, undefined, "a connection carries no limits");
  assert.equal(claims.connection.agent, "Juno");
  assert.ok(!JSON.stringify(claims).includes("SIMPAYER"), "no PayPal id leaks to the merchant");
});

await step(
  "Connected without a ticket: it can browse, and holding or buying gets a prefilled ticket link",
  async () => {
    const chat = await mcpClient(tokens.access_token);
    const who = structured(await chat.callTool({ name: "whoami", arguments: {} }));
    assert.equal(who.visa, null);
    assert.equal(who.agent, "Juno");
    const search = await chat.callTool({ name: "search_catalog", arguments: { query: "jazz", max_price: 40 } });
    assert.ok(structured(search).results.length > 0);
    const buy = await chat.callTool({
      name: "request_purchase",
      arguments: {
        item_ids: ["jr-002"],
        ticket_hint: { purpose: "Jazz for <b>dad</b>", max_per_item: 35, max_total: 5000 },
      },
    });
    const sc = structured(buy);
    assert.equal(sc.decision, "needs_ticket", JSON.stringify(buy));
    const page = await (await browser.req(sc.ticket_url)).text();
    assert.match(page, /value="Jazz for &lt;b&gt;dad&lt;\/b&gt;"/, "the agent's text is escaped");
    assert.match(page, /name="spend_limit"[^>]*value="500"/, "suggestions are capped");
    const stranger = await new Browser().req(sc.ticket_url);
    assert.equal(stranger.status, 302, "signed out: sign in first");
    await chat.close();
  },
);

await step("The ticket goes live on the agent's next call, with no reconnecting", async () => {
  const visa = await writeTicket(browser, tokens.access_token, {
    decision: "approve",
    scopes: ["store:browse", "store:reserve", "store:buy"],
    spend_limit: "60",
    per_purchase_limit: "40",
    duration: "24h",
    intent: "Jazz records for my dad",
  });
  assert.equal(visa.spend_limit.value, "60.00");
  visaId = visa.id;
});

await step("MCP: list tools and whoami over MCP", async () => {
  client = await mcpClient(tokens.access_token);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "cancel_order",
    "get_item",
    "hold_item",
    "order_status",
    "request_purchase",
    "search_catalog",
    "set_budget",
    "wait_for_budget",
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
  const home = await (await browser.req(`${flow.courier}/app`)).text();
  assert.match(home, /Jazz records for my dad/);
  assert.match(home, /In any Claude chat/, "connected, so home says where to ask instead of offering to connect");
  const detail = await (await browser.req(`${flow.courier}/app/errands?e=${visaId}`)).text();
  assert.match(detail, /Bought Saltwater Standards/);
});

await step("A stranger can't cancel someone else's errand through the bond link", async () => {
  await fetch(`${flow.courier}/bond/cancel?visa=${visaId}`, { redirect: "manual" });
  const page = await (await browser.req(`${flow.courier}/app/errands?e=${visaId}`)).text();
  assert.match(page, /End errand/);
});

await step("Ending the errand takes effect within seconds; Claude stays connected but can't buy", async () => {
  const res = await browser.req(`${flow.courier}/app/visas/${visaId}/revoke`, { form: {} });
  assert.equal(res.status, 303);
  await new Promise((r) => setTimeout(r, 3200));
  const chat = await mcpClient(tokens.access_token);
  const buy = await chat.callTool({ name: "request_purchase", arguments: { item_ids: ["jr-002"] } });
  assert.equal(structured(buy).decision, "needs_ticket", JSON.stringify(buy));
  await chat.close();
});

await step(
  "With no purpose to check against, anything inside the budget goes through, and the limit still holds",
  async () => {
    const visa = await writeTicket(browser, tokens.access_token, {
      decision: "approve",
      scopes: ["store:browse", "store:reserve", "store:buy"],
      spend_limit: "30",
      per_purchase_limit: "30",
      duration: "24h",
      intent: "",
    });
    const chat = await mcpClient(tokens.access_token);
    const slipmat = await chat.callTool({ name: "search_catalog", arguments: { query: "slipmat" } });
    const id = String((structured(slipmat).results as { id: string }[])[0]!.id);
    const buy = structured(await chat.callTool({ name: "request_purchase", arguments: { item_ids: [id] } }));
    assert.ok(buy.approve_url, JSON.stringify(buy));
    const over = structured(await chat.callTool({ name: "request_purchase", arguments: { item_ids: ["jr-023"] } }));
    assert.equal(over.decision, "deny", JSON.stringify(over));
    await chat.close();
    const res = await browser.req(`${flow.courier}/app/visas/${visa.id}/revoke`, { form: {} });
    assert.equal(res.status, 303);
    await new Promise((r) => setTimeout(r, 3200));
  },
);

await step("Only the card can set a budget in the chat: the model has no pass, and passes work once", async () => {
  const chat = await mcpClient(tokens.access_token);
  const { tools } = await chat.listTools();
  const hidden = tools.find((t) => t.name === "set_budget");
  assert.deepEqual((hidden?._meta?.ui as { visibility?: string[] })?.visibility, ["app"]);
  assert.ok(tools.some((t) => t.name === "wait_for_budget"));
  const refused = await chat.callTool({ name: "set_budget", arguments: { budget: 400, pass: "made-up" } });
  assert.equal(refused.isError, true);
  const buy = await chat.callTool({
    name: "request_purchase",
    arguments: { item_ids: ["jr-002"], ticket_hint: { max_total: 35 } },
  });
  const sc = structured(buy);
  assert.equal(sc.decision, "needs_ticket");
  assert.equal(sc.suggested_budget, 35);
  const pass = String(buy._meta?.["courier/budget_pass"]);
  assert.ok(pass.length > 16);
  // The model reads the text and maybe the structured part. The pass is in neither.
  assert.ok(!JSON.stringify([buy.content, buy.structuredContent]).includes(pass));
  const set = structured(await chat.callTool({ name: "set_budget", arguments: { budget: 35, pass } }));
  assert.match(String(set.url), /\/consent\/.+pay=1/);
  const again = await chat.callTool({ name: "set_budget", arguments: { budget: 35, pass } });
  assert.equal(again.isError, true);
  await chat.close();
});

await step(
  "Saved PayPal: one OK on the ticket, then purchases are paid straight away; it outlives the errand until removed",
  async () => {
    const b = browser;
    const visa = await writeTicket(b, tokens.access_token, {
      decision: "approve",
      scopes: ["store:browse", "store:reserve", "store:buy"],
      spend_limit: "60",
      per_purchase_limit: "40",
      duration: "24h",
      intent: "Jazz records",
      autopay: "1",
    });
    assert.equal(visa.autopay, true);
    const waiting = await mcpClient(tokens.access_token);
    assert.equal(structured(await waiting.callTool({ name: "wait_for_budget", arguments: {} })).ready, true);
    await waiting.close();
    assert.ok(!JSON.stringify(visa).includes("VT-"), "the saved PayPal token never reaches the shop or agent");
    const asked: string[] = [];
    const chat = await mcpClient(tokens.access_token, (message) => {
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
    const receipt = await fetch(sc.receipt_url);
    assert.equal(receipt.status, 200);
    const receiptPage = await receipt.text();
    assert.match(receiptPage, /✓ Paid/);
    assert.match(receiptPage, new RegExp(sc.items[0].title));
    assert.ok(!receiptPage.includes("SIMPAYER"), "no PayPal id on the receipt");
    assert.equal((await fetch(`${STORE}/receipts/not-a-key`)).status, 404);
    const { tools: cardTools } = await chat.listTools();
    const buyTool = cardTools.find((t) => t.name === "request_purchase");
    const cardUri = String((buyTool?._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri);
    assert.match(cardUri, /^ui:\/\/courier\/receipt-[0-9a-f]+\.html$/);
    const card: any = await chat.readResource({ uri: cardUri });
    assert.match(card.contents[0].mimeType, /profile=mcp-app/);
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
    const errand = await (await b.req(`${flow.courier}/app/errands?e=${visa.id}`)).text();
    assert.match(errand, /pays with saved PayPal/);
    assert.match(errand, /Paid with saved PayPal/);

    // Calling the courier back ends the errand, and a closed errand can't pay.
    assert.equal((await b.req(`${flow.courier}/app/visas/${visa.id}/revoke`, { form: {} })).status, 303);
    await new Promise((r) => setTimeout(r, 3200));
    assert.match(await (await b.req(`${flow.courier}/app/settings`)).text(), /Saved PayPal/);

    // PayPal stays saved, so the next ticket is one question in the chat and the purchase carries on in the same call.
    const budgets: string[] = [];
    const again = await mcpClient(tokens.access_token, (message) => {
      budgets.push(message);
      return "60";
    });
    const inChat = structured(await again.callTool({ name: "request_purchase", arguments: { item_ids: ["jr-011"] } }));
    assert.equal(inChat.status, "paid", JSON.stringify(inChat));
    assert.equal(inChat.paid_with, "saved_paypal");
    assert.equal(budgets.length, 1);
    assert.match(budgets[0]!, /most it can spend/);
    assert.equal(inChat.remaining_budget, "35.00");
    await again.close();

    // Removing it in Settings stops it paying: the errand falls back to a PayPal page per purchase.
    assert.equal((await b.req(`${flow.courier}/app/paypal/remove`, { form: {} })).status, 303);
    assert.match(await (await b.req(`${flow.courier}/app/settings`)).text(), /Not saved/);
    await new Promise((r) => setTimeout(r, 3200));
    const fallback = await mcpClient(tokens.access_token);
    const byLink = structured(
      await fallback.callTool({ name: "request_purchase", arguments: { item_ids: ["jr-002"] } }),
    );
    assert.ok(byLink.approve_url, JSON.stringify(byLink));
    const open = structured(await fallback.callTool({ name: "whoami", arguments: {} })).visa;
    assert.equal((await b.req(`${flow.courier}/app/visas/${open.id}/revoke`, { form: {} })).status, 303);
    await new Promise((r) => setTimeout(r, 3200));
    await fallback.close();
    await chat.close();
  },
);

await step("Not saving PayPal is fine: the errand goes ahead and purchases get a PayPal page", async () => {
  const malik = new Browser();
  const out = await authorize(flow, malik, "malik");
  const visa = await writeTicket(malik, out.tokens.access_token, {
    decision: "approve",
    scopes: ["store:browse", "store:reserve", "store:buy"],
    spend_limit: "60",
    per_purchase_limit: "40",
    duration: "1h",
    intent: "Jazz records",
    autopay: "1",
    autopay_decision: "cancel",
  });
  assert.equal(visa.autopay, false);
  const chat = await mcpClient(out.tokens.access_token);
  const buy = await chat.callTool({ name: "request_purchase", arguments: { item_ids: ["jr-030"] } });
  assert.ok(structured(buy).approve_url, JSON.stringify(buy));
  await chat.close();
});

await step("Bonded visa: $5 hold authorized; merchant report suspends the visa and captures the bond", async () => {
  const visa = await writeTicket(browser, tokens.access_token, {
    decision: "approve",
    scopes: ["store:browse", "store:reserve", "store:buy"],
    spend_limit: "30",
    per_purchase_limit: "30",
    duration: "1h",
    intent: "",
    bond: "1",
  });
  assert.equal(visa.bond.status, "authorized");
  const report = await fetch(`${STORE}/merchant/report/${visa.id}`, { method: "POST", redirect: "manual" });
  assert.equal(report.status, 303);
  const page = await (await browser.req(`${flow.courier}/app/errands?e=${visa.id}`)).text();
  assert.match(page, /bond captured/);
});

await step("Disconnecting removes Claude: its token and refresh token stop working", async () => {
  const { id } = decode(tokens.access_token).connection;
  const home = await browser.req(`${flow.courier}/app/connections/${id}/revoke`, { form: {} });
  assert.equal(home.status, 303);
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
  const refresh = await fetch(flow.asMeta.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: flow.client.client_id,
    }),
  });
  assert.equal(refresh.status, 400);
});

await step(
  "Deleting an account ends its access and keeps its receipts, and signing in again starts from scratch",
  async () => {
    const person = new Browser();
    const first = await authorize(flow, person, "ada");
    const visa = await writeTicket(person, first.tokens.access_token, {
      decision: "approve",
      scopes: ["store:browse", "store:reserve", "store:buy"],
      spend_limit: "60",
      per_purchase_limit: "40",
      duration: "24h",
      intent: "Jazz for deleting",
      autopay: "1",
    });
    const chat = await mcpClient(first.tokens.access_token);
    const buy = structured(await chat.callTool({ name: "request_purchase", arguments: { item_ids: ["jr-011"] } }));
    assert.equal(buy.status, "paid", JSON.stringify(buy));
    await chat.close();

    assert.match(await (await person.req(`${flow.courier}/app/account/delete`)).text(), /Your 1 errand still out/);
    // Someone with no session deletes nothing: the person's errand is still there.
    assert.equal((await new Browser().req(`${flow.courier}/app/account/delete`, { form: {} })).status, 303);
    assert.match(await (await person.req(`${flow.courier}/app/errands?e=${visa.id}`)).text(), /Jazz for deleting/);

    const gone = await person.req(`${flow.courier}/app/account/delete`, { form: {} });
    assert.equal(gone.status, 303);
    assert.equal(gone.headers.get("location"), "/account-deleted");
    assert.equal(person.jar.has("courier_session"), false, "the session ends");
    await new Promise((r) => setTimeout(r, 3200));

    const raw = await fetch(MCP, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${first.tokens.access_token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "whoami", arguments: {} } }),
    });
    assert.equal(raw.status, 401, "the old token stops working");
    const refresh = await fetch(flow.asMeta.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: first.tokens.refresh_token,
        client_id: flow.client.client_id,
      }),
    });
    assert.equal(refresh.status, 400, "the old refresh token stops working");
    assert.equal((await fetch(buy.receipt_url)).status, 200, "the receipt still opens");

    // Same PayPal, new account: it's asked to name a courier again, has no history and looks new to the shop.
    const again = await authorize(flow, person, "ada");
    assert.notEqual(decode(again.tokens.access_token).sub, decode(first.tokens.access_token).sub);
    const home = await (await person.req(`${flow.courier}/app/errands`)).text();
    assert.ok(!home.includes("Jazz for deleting"), "the old errand is gone");
  },
);

/* ---------------- the one Courier connector ---------------- */

const GATEWAY = `${flow.courier}/mcp`;
const person = new Browser();
let gateway!: Client;
let gatewayToken = "";
const tool = async (name: string, args: Record<string, unknown> = {}) =>
  (await gateway.callTool({ name, arguments: args })) as any;

await step("Claude adds one connector: Courier, with a cap the person sets while connecting", async () => {
  const flowG = await discover(GATEWAY);
  const out = await authorize(flowG, person, "malik", {
    resource: GATEWAY,
    yes: { cap_errand: "30", cap_day: "50" },
  });
  gatewayToken = out.tokens.access_token;
  gateway = await mcpClient(gatewayToken, undefined, GATEWAY);
  const { tools } = await gateway.listTools();
  for (const name of ["list_shops", "search_shop", "start_errand", "wait_for_errand", "buy", "end_errand"])
    assert.ok(
      tools.some((t) => t.name === name),
      name,
    );
});

await step("Twenty shops through one connector, each browsable with no errand and known by name", async () => {
  const { shops } = structured(await tool("list_shops"));
  assert.equal(shops.length, 20);
  const found = structured(await tool("search_shop", { shop: "floor dash", query: "flowers" }));
  assert.ok(
    found.results.some((r: any) => r.id === "fd-006"),
    JSON.stringify(found),
  );
  assert.equal((await tool("search_shop", { shop: "Nowhere Mart", query: "" })).isError, true);
  const grid = await (await fetch(STORE)).text();
  for (const s of shops) assert.ok(grid.replaceAll("&amp;", "&").includes(s.name), s.name);
  assert.equal((await fetch(`${STORE}/mike`)).status, 200);
  assert.doesNotMatch(grid, /amazon|doordash|fortnite|nike\b|v-bucks/i, "parodies only");
});

await step(
  "The public pages: the landing shows the same shops, the badge back says what is shared and withheld, For shops and Install",
  async () => {
    const { shops } = structured(await tool("list_shops"));
    const landing = await (await fetch(`${flow.courier}/`)).text();
    const data = landing.match(/<script type="application\/json" id="shops-data">(.*?)<\/script>/s);
    assert.ok(data, "the landing gets its shops from the app");
    const shown = JSON.parse(data[1]!) as { slug: string }[];
    assert.deepEqual(shown.map((s) => s.slug).sort(), shops.map((s: any) => s.shop).sort());
    assert.match(landing, /<h3>Shared<\/h3>/);
    assert.match(landing, /<h3>Withheld<\/h3><p>Your personal data<\/p>/, "the back says personal data stays back");
    for (const href of ["/for-shops", "/install", "/start"]) assert.ok(landing.includes(`href="${href}"`), href);

    const forShops = await fetch(`${flow.courier}/for-shops`);
    assert.equal(forShops.status, 200);
    const shopsPage = await forShops.text();
    assert.match(shopsPage, /id="install"/);
    assert.ok(shopsPage.includes(`${flow.courier}/jwks.json`));
    const install = await fetch(`${flow.courier}/install`);
    assert.equal(install.status, 200);
    assert.match(await install.text(), /Install Courier in your/);
    const old = await fetch(`${flow.courier}/developers`, { redirect: "manual" });
    assert.equal(old.status, 301);
    assert.equal(old.headers.get("location"), "/for-shops#install");
  },
);

let flowers = "";
await step("Without saved PayPal even a small errand asks first; the person saves it once", async () => {
  // Items the person picked come with their price: code reads it, and the card starts from it.
  const found = structured(await tool("search_shop", { shop: "Floor Dash", query: "Double Smash Burger" }));
  const quoted = structured(
    await tool("start_errand", {
      what: "A burger",
      items: [{ shop: "Floor Dash", item_id: found.results[0].id }],
    }),
  );
  assert.equal(quoted.decision, "needs_ticket", JSON.stringify(quoted));
  assert.equal(quoted.suggested_budget, 12);
  const noItem = await tool("start_errand", { what: "A burger", items: [{ shop: "Floor Dash", item_id: "nope" }] });
  assert.equal(noItem.isError, true);

  const asked = await tool("start_errand", { what: "Market Bouquet flowers", budget: 20 });
  const sc = structured(asked);
  assert.equal(sc.decision, "needs_ticket", JSON.stringify(asked));
  assert.equal((await tool("wait_for_errand", { request_id: "ar_not_mine" })).isError, true);
  const page = await person.req(sc.ticket_url);
  assert.match(await page.text(), /at any shop/);
  const saving = await person.follow(sc.ticket_url, "http://none/", {
    form: {
      decision: "approve",
      scopes: ["store:browse", "store:reserve", "store:buy"],
      spend_limit: "20",
      intent: "Market Bouquet flowers",
      autopay: "1",
    },
  });
  const setupId = saving.url!.split("/sim-paypal/vault/")[1];
  assert.ok(setupId, String(saving.url));
  const done = await person.follow(`${flow.courier}/sim-paypal/vault/${setupId}`, "http://none/", {
    form: { decision: "approve" },
  });
  assert.match(await done.res.text(), /has its budget/);
  const ready = structured(await tool("wait_for_errand", { request_id: sc.request_id }));
  assert.equal(ready.ready, true);
  assert.equal(ready.budget, "20.00");
  flowers = ready.errand_id;
});

let books = "";
await step("Under the cap, Claude sends any courier by name with no click, on errands side by side", async () => {
  assert.equal(
    (
      await person.req(`${flow.courier}/start/courier`, {
        form: { new: "1", name: "Steve", human: "Malik", color: "tang" },
      })
    ).status,
    303,
  );
  const unknown = await tool("start_errand", { what: "books", budget: 12, courier: "Nobody" });
  assert.equal(unknown.isError, true);
  assert.match(unknown.content[0].text, /Steve/, "it says who they do have");
  const started = structured(
    await tool("start_errand", { what: "A novel to read books", budget: 12, courier: "steve" }),
  );
  assert.equal(started.courier, "Steve");
  books = started.errand_id;
  const { errands } = structured(await tool("whoami"));
  assert.deepEqual(new Set(errands.map((e: any) => e.errand_id)), new Set([flowers, books]));
});

await step("Each errand keeps its own budget, at any shop; what doesn't fit fails and says why", async () => {
  const bought = await tool("buy", { errand_id: flowers, shop: "Floor Dash", item_ids: ["fd-006"] });
  const sc = structured(bought);
  assert.equal(sc.status, "paid", JSON.stringify(bought));
  assert.equal(sc.shop, "Floor Dash");
  assert.equal(sc.remaining_budget, "2.00");
  const over = await tool("buy", { errand_id: flowers, shop: "Amazoo", item_ids: ["az-002"] });
  assert.equal(over.isError, true);
  assert.equal(structured(over).code, "spend_limit");
  const other = structured(await tool("buy", { errand_id: books, shop: "Amazoo", item_ids: ["az-002"] }));
  assert.equal(other.status, "paid", JSON.stringify(other));
  assert.equal(other.agent, "Steve");
  assert.ok((await fetch(other.receipt_url)).ok);
  const wrongShop = await tool("buy", { errand_id: books, shop: "Mike", item_ids: ["az-001"] });
  assert.equal(wrongShop.isError, true, "an item only sells at its own shop");
  assert.equal((await tool("buy", { errand_id: "visa_nope", shop: "Mike", item_ids: ["mk-004"] })).isError, true);
});

await step("Shops see a different pseudonym each, and the connector's token doesn't work at a shop", async () => {
  const seen = (await (await fetch(`${STORE}/merchant`)).text()).match(/<code>pp_[^<…]+…/g) ?? [];
  assert.notEqual(seen[0], seen[1], "Floor Dash and Amazoo can't match this person up");
  const direct = await fetch(`${STORE}/amazoo/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${gatewayToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(direct.status, 401);
});

await step("Over the cap needs the person: the model has no pass, the card does, once", async () => {
  const asked = await tool("start_errand", { what: "A kettle for the house", budget: 40 });
  assert.equal(structured(asked).decision, "needs_ticket");
  const pass = asked._meta["courier/budget_pass"];
  assert.ok(pass);
  assert.equal((await tool("set_budget", { budget: 500, pass: "guessed" })).isError, true);
  const set = structured(await tool("set_budget", { budget: 40, pass }));
  assert.equal(set.issued, true, JSON.stringify(set));
  assert.equal((await tool("set_budget", { budget: 40, pass })).isError, true, "a pass works once");
  assert.equal(structured(await tool("wait_for_errand", { request_id: structured(asked).request_id })).ready, true);
});

await step("The daily cap counts what Claude started itself; a used-up budget ends the errand", async () => {
  const pizza = structured(await tool("start_errand", { what: "A Margherita pizza dinner", budget: 14 }));
  assert.ok(pizza.errand_id, JSON.stringify(pizza)); // $12 + $14 started on its own so far
  const paid = structured(await tool("buy", { errand_id: pizza.errand_id, shop: "Floor Dash", item_ids: ["fd-004"] }));
  assert.equal(paid.status, "paid", JSON.stringify(paid));
  const after = await tool("buy", { errand_id: pizza.errand_id, shop: "Floor Dash", item_ids: ["fd-003"] });
  assert.equal(structured(after).error, "errand_ended", JSON.stringify(after));
  assert.match(after.content[0].text, /Budget used up/);
  const socks = structured(await tool("start_errand", { what: "Socks and more socks", budget: 24 }));
  assert.ok(socks.errand_id, "$12 + $14 + $24 is exactly the $50 daily cap");
  assert.equal(structured(await tool("start_errand", { what: "More socks", budget: 5 })).decision, "needs_ticket");
});

await step(
  "Claude chips in with the person's contacts: they hear the split first, and limits stay private",
  async () => {
    const listed = await tool("list_contacts");
    const { contacts } = structured(listed);
    assert.deepEqual(
      contacts.find((c: any) => c.name === "Leo"),
      { name: "Leo", relation: "brother", courier: "Otto" },
    );
    assert.deepEqual(contacts.map((c: any) => c.name).sort(), ["Leo", "Noor", "Priya"]);
    assert.doesNotMatch(JSON.stringify(listed), /\d|limit/i, "what each can put in is their courier's to know");
    const stranger = await tool("chip_in", { shop: "Mike", item_id: "mk-006", with: ["Bob"] });
    assert.match(stranger.content[0].text, /Bob isn't one of their contacts.*Leo \(brother/);

    // The day's cap is spent, so the person's share couldn't be paid now, and nobody is asked.
    const capped = await tool("chip_in", { shop: "Mike", item_id: "mk-006", with: ["Noor"] });
    assert.equal(structured(capped).error, "needs_person", JSON.stringify(capped));
    await person.req(`${flow.courier}/app/settings/cap`, { form: { cap_errand: "60", cap_day: "200" } });

    // Noor can put in $25 of an even $27.50, so the person would cover $2.50. Nothing is bought until they say yes.
    const ask = { shop: "Mike", item_id: "mk-006", with: ["my flatmate"] };
    const offer = await tool("chip_in", ask);
    const terms = structured(offer);
    assert.equal(terms.needs_ok, true, JSON.stringify(offer));
    assert.equal(terms.your_share, "30.00");
    assert.equal(terms.covering, "2.50");
    assert.deepEqual(terms.shares, [{ name: "Noor", amount: "25.00" }]);
    const code = offer.content[0].text.match(/confirm="([^"]+)"/)[1];
    assert.equal(structured(await tool("chip_in", { ...ask, confirm: "made-up" })).needs_ok, true);
    const other = await tool("chip_in", { ...ask, with: ["Noor", "Leo"] });
    const otherCode = other.content[0].text.match(/confirm="([^"]+)"/)[1];
    assert.equal(
      structured(await tool("chip_in", { ...ask, confirm: otherCode })).needs_ok,
      true,
      "a code only confirms the split it was made for",
    );

    const done = await tool("chip_in", { ...ask, confirm: code });
    const sc = structured(done);
    assert.equal(sc.status, "paid", JSON.stringify(done));
    assert.equal(sc.complete, true);
    assert.equal(sc.group_ticket.total, "55.00");
    assert.deepEqual(
      sc.group_ticket.payers.map((p: any) => [p.name, p.cents, p.paid]),
      [
        ["You", 3000, true],
        ["Noor", 2500, true],
      ],
    );
    assert.ok((await fetch(sc.receipt_url)).ok);
    assert.equal(structured(await tool("chip_in", { ...ask, confirm: code })).needs_ok, true, "a code works once");
    const merchant = await (await fetch(`${STORE}/merchant`)).text();
    assert.doesNotMatch(merchant, /Malik|Noor|Maya|Leo\b/, "shops never learn who chipped in");
  },
);

await step("Shops show logos; calling back and disconnecting end everything", async () => {
  const shops = await (await person.req(`${flow.courier}/app/shops`)).text();
  assert.match(shops, /class="slogo/);
  assert.doesNotMatch(shops, /Send \w+<span class="go">/, "the shops page is a gallery, not a row of buttons");
  assert.match(await (await person.req(`${flow.courier}/app/errands?tab=out`)).text(), /Amazoo/);
  assert.equal(structured(await tool("end_errand", { errand_id: books })).ended, true);
  const late = await tool("buy", { errand_id: books, shop: "Amazoo", item_ids: ["az-006"] });
  assert.equal(structured(late).error, "errand_ended");
  await gateway.close();
  const settings = await (await person.req(`${flow.courier}/app/settings`)).text();
  const conn = settings.match(/\/app\/connections\/(conn_[^/]+)\/revoke/g)!;
  for (const action of conn) assert.equal((await person.req(`${flow.courier}${action}`, { form: {} })).status, 303);
  const gone = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      authorization: `Bearer ${gatewayToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(gone.status, 401);
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
