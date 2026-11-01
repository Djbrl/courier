import {
  avatar,
  config,
  courierVars,
  html,
  LOGO,
  PP,
  paypalFor,
  portrait,
  raw,
  SIMULATED,
  VERIFIED,
  type Visa,
} from "@courier/shared";
import type { Courier } from "../db.ts";
import { type Desk, shell } from "./app.ts";
import { backBy, courierLook, firstName, short } from "./shared.ts";

/* ---------------- the errand room ---------------- */

export function errandRoom(d: Desk, visa: Visa, courier: Courier): string {
  const look = courierLook(d.human, courier);
  const boot = {
    courier: { ...look, id: courier.id, vars: courierVars(look.color) },
    human: firstName(d.human) ?? "you",
    storeUrl: config.store.url,
    storeName: config.store.name,
    paypal: paypalFor(d.human).mode,
    live: config.anthropicConfigured,
    visa: {
      id: visa.id,
      intent: visa.intent,
      spendLimitCents: visa.spendLimitCents,
      perPurchaseLimitCents: visa.perPurchaseLimitCents,
      expiresAt: visa.expiresAt,
    },
    portrait: portrait(look).value,
    receiptParts: {
      logo: LOGO.value,
      verified: (d.human.simulated ? SIMULATED : VERIFIED).value,
      avatar: avatar().value,
      pp: PP.value,
    },
  };
  const main = html`<div class="room cc" style="${courierVars(look.color)}">
      <section class="chat" aria-label="Chat with ${look.name}">
        <div class="chat-h">${portrait(look)}<div><b>${look.name}</b><small>at ${visa.merchantName} · back by ${backBy(visa.expiresAt)}</small></div>
          <div class="lim-pill"><b id="spent">$0</b> of ${short(visa.spendLimitCents)}<br>spent</div></div>
        <div class="log" id="log" aria-live="polite"></div>
        <div class="sugs" id="sugs">
          <button type="button" data-say="Find a jazz record under $40 and buy it">Jazz record under $40</button>
          <button type="button" data-say="Buy the felt slipmat too">A felt slipmat</button>
          <button type="button" data-say="Buy the compact turntable">A $149 turntable</button>
          <button type="button" data-say="Show my visa">What can you do?</button>
        </div>
        <form class="compose" id="compose"><input id="say" autocomplete="off" placeholder="Ask ${look.name}…" aria-label="Message ${look.name}">
          <button type="submit" aria-label="Send"><svg viewBox="0 0 16 16"><use href="#arr"/></svg></button></form>
        <p class="demo-tag">${config.anthropicConfigured ? `${look.name} runs on Claude (${config.agent.model}).` : `Demo: a scripted stand-in for Claude, calling the real shop tools. Your own Claude works the same way.`}</p>
      </section>
      <section class="shopf" aria-label="${config.store.name} shop front">
        <div class="shopf-h"><div class="jr"><span class="jr-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor"/><circle cx="12" cy="12" r="6.5" fill="none" stroke="#fff" stroke-width="1" opacity=".5"/><circle cx="12" cy="12" r="2.6" fill="#fff"/></svg></span>
          <div><b>${config.store.name}</b><small>Independent record shop</small></div></div>
          <span class="welcome">${LOGO}<span>couriers welcome</span></span></div>
        <div class="shopf-filters" id="filters"></div>
        <div class="shelf" id="shelf"><p class="fine">Opening the shop…</p></div>
      </section>
    </div>
    ${raw(`<script type="application/json" id="boot">${JSON.stringify(boot).replace(/</g, "\\u003c")}</script>`)}`;
  return shell(`${look.name}'s errand`, d, "errands", main, { scripts: ["/assets/errand.js"] });
}
