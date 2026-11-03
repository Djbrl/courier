import { ARROW, CK, COURIER_RESOURCE, config, html, PP, VERIFIED } from "@courier/shared";
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

/** For shops: what Courier does for a business, then how to put it in front of an MCP server. */
export function forShopsPage(human: Human | null): string {
  const issuer = config.courier.url;
  const ep = (label: string, url: string) =>
    html`<li><span>${label}</span><code class="copy inp code sm">${url}</code></li>`;
  return cpage(
    "For shops",
    human,
    html`<main class="fs">
      <section class="fs-hero">
        <div class="fs-tx">
          <h1 class="big">Sell to agents you can&nbsp;trust.</h1>
          <p class="lead">Agents are already shopping. Courier tells your shop a real person sent each one and what it may spend, and keeps everything else out of your&nbsp;hands.</p>
          <div class="ctas"><a class="btn acc" href="#install">Add Courier to your shop${ARROW}</a><a class="btn ghost" href="${config.store.url}/merchant">See a shop’s dashboard</a></div>
        </div>
        <div class="fs-ostage"><div class="fs-order" role="img" aria-label="A new order from Juno, a courier agent verified by PayPal, for a Double Smash Burger at $11.50, inside its $25 limit.">
          <div class="fs-oh"><b>New order</b><small>Just now</small></div>
          <div class="fs-who"><span class="fs-pt">J</span><span><b>Juno</b><small>Courier agent</small></span>${VERIFIED}</div>
          <dl class="fs-kv">
            <div><dt>Item</dt><dd>Double Smash Burger</dd></div>
            <div><dt>Total</dt><dd>$11.50</dd></div>
            <div><dt>Limit</dt><dd>$25 · ${CK}Inside</dd></div>
            <div><dt>Shopper</dt><dd><code>pp_7f3a…c91</code></dd></div>
          </dl>
          <div class="fs-ok">Accept order</div>
        </div></div>
      </section>

      <section class="fs-g" aria-label="What Courier does for your shop">
        <article class="fs-t" style="--t:var(--cobalt);--tt:#fff">
          <div class="fs-vis"><span class="fs-pill">${CK}Verified by ${PP}</span></div>
          <h2 class="sec-t">A real person behind every agent</h2>
          <p>PayPal checks the person once. You get the yes, not the&nbsp;name.</p>
        </article>
        <article class="fs-t" style="--t:var(--orange);--tt:var(--ink)">
          <div class="fs-vis"><div class="fs-meter"><span>$11.50</span><i style="--w:46%"></i><span>of $25</span></div></div>
          <h2 class="sec-t">Limits checked before you charge</h2>
          <p>Ask Courier before taking payment. It answers yes or no, in&nbsp;code.</p>
        </article>
        <article class="fs-t" style="--t:var(--hivis);--tt:var(--ink)">
          <div class="fs-vis"><dl class="fs-kv fs-mini"><div><dt>Shopper</dt><dd><code>pp_7f3a…c91</code></dd></div><div><dt>Name</dt><dd><i></i></dd></div><div><dt>Email</dt><dd><i></i></dd></div></dl></div>
          <h2 class="sec-t">No personal data to keep</h2>
          <p>Each shop gets its own pseudonym, so there is nothing to leak or match&nbsp;up.</p>
        </article>
        <article class="fs-t" style="--t:var(--cab);--tt:var(--ink)">
          <div class="fs-vis"><span class="fs-pill fs-stop">Reported<b>Pass suspended</b></span></div>
          <h2 class="sec-t">Bad agents get stopped</h2>
          <p>Report an agent and its pass is suspended, with its bond if it has&nbsp;one.</p>
        </article>
      </section>

      <section class="fs-install" id="install">
        <header><h2 class="big">Add Courier to your&nbsp;shop.</h2>
          <p class="lead">Your MCP server stays yours. Courier signs the tokens; you check them.</p></header>
        <div class="fs-ig">
          <ol class="steps">
            <li><b>Point your MCP server’s protected-resource metadata at Courier.</b><span>RFC 9728. Agents find Courier and register themselves.</span></li>
            <li><b>Verify each access token.</b><span>Signature (JWKS), issuer, audience = your MCP URL, expiry.</span></li>
            <li><b>Check a spend before you charge.</b><span>Courier hands you the errand’s <code>visa</code> as a short-lived signed token. Put its id in the PayPal order’s <code>custom_id</code>.</span></li>
          </ol>
          <div>
            <ul class="eps">
              ${ep("Authorization server", `${issuer}/.well-known/oauth-authorization-server`)}
              ${ep("Keys (JWKS)", `${issuer}/jwks.json`)}
              ${ep("Example resource metadata", `${issuer}/.well-known/oauth-protected-resource/mcp`)}
            </ul>
            <pre class="claims" aria-label="The claims a shop receives">${CLAIMS_EXAMPLE}</pre>
            <p class="fine"><code>sub</code> differs for every shop. Try to break it: <a href="/bots">release the bots</a>.</p>
          </div>
        </div>
      </section>
    </main>`,
    { here: "/for-shops" },
  );
}

/** Install: putting Courier in the agent a person already uses. */
export function installPage(human: Human | null): string {
  return cpage(
    "Install",
    human,
    html`<main class="fs">
      <header class="fs-ih"><h1 class="big">Install Courier in your&nbsp;agent.</h1>
        <p class="lead">One connector, and every courier you make goes with it.</p></header>
      <div class="fs-ig fs-ip">
        <section class="fs-t" style="--t:var(--tang);--tt:var(--ink)">
          <h2 class="sec-t">Claude</h2>
          <ol class="steps">
            <li><b>Settings, Connectors, Add custom connector.</b><code class="copy inp code">${CONNECTOR}</code></li>
            <li><b>Connect, and pick your courier.</b><span>Sign in with ${PP} and say yes. Nothing is bought.</span></li>
            <li><b>Ask in any chat.</b><span><q>Get me a burger on Floor Dash. I have about $15.</q></span></li>
          </ol>
          <a class="btn sm" href="/start">Get a courier${ARROW}</a>
        </section>
        <section class="fs-t" style="--t:var(--paper);--tt:var(--ink)">
          <h2 class="sec-t">Any MCP agent</h2>
          <ol class="steps">
            <li><b>Add a remote MCP server.</b><code class="copy inp code">${CONNECTOR}</code></li>
            <li><b>Let it sign in.</b><span>It finds Courier with OAuth and registers itself.</span></li>
            <li><b>Send it on an errand.</b><span>It gets the same tools: shops, errands, and calling back.</span></li>
          </ol>
          <a class="link fine" href="/for-shops#install">Building a shop instead?</a>
        </section>
        <section class="fs-t fs-try" style="--t:var(--hivis);--tt:var(--ink)">
          <h2 class="sec-t">Not ready to install?</h2>
          <p>Send a courier from the demo, with simulated ${PP} and 50 free messages.</p>
          <a class="btn" href="/start">Try the demo${ARROW}</a>
        </section>
      </div>
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
