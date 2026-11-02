import { ARROW, config, courierVars, html, LOGO, PP, paypalFor, portrait, raw, SHOPS, shopLogo } from "@courier/shared";
import type { Courier } from "../db.ts";
import { FREE_MESSAGES, messagesLeft } from "../room.ts";
import { type Desk, shell } from "./app.ts";
import { courierLook, firstName } from "./shared.ts";

/* ---------------- the errand room ---------------- */

/** Ideas to start from. One for each kind of shop, so the first errand shows a courier isn't tied to one. */
export const ERRAND_IDEAS = ["A burger", "Flowers for my mum", "A good novel", "Running shoes", "Jazz on vinyl"];
/** One errand can cover several things: the courier sends a helper for each. */
const SEVERAL = { label: "Several things at once", say: "A burger, flowers and a good novel, budget $60" };

export function errandRoom(d: Desk, courier: Courier, chat: unknown, list: unknown): string {
  const look = courierLook(d.human, courier);
  const connect = `/start/claude?c=${encodeURIComponent(courier.id)}`;
  const human = firstName(d.human) ?? "there";
  const boot = {
    courier: { ...look, id: courier.id, vars: courierVars(look.color) },
    human,
    welcome: `Hey ${human}, welcome to the Courier demo! I’m ${look.name}. The real Courier experience is [connecting Courier’s MCP server](${config.courier.url}${connect}) to your Claude or any agent you use. This window is the demo, with ${FREE_MESSAGES} free messages. Use them on whatever you like.`,
    free: FREE_MESSAGES,
    left: messagesLeft(d.human),
    origins: [new URL(config.courier.url).origin, new URL(config.store.url).origin],
    paypal: paypalFor(d.human).mode,
    ideas: ERRAND_IDEAS,
    several: SEVERAL,
    chat,
    list,
    portrait: portrait(look).value,
    receiptParts: {
      logo: LOGO.value,
      pp: PP.value,
    },
  };
  const main = html`<section class="rm cc" style="${courierVars(look.color)}" aria-label="Chat with ${look.name}">
      <header class="rm-h">
        ${portrait(look)}<div class="rm-who"><b>${look.name}</b><small>Your courier</small></div>
        <div class="rm-shops" role="group" aria-label="Shops ${look.name} can reach">
          ${SHOPS.map((s) => html`<button type="button" title="${s.name}: ${s.sells}" aria-label="What does ${s.name} have?" data-say="What does ${s.name} have?">${shopLogo(s)}</button>`)}
        </div>
        <button type="button" class="link fine rm-new" id="new-chat">New errand</button>
      </header>
      <div class="rm-tickets" id="tickets" aria-label="Your errand chats" hidden></div>
      <div class="rm-budget" id="budget" hidden></div>
      <div class="log rm-log" id="log" aria-live="polite"></div>
      <div class="rm-foot">
        <div class="sugs rm-sugs" id="sugs"></div>
        <form class="compose" id="compose"><input id="say" autocomplete="off" placeholder="Ask ${look.name} for anything…" aria-label="Message ${look.name}">
          <button type="submit" aria-label="Send"><svg viewBox="0 0 16 16"><use href="#arr"/></svg></button></form>
        <div class="rm-end" id="demo-end" hidden>
          <b>That’s the end of the demo.</b>
          <p>You’ve used your ${FREE_MESSAGES} free messages. Your chats and receipts stay here. To keep going, connect Courier to your own agent.</p>
          <div class="after"><a class="btn sm" href="${connect}">Connect to Claude${ARROW}</a><a class="btn ghost sm" href="/developers">Use another agent</a></div>
        </div>
        <p class="demo-tag">${config.anthropicConfigured ? `${look.name} runs on Claude.` : `A scripted stand-in for Claude, using the real shop tools.`} ${paypalFor(d.human).mode === "simulated" ? "Simulated PayPal: no real money." : "PayPal sandbox: no real money."} <span id="left"></span></p>
      </div>
    </section>
    ${raw(`<script type="application/json" id="boot">${JSON.stringify(boot).replace(/</g, "\\u003c")}</script>`)}`;
  return shell(`${look.name}’s errands`, d, "errands", main, { scripts: ["/assets/errand.js"] });
}
