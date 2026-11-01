import {
  ARROW,
  CK,
  config,
  courierVars,
  DURATIONS,
  html,
  LOGO,
  money,
  PP,
  paypalButton,
  portrait,
  raw,
  SCOPES,
  type Scope,
  type Visa,
} from "@courier/shared";
import { type Approval, type AuthRequest, type Courier, type Human, listCouriers, type Merchant } from "../db.ts";
import { courierForClient, cpage, DEMO_CLIENT_PREFIX, lookForAgent } from "./shared.ts";

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
      <h1 class="big">${request.ticket ? html`Sign in to write <span class="hfit" data-fit>${look.name}’s</span> ticket.` : html`Connect <span class="hfit" data-fit>${look.name}</span> to Courier.`}</h1>
      <p class="lead">PayPal checks there’s a real person behind it. ${request.ticket ? "" : "Nothing gets bought. "}${merchant.name} only learns that, never who you are.</p>
      <div class="acts-row">${paypalButton(`/auth/paypal/start?req=${request.id}`)}</div>
    </div></main>`,
  );
}

/** Connecting is one question. No ticket and no payment: those wait until the person wants something bought. */
export function connectConsentPage(request: AuthRequest, human: Human): string {
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
              <h1 class="big">Connect ${request.clientName} as <span class="hfit" data-fit>${shown.name}.</span></h1>`
        }
        <p class="lead">${request.clientName} can look around ${config.store.name} as your courier. It can’t hold or buy anything until you write it a ticket. Nothing is charged now.</p>
        <div class="acts-row">
          <button class="btn" type="submit" name="decision" value="approve">Connect${ARROW}</button>
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
    "Ticket sent",
    human,
    html`<main class="solo"><div class="solo-card cc" style="${courierVars(look.color)}">
      <div class="pair-ids">${portrait(look)}</div>
      <h1 class="big"><span class="hfit" data-fit>${look.name}</span> has its ticket.</h1>
      <p class="lead">Go back to your chat and say “done”. ${paysItself ? "Purchases inside your limits will pay with your saved PayPal." : "You’ll get a PayPal link for each purchase."}</p>
      <div class="acts-row"><a class="btn ghost" href="/app/errands?e=${visa.id}">See the errand</a></div>
    </div></main>`,
  );
}

export function ticketDeclinedPage(human: Human): string {
  return cpage(
    "No ticket",
    human,
    html`<main class="solo"><div class="solo-card">
      <h1 class="big">No ticket, no shopping.</h1>
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

export function consentPage(request: AuthRequest, merchant: Merchant, human: Human, error?: string): string {
  const look = lookForAgent(human, request.clientId, request.clientName);
  const isDemo = request.clientId.startsWith(DEMO_CLIENT_PREFIX);
  const intent = request.ticket?.intent ?? (isDemo ? "Jazz records for my dad" : "");
  const spendLimit = request.ticket?.spendLimit ?? 60;
  const perPurchaseLimit = request.ticket?.perPurchaseLimit ?? 40;
  const choice = courierChoice(human, request.clientId);
  const durLabel: Record<string, string> = { "1h": "1 hour", "24h": "Tomorrow", "3d": "3 days" };
  const scopeRows = (Object.keys(SCOPES) as Scope[])
    .filter((s) => merchant.scopes.includes(s))
    .map(
      (
        s,
      ) => html`<label class="tg"><input type="checkbox" name="scopes" value="${s}" ${request.scopes.includes(s) ? raw("checked") : ""}>
        <span><b>${SCOPES[s].label}</b><small>${SCOPES[s].detail}</small></span><i aria-hidden="true"></i></label>`,
    );
  return cpage(
    `Errand for ${look.name}`,
    human,
    html`<main class="desk">
      <div class="tkt-lift"><form method="post" action="/consent/${request.id}" class="enote tkt-form zz cc" style="${courierVars(look.color)}">
        <div class="th"><span>Errand ticket</span><span>New</span></div>
        ${
          choice
            ? html`<fieldset class="pickc"><legend>${request.clientName} is new here. Which courier is it?</legend>
              <div class="pickc-o">${choice.couriers.map(
                (c) =>
                  html`<label class="cc" style="${courierVars(c.color)}"><input type="radio" name="courier" value="${c.id}" ${c.id === choice.preselect ? raw("checked") : ""}>${portrait(c)}<span>${c.name}${c.clientId ? html`<small>in another Claude</small>` : ""}</span></label>`,
              )}</div>
              <small>One courier per Claude: this ${request.clientName} will be that courier in every chat.</small></fieldset>`
            : html`<div class="nhd">${portrait(look)}Errand for ${look.name}</div>`
        }
        <div class="shop">${merchant.name}</div>
        <label><span class="sr">What’s it for?</span>
          <input class="for" type="text" name="intent" maxlength="160" placeholder="What’s it for? e.g. Jazz records for my dad" value="${intent}" aria-label="What’s it for?"></label>
        ${error ? html`<p class="err">${error}</p>` : ""}
        <div class="lims">
          <label class="lim"><small>Max in total</small><span class="m"><i>$</i><input type="number" name="spend_limit" min="1" max="500" step="1" value="${spendLimit}" required aria-label="Max in total, dollars"></span></label>
          <label class="lim"><small>Up to, per item</small><span class="m"><i>$</i><input type="number" name="per_purchase_limit" min="1" max="500" step="1" value="${perPurchaseLimit}" required aria-label="Up to per item, dollars"></span></label>
        </div>
        <div class="backby"><small>Back by</small><div class="seg">
          ${(Object.keys(DURATIONS) as (keyof typeof DURATIONS)[]).map(
            (d, i) =>
              html`<label><input type="radio" name="duration" value="${d}" ${i === 1 ? raw("checked") : ""}><span>${durLabel[d] ?? DURATIONS[d].label}</span></label>`,
          )}</div></div>
        <details class="more"><summary>What ${choice ? "it" : look.name} may do</summary><div class="in">
          ${scopeRows}
          <label class="tg"><input type="checkbox" name="bond" value="1"><span><b>Add a $5 refundable bond</b><small>A hold on your PayPal, released when the errand ends. ${merchant.name} can only claim it if your courier is reported for abuse.</small></span><i aria-hidden="true"></i></label>
        </div></details>
        ${
          merchant.scopes.includes("store:buy")
            ? html`<label class="tg payq"><input type="checkbox" name="autopay" value="1" checked><span><b>Pay without asking</b><small>Save ${PP} for this errand, once. Purchases inside these limits are paid straight away; anything else, ${choice ? "your courier" : look.name} asks you first.</small></span><i aria-hidden="true"></i></label>`
            : ""
        }
        <div class="sees">${CK}<span>${merchant.name} sees <b>a verified person</b> and these limits. Not your name, email or PayPal account.</span></div>
        <div class="foot">
          <button class="btn ghost sm" type="submit" name="decision" value="deny" formnovalidate>Not now</button>
          <button class="btn" type="submit" name="decision" value="approve">Send ${choice ? "it" : look.name}${ARROW}</button>
        </div>
      </form></div>
    </main>`,
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
      <div class="acts-row">${paypalButton("/auth/paypal/start?login=1")}<a class="link fine" href="/start">New here? Start with the demo</a></div>
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
