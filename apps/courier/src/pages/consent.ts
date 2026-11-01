import {
  COURIER_RESOURCE,
  config,
  courierVars,
  html,
  LOGO,
  money,
  PP,
  paypalButton,
  portrait,
  raw,
  SHOPS,
  shopLogo,
  type Visa,
} from "@courier/shared";
import { type Approval, type AuthRequest, type Courier, db, type Human, listCouriers, type Merchant } from "../db.ts";
import { courierForClient, cpage, DEMO_CLIENT_PREFIX, lookForAgent, tryDemo } from "./shared.ts";

/* ---------------- connect + consent (the errand ticket) ---------------- */

const SHOP_TILE = raw('<span class="shopt" aria-hidden="true"><b>J</b></span>');

/** Sign-in, for someone who arrives from Claude without a Courier session. */
export function connectPage(request: AuthRequest, merchant: Merchant): string {
  const look = { name: request.clientName, color: "ink" as const, model: "", idNo: "" };
  return cpage(
    "Connect",
    null,
    html`<main class="solo"><div class="solo-card">
      <div class="pair-ids">${portrait(look)}<span class="dash"></span>${SHOP_TILE}</div>
      <h1 class="big">${request.ticket ? html`Sign in to set <span class="hfit" data-fit>${look.name}’s</span> budget.` : html`Connect <span class="hfit" data-fit>${look.name}</span> to Courier.`}</h1>
      <p class="lead">PayPal checks there’s a real person behind it. ${request.ticket ? "" : "Nothing gets bought. "}${merchant.resource === COURIER_RESOURCE ? "Shops only learn" : `${merchant.name} only learns`} that, never who you are.</p>
      <div class="acts-row">${paypalButton(`/auth/paypal/start?req=${request.id}`)}${tryDemo({ req: request.id })}</div>
    </div></main>`,
  );
}

/** Connecting is one question. No ticket and no payment: those wait until the person wants something bought. */
export function connectConsentPage(request: AuthRequest, human: Human): string {
  if (request.resource === COURIER_RESOURCE) return connectCourierPage(request, human);
  const choice = courierChoice(human, request.clientId);
  const look = lookForAgent(human, request.clientId, request.clientName);
  const only = choice?.couriers.length === 1 ? choice.couriers[0] : undefined;
  const shown = only ? { ...look, name: only.name, color: only.color } : look;
  return cpage(
    `Connect ${request.clientName}`,
    human,
    html`<main class="solo"><div class="solo-card">
      <form method="post" action="/consent/${request.id}">
        ${
          choice && !only
            ? html`<h1 class="big">Connect ${request.clientName}.</h1>
              <fieldset class="pickc"><legend>Which courier is it?</legend>
              <div class="pickc-o">${choice.couriers.map(
                (c) =>
                  html`<label class="cc" style="${courierVars(c.color)}"><input type="radio" name="courier" value="${c.id}" ${c.id === choice.preselect ? raw("checked") : ""}>${portrait(c)}<span>${c.name}${c.clientId ? html`<small>in another Claude</small>` : ""}</span></label>`,
              )}</div></fieldset>`
            : html`<div class="pair-ids cc" style="${courierVars(shown.color)}">${portrait(shown)}</div>
              ${only ? html`<input type="hidden" name="courier" value="${only.id}">` : ""}
              <h1 class="big">Connect ${request.clientName} as ${shown.name}.</h1>`
        }
        <p class="lead">${request.clientName} can look around ${config.store.name} as your courier. It can’t hold or buy anything until you give it a budget. Nothing is charged now.</p>
        <div class="acts-row">
          <button class="btn" type="submit" name="decision" value="approve">Connect</button>
          <button class="btn ghost" type="submit" name="decision" value="deny">Not now</button>
        </div>
        <p class="fine" style="margin-top:18px"><a class="link" href="/auth/paypal/start?req=${request.id}">Use a different PayPal account</a></p>
      </form>
    </div></main>`,
  );
}

/** Fields for the most Claude may start on its own. Empty or zero means it always asks. */
export function capFields(human: Human) {
  const dollars = (cents: number | undefined, fallback: number) => (cents === undefined ? fallback : cents / 100);
  return html`<div class="wiz-fields capf">
    <label class="fld"><span>Per errand</span><span class="capi"><i>$</i><input class="inp" type="number" name="cap_errand" min="0" max="500" step="1" value="${dollars(human.cap?.perErrandCents, 50)}" aria-label="Most per errand, in dollars"></span></label>
    <label class="fld"><span>Per day</span><span class="capi"><i>$</i><input class="inp" type="number" name="cap_day" min="0" max="2000" step="1" value="${dollars(human.cap?.perDayCents, 100)}" aria-label="Most per day, in dollars"></span></label>
  </div>`;
}

/** Connecting the one connector: every courier and shop in one yes, and the one number that decides when Claude asks. */
function connectCourierPage(request: AuthRequest, human: Human): string {
  return cpage(
    `Connect ${request.clientName}`,
    human,
    html`<main class="solo"><div class="solo-card">
      <form method="post" action="/consent/${request.id}">
        <h1 class="big">Connect ${request.clientName} to Courier.</h1>
        <p class="lead">Your couriers can shop here. Nothing is charged now.</p>
        <div class="shopg shopg-row">${SHOPS.map((s) => html`<span class="shopg-m">${shopLogo(s)}<small>${s.name}</small></span>`)}</div>
        <h2 class="sec-t">Claude can spend without asking, up to:</h2>
        ${capFields(human)}
        <p class="fine">Above this, it asks you first. Put 0 to always be asked.</p>
        <div class="acts-row">
          <button class="btn" type="submit" name="decision" value="approve">Connect</button>
          <button class="btn ghost" type="submit" name="decision" value="deny">Not now</button>
        </div>
        <p class="fine" style="margin-top:18px"><a class="link" href="/auth/paypal/start?req=${request.id}">Use a different PayPal account</a></p>
      </form>
    </div></main>`,
  );
}

/** The end of a ticket written from a link in the chat: the person goes back to their conversation. */
export function ticketReadyPage(human: Human, visa: Visa): string {
  const look = lookForAgent(human, visa.clientId, visa.agentName);
  const paysItself = visa.autopay?.status === "on";
  return cpage(
    "Budget set",
    human,
    html`<main class="solo"><div class="solo-card cc" style="${courierVars(look.color)}">
      <div class="pair-ids">${portrait(look)}</div>
      <h1 class="big">${look.name} has its budget.</h1>
      <p class="lead">You can go back to your chat. ${paysItself ? "Purchases inside your budget pay with your saved PayPal." : "You’ll get a PayPal link for each purchase."} If ${look.name} hasn’t carried on, say “done”.</p>
      <div class="acts-row"><a class="btn ghost" href="/app/errands?e=${visa.id}">See the errand</a></div>
    </div></main>`,
  );
}

export function ticketDeclinedPage(human: Human): string {
  return cpage(
    "No budget",
    human,
    html`<main class="solo"><div class="solo-card">
      <h1 class="big">No budget, no shopping.</h1>
      <p class="lead">Nothing can be held or bought. Your Claude is still connected and can write you another link whenever you ask.</p>
      <div class="acts-row"><a class="btn ghost" href="/app">Back to Courier</a></div>
    </div></main>`,
  );
}

/** Which courier an outside client (the person's own Claude) should act as, when it isn't bound to one yet. */
export function courierChoice(human: Human, clientId: string): { couriers: Courier[]; preselect: string } | null {
  if (clientId.startsWith(DEMO_CLIENT_PREFIX) || courierForClient(human.id, clientId)) return null;
  const couriers = listCouriers(human.id);
  if (!couriers.length) return null;
  const preselect = (couriers.find((c) => !c.clientId && c.mode === "claude") ??
    couriers.find((c) => !c.clientId) ??
    couriers[0])!.id;
  return { couriers, preselect };
}

/** The ticket: a budget, and on the first one, how to pay. Everything else is the courier's to work out. */
export function consentPage(
  request: AuthRequest,
  merchant: Merchant,
  human: Human,
  error?: string,
  startAtPay = false,
): string {
  const look = lookForAgent(human, request.clientId, request.ticket?.courierName ?? request.clientName);
  const isDemo = request.clientId.startsWith(DEMO_CLIENT_PREFIX);
  const intent = request.ticket?.intent ?? (isDemo ? "Jazz records for my dad" : "");
  const budget = request.ticket?.spendLimit ?? 60;
  const gateway = merchant.resource === COURIER_RESOURCE;
  const choice = gateway ? null : courierChoice(human, request.clientId);
  const saved = Boolean(db.get("saved_paypal", human.id));
  const twoSteps = !saved && merchant.scopes.includes("store:buy");
  const who = choice ? "your courier" : look.name;
  const send = html`<button class="btn" type="submit" name="decision" value="approve">Send ${choice ? "it" : look.name}</button>`;
  return cpage(
    `Errand for ${look.name}`,
    human,
    html`<main class="wiz-page"><form method="post" action="/consent/${request.id}" class="wiz cc" style="${courierVars(look.color)}" id="ticket" data-start="${startAtPay && twoSteps ? 2 : 1}">
      ${merchant.scopes.map((s) => html`<input type="hidden" name="scopes" value="${s}">`)}
      <input type="hidden" name="intent" value="${intent}">
      <section class="wiz-step" data-step="1">
        <div class="wiz-body">
          ${choice ? "" : html`<div class="wiz-who">${portrait(look)}<span>${look.name}</span></div>`}
          <h1 class="big">Set a budget.</h1>
          <p class="lead">${gateway ? (intent ? html`For ${intent}, at any shop.` : "At any shop.") : html`For ${merchant.name}${intent ? html`: ${intent}` : ""}.`}</p>
          ${error ? html`<p class="err">${error}</p>` : ""}
          ${
            choice
              ? html`<fieldset class="pickc"><legend>Which courier is ${request.clientName}?</legend>
                <div class="pickc-o">${choice.couriers.map(
                  (c) =>
                    html`<label class="cc" style="${courierVars(c.color)}"><input type="radio" name="courier" value="${c.id}" ${c.id === choice.preselect ? raw("checked") : ""}>${portrait(c)}<span>${c.name}</span></label>`,
                )}</div></fieldset>`
              : ""
          }
          <label class="budget"><span class="sr">Budget, in dollars</span><i>$</i><input type="number" name="spend_limit" min="1" max="500" step="1" value="${budget}" required autofocus aria-label="Budget, in dollars"></label>
          <p class="fine">${who === "your courier" ? "Your courier" : who} can’t spend more than this, and asks you about anything off the errand. ${gateway ? "Shops see" : `${merchant.name} sees`} ${human.simulated ? "a demo person" : "a verified person"}, not your name.</p>
          ${saved ? html`<input type="hidden" name="autopay" value="1"><p class="fine">Pays with your saved ${PP}.</p>` : ""}
        </div>
        <div class="wiz-foot">
          <button class="btn ghost" type="submit" name="decision" value="deny" formnovalidate>Not now</button>
          ${twoSteps ? html`<button class="btn" type="button" data-go="2">Next</button>` : send}
        </div>
      </section>
      ${
        twoSteps
          ? html`<section class="wiz-step" data-step="2">
            <div class="wiz-body">
              <h1 class="big">How should it pay?</h1>
              <label class="payo"><input type="radio" name="autopay" value="1" checked><span><b>Save ${PP}</b><small>One approval now. After that, purchases inside your budget just go through, on every errand. Remove it any time in Settings.</small></span></label>
              <label class="payo"><input type="radio" name="autopay" value="0"><span><b>Approve each payment</b><small>You get a PayPal link for every purchase.</small></span></label>
            </div>
            <div class="wiz-foot">
              <button class="btn ghost" type="button" data-go="1">Back</button>
              ${send}
            </div>
          </section>`
          : ""
      }
    </form></main>
    ${raw(`<script>(()=>{const f=document.getElementById("ticket"),steps=[...f.querySelectorAll("[data-step]")];const go=n=>steps.forEach(s=>{s.hidden=s.dataset.step!==String(n)});go(f.dataset.start);f.addEventListener("click",e=>{const b=e.target.closest("[data-go]");if(!b)return;if(b.dataset.go==="2"&&!f.elements.spend_limit.reportValidity())return;go(b.dataset.go)})})()</script>`)}`,
    { head: raw("<style>.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}</style>") },
  );
}

export function refusalPage(human: Human | null, title: string, message: string, request?: AuthRequest): string {
  return cpage(
    title,
    human,
    html`<main class="solo"><div class="solo-card">
      <div class="big-ic" aria-hidden="true">✋</div>
      <h1 class="big">${title}</h1>
      <p class="lead">${message}</p>
      <div class="acts-row">${request ? html`<a class="btn ghost" href="/auth/paypal/start?req=${request.id}&switch=1">Try another PayPal account</a>` : html`<a class="btn ghost" href="/start">Start again</a>`}</div>
    </div></main>`,
  );
}

export function accountDeletedPage(human: Human | null): string {
  return cpage(
    "Your account is deleted",
    human,
    html`<main class="solo"><div class="solo-card"><h1 class="big">Your account is deleted</h1><p class="lead">Your couriers, errands and history are gone. Signing in with PayPal starts a new account from scratch.</p>
      <p class="fine">If Claude was connected, reconnect Courier in Claude's settings to use it again.</p>
      <div class="acts-row"><a class="btn acc" href="/start">Start again</a><a class="btn ghost" href="/">Back home</a></div></div></main>`,
  );
}

export function errorPage(human: Human | null, title: string, message: string): string {
  return cpage(
    title,
    human,
    html`<main class="solo"><div class="solo-card"><h1 class="big">${title}</h1><p class="lead">${message}</p>
      <div class="acts-row"><a class="btn ghost" href="${human ? "/app" : "/"}">Back home</a></div></div></main>`,
  );
}

export function signInPage(): string {
  return cpage(
    "Sign in",
    null,
    html`<main class="solo"><div class="solo-card">
      <h1 class="big">Open your Courier.</h1>
      <p class="lead">See your errands, answer your courier, and call it back anytime.</p>
      <div class="acts-row">${paypalButton("/auth/paypal/start?login=1")}${tryDemo({})}<a class="link fine" href="/start">New here? Start with the demo</a></div>
    </div></main>`,
  );
}

/* ---------------- approvals ---------------- */

export function approvalPage(human: Human, approval: Approval, visa: Visa): string {
  const look = lookForAgent(human, visa.clientId, visa.agentName);
  const decided = approval.status !== "pending";
  const what = approval.items.map((i) => i.title.replace(/ \(.*\)$/, "")).join(", ");
  return cpage(
    `${look.name} asks`,
    human,
    html`<main class="solo"><div class="solo-card">
      <div class="notif solo-n cc" style="${courierVars(look.color)}">
        <div class="nh">${LOGO}</div>
        <div class="nwho">${portrait(look)}${look.name} asks</div>
        <div class="nq">${what}, ${money(approval.totalCents)}?</div>
        <div class="why">${approval.reason}<br><small>Your errand: “${visa.intent || "no purpose given"}” · ${visa.merchantName}${approval.action === "checkout" && visa.autopay?.status === "on" ? " · Approve pays with your saved PayPal" : ""}</small></div>
        ${
          decided
            ? html`<div class="acts" data-v="${approval.status === "approved" ? "ok" : "no"}"><button type="button" class="ap" disabled>${approval.status === "approved" ? "Approved ✓" : "Approve"}</button><button type="button" class="dn" disabled>${approval.status === "denied" ? "Denied" : "Deny"}</button></div>`
            : html`<form method="post" action="/approvals/${approval.id}" class="acts"><button class="ap" name="decision" value="approved">Approve</button><button class="dn" name="decision" value="denied">Deny</button></form>`
        }
      </div>
      ${decided ? html`<p class="lead">${look.name} will see your answer next time it checks.</p>` : ""}
      <div class="acts-row"><a class="link fine" href="/app">Back to Courier</a></div>
    </div></main>`,
  );
}
