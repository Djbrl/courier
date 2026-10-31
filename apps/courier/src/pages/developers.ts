import { ARROW, config, html, STORE_RESOURCE } from "@courier/shared";
import type { Human } from "../db.ts";
import { cpage } from "./shared.ts";

/* ---------------- developers + the bot test ---------------- */

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

export function developersPage(human: Human | null): string {
  const issuer = config.courier.url;
  const ep = (label: string, url: string) =>
    html`<li><span>${label}</span><code class="copy inp code sm">${url}</code></li>`;
  return cpage(
    "Developers",
    human,
    html`<main class="devs">
      <header class="devs-h"><h1 class="big">Build with&nbsp;Courier.</h1>
        <p class="lead">Couriers carry a PayPal-verified ID and the limits their person set. Your shop gets proof, never personal data.</p></header>
      <div class="devs-g">
        <section class="panel devs-c">
          <h2 class="sec-t">Use it in Claude</h2>
          <ol class="steps">
            <li><b>Add a custom connector with this URL.</b><code class="copy inp code">${STORE_RESOURCE}</code></li>
            <li><b>Connect, and pick your courier.</b><span>Courier opens: sign in with PayPal and write the errand ticket.</span></li>
            <li><b>Ask in any chat.</b><span><q>Find me a jazz record under $40 at ${config.store.name}.</q></span></li>
          </ol>
          <a class="btn sm" href="/start">Get a courier${ARROW}</a>
        </section>
        <section class="panel devs-c">
          <h2 class="sec-t">Welcome couriers in your shop</h2>
          <ol class="steps">
            <li><b>Point your MCP server’s protected-resource metadata at Courier.</b><span>RFC 9728. Clients find Courier and register themselves.</span></li>
            <li><b>Verify the access token.</b><span>Signature (JWKS), issuer, audience = your MCP URL, expiry.</span></li>
            <li><b>Read the <code>visa</code> claim; check spends before charging.</b><span>Put the visa id in the PayPal order’s <code>custom_id</code> as evidence.</span></li>
          </ol>
          <ul class="eps">
            ${ep("Authorization server", `${issuer}/.well-known/oauth-authorization-server`)}
            ${ep("Keys (JWKS)", `${issuer}/jwks.json`)}
            ${ep("Example resource metadata", `${config.store.url}/.well-known/oauth-protected-resource/mcp`)}
          </ul>
        </section>
        <section class="panel devs-c devs-claims">
          <h2 class="sec-t">What a shop sees</h2>
          <p class="fine">The token’s claims. <code>sub</code> is a different pseudonym for every shop.</p>
          <pre class="claims">${CLAIMS_EXAMPLE}</pre>
          <p class="fine">Try to break it: <a href="/bots">release the bots</a>.</p>
        </section>
      </div>
    </main>`,
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
      <p class="fine">Real requests against the real shop. The shop’s side is on <a href="${config.store.url}/merchant">what the shop sees</a>.</p>
    </main>`,
    { scripts: ["/assets/bots.js"] },
  );
}
