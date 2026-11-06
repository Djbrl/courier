import { ARROW, CK, COURIER_RESOURCE, config, html, PP, type RawHtml, VERIFIED } from "@courier/shared";
import type { Human } from "../db.ts";
import { cpage } from "./shared.ts";

/* ---------------- for shops, install, and the bot test ---------------- */

const CLAIMS_EXAMPLE = `{
  "sub": "pp_7f3a…",
  "scope": "store:browse store:reserve store:buy",
  "human": { "verified": true },
  "visa": {
    "id": "visa_…",
    "agent": "Juno",
    "intent": "Jazz records for my dad",
    "spend_limit": { "currency": "USD", "value": "60.00" },
    "per_purchase_limit": { "currency": "USD", "value": "40.00" },
    "expires_at": "…"
  }
}`;

/** The Courier connector as an agent adds it. */
const CONNECTOR = COURIER_RESOURCE;

/** For shops: the pitch. What changes for a business, how it fits, and the details for its developers, folded away. */
export function forShopsPage(human: Human | null): string {
  const issuer = config.courier.url;
  const ep = (label: string, url: string) =>
    html`<li><span>${label}</span><code class="copy inp code sm">${url}</code></li>`;
  const why = (n: string, title: string, body: string) =>
    html`<li><span class="sp-n">${n}</span><div><h3>${title}</h3><p>${body}</p></div></li>`;
  const flow = (title: string, body: string) => html`<li><b>${title}</b><span>${body}</span></li>`;
  return cpage(
    "For shops",
    human,
    html`<main class="sp">
      <section class="sp-hero">
        <div class="sp-tx">
          <h1 class="big">Sell to agents you can&nbsp;trust.</h1>
          <p class="lead">Agents are already shopping. Courier tells your shop a real person sent each one and what it may spend, and keeps everything else out of your&nbsp;hands.</p>
          <div class="ctas"><a class="btn acc" href="${config.store.url}/merchant">See what a shop sees${ARROW}</a><a class="link" href="/bots">Try to break it</a></div>
        </div>
        <div class="fs-order" role="img" aria-label="A new order from Juno, a courier agent verified by PayPal, for a Double Smash Burger at $11.50, inside its $25 limit.">
          <div class="fs-oh"><b>New order</b><small>Just now</small></div>
          <div class="fs-who"><span class="fs-pt">J</span><span><b>Juno</b><small>Courier agent</small></span>${VERIFIED}</div>
          <dl class="fs-kv">
            <div><dt>Item</dt><dd>Double Smash Burger</dd></div>
            <div><dt>Total</dt><dd>$11.50</dd></div>
            <div><dt>Limit</dt><dd>$25 · ${CK}Inside</dd></div>
            <div><dt>Shopper</dt><dd><code>pp_7f3a…c91</code></dd></div>
          </dl>
          <div class="fs-ok">Accept order</div>
        </div>
      </section>

      <section class="sp-why" aria-label="Why shops use Courier">
        <h2 class="big">Agent traffic you can say yes&nbsp;to.</h2>
        <ol>
          ${why("01", "A real person behind every agent", "PayPal checks the person once. You get the yes, never the name.")}
          ${why("02", "Limits checked before you charge", "Every order arrives with a signed budget. Courier answers yes or no, in code.")}
          ${why("03", "Nothing personal to store", "Each shop sees its own pseudonym, so there is nothing to leak or match up.")}
          ${why("04", "Bad agents get stopped", "Report one and its pass is suspended across every shop.")}
        </ol>
      </section>

      <section class="sp-flow" aria-label="How it fits">
        <h2 class="big">It fits the checkout you&nbsp;have.</h2>
        <ol>
          ${flow("A person signs in with PayPal", "Once. Their courier gets an ID and a budget.")}
          ${flow("The courier reaches your shop", "Through your own MCP server, with a signed token.")}
          ${flow("You check, then charge", "The token says it fits. PayPal takes the payment.")}
        </ol>
      </section>

      <details class="sp-dev" id="install">
        <summary>For your developers</summary>
        <div class="fs-ig">
          <ul class="eps">
            ${ep("Authorization server", `${issuer}/.well-known/oauth-authorization-server`)}
            ${ep("Keys (JWKS)", `${issuer}/jwks.json`)}
            ${ep("Example resource metadata", `${issuer}/.well-known/oauth-protected-resource/mcp`)}
          </ul>
          <div><pre class="claims" aria-label="The claims a shop receives">${CLAIMS_EXAMPLE}</pre>
            <p class="fine">Standard OAuth for MCP (RFC 9728). <code>sub</code> differs for every shop. Try to break it: <a href="/bots">release the bots</a>.</p></div>
        </div>
      </details>
    </main>`,
    { here: "/for-shops" },
  );
}

/** Install: one path at a time. Pick the agent, then four steps. */
export function installPage(human: Human | null): string {
  const step = (n: number, title: string, body: RawHtml | string) =>
    html`<li><span class="in-n">${n}</span><div><h3>${title}</h3><div class="in-b">${body}</div></div></li>`;
  return cpage(
    "Install",
    human,
    html`<main class="in">
      <header><h1 class="big">Install Courier in your&nbsp;agent.</h1>
        <p class="lead">One connector, and every courier you make goes with it.</p></header>
      <div class="in-pick" role="radiogroup" aria-label="Your agent">
        <label><input type="radio" name="agent" value="claude" checked><span>Claude</span></label>
        <label><input type="radio" name="agent" value="mcp"><span>Any MCP agent</span></label>
      </div>
      <ol class="in-steps" data-for="claude">
        ${step(1, "Open Claude’s connectors", "Settings, then Connectors, then Add custom connector.")}
        ${step(2, "Paste the address", html`<code class="copy inp code">${CONNECTOR}</code>`)}
        ${step(3, "Connect and pick your courier", html`Sign in with ${PP} and say yes. Nothing is bought.`)}
        ${step(4, "Ask in any chat", html`<q>Get me a burger on Floor Dash. I have about $15.</q>`)}
      </ol>
      <ol class="in-steps" data-for="mcp">
        ${step(1, "Add a remote MCP server", html`<code class="copy inp code">${CONNECTOR}</code>`)}
        ${step(2, "Let it sign in", "It finds Courier with OAuth and registers itself.")}
        ${step(3, "Pick your courier", html`Sign in with ${PP} and say yes. Nothing is bought.`)}
        ${step(4, "Send it on an errand", "It gets the same tools: shops, errands, and calling back.")}
      </ol>
      <div class="in-foot"><a class="btn" href="/start">Get a courier${ARROW}</a><a class="link fine" href="/start">Not ready? Try the demo first</a></div>
    </main>`,
    { here: "/install" },
  );
}

export function botsPage(human: Human | null): string {
  return cpage(
    "Release the bots",
    human,
    html`<main class="bots-pg">
      <header class="bots-h">
        <div><h1 class="big">Release the&nbsp;bots.</h1>
          <p class="lead">Eight attacks on ${config.store.name}’s courier lane: no ID, forged and stolen IDs, overspending, prompt injection, a flood.</p></div>
        <button class="btn danger" type="button" id="run-bots">Run 8 attacks</button>
      </header>
      <ol class="bot-grid" id="bot-results" aria-live="polite"><li class="bot-empty">The bots are waiting outside.</li></ol>
      <p class="fine">Real requests against the real shop. The shop’s side is on <a href="${config.store.url}/merchant">its dashboard</a>.</p>
    </main>`,
    { scripts: ["/assets/bots.js"] },
  );
}
