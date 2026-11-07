import {
  avatar,
  avatarFor,
  type CourierLook,
  courierLayout,
  html,
  isAvatar,
  LOGO,
  money,
  paypal,
  type RawHtml,
  raw,
} from "@courier/shared";
import { type Connection, type Courier, courierIdNo, db, type Human, listCouriers } from "../db.ts";

/** Skips signing in with a throwaway person. With no credentials, the PayPal button is already the simulator. */
export function tryDemo(where: { req?: string; next?: string }): RawHtml | string {
  if (paypal.mode === "simulated") return "";
  return html`<form method="post" action="/auth/demo" class="try-demo">
    ${where.req ? html`<input type="hidden" name="req" value="${where.req}">` : ""}
    ${where.next ? html`<input type="hidden" name="next" value="${where.next}">` : ""}
    <button class="link fine" type="submit">Try the demo instead</button>
  </form>`;
}

/* ---------------- looks ---------------- */

export const DEMO_CLIENT_PREFIX = "courier-demo-";
/** The OAuth client the errand room uses to act as a courier. */
export const demoClientId = (courierId: string) => `${DEMO_CLIENT_PREFIX}${courierId}`;

/** First name to greet the person with. */
export function firstName(human: Human | null): string | null {
  return human?.displayName?.trim().split(/\s+/)[0] || null;
}

/** The courier a given OAuth client acts as: its errand-room client, or the person's own Claude once bound. */
export function courierForClient(humanId: string, clientId: string): Courier | undefined {
  return listCouriers(humanId).find((c) => demoClientId(c.id) === clientId || c.clientId === clientId);
}

/** A courier's look, or the default (Juno, cobalt) before the person has set one up. */
export function courierLook(human: Human | null, courier?: Courier | null): CourierLook {
  const simulated = human?.simulated;
  if (courier)
    return {
      name: courier.name,
      color: courier.color,
      avatar: isAvatar(courier.avatar) ? courier.avatar : avatarFor(courier.name),
      model: courier.model,
      idNo: courier.idNo,
      simulated,
    };
  return {
    name: "Juno",
    color: "cobalt",
    avatar: "shades",
    model: "Claude",
    idNo: human ? courierIdNo(human.id, "Juno") : "CR-0000-JU",
    simulated,
  };
}

/** A Claude connected through any connector. Through the Courier connector it can send every courier. */
export const hasClaude = (human: Human) =>
  db.list<Connection>(
    "connections",
    (c) => c.humanId === human.id && c.status === "active" && !c.clientId.startsWith(DEMO_CLIENT_PREFIX),
    1,
  ).length > 0;

/** The courier an errand went out as: by the name on the errand, since one Claude can send any of them. */
export function courierForErrand(humanId: string, clientId: string, agentName: string): Courier | undefined {
  return listCouriers(humanId).find((c) => c.name === agentName) ?? courierForClient(humanId, clientId);
}

/** How an agent holding a visa looks: the person's courier when it's one of theirs, otherwise a plain ink ID. */
export function lookForAgent(human: Human, clientId: string, agentName: string): CourierLook {
  const courier = courierForErrand(human.id, clientId, agentName);
  if (courier) return courierLook(human, courier);
  return {
    name: agentName,
    color: "ink",
    model: /claude/i.test(agentName) ? "Claude" : "an AI model",
    idNo: courierIdNo(human.id, agentName),
  };
}

export const backBy = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
export const short = (cents: number) => money(cents).replace(".00", "");

/* ---------------- chrome ---------------- */

let dotsSvg = "";
/** The light halftone dot field that fades in from a panel's corner. */
export function dots(): RawHtml {
  if (!dotsSvg) {
    let s = '<svg viewBox="0 0 400 500" preserveAspectRatio="xMaxYMin slice"><g fill="currentColor">';
    for (let y = 0; y <= 500; y += 16)
      for (let x = 0; x <= 400; x += 16) {
        const f = Math.max(0, 1 - Math.hypot(400 - x, y) / 330);
        const r = 3.6 * f * f;
        if (r > 0.4) s += `<circle cx="${x}" cy="${y}" r="${r.toFixed(2)}"/>`;
      }
    dotsSvg = `<div class="dots" aria-hidden="true">${s}</g></svg></div>`;
  }
  return raw(dotsSvg);
}

/** The site's links, the same on the landing page and every page around it. There's no sign-in: the demo is the way in. */
export function navLinks(human: Human | null, here = ""): RawHtml {
  const name = firstName(human);
  const link = (href: string, label: string) =>
    html`<a class="hide-sm" href="${href}" ${href === here ? raw('aria-current="page"') : ""}>${label}</a>`;
  return html`${link("/for-shops", "For shops")}${link("/install", "Install the MCP")}
      ${
        human
          ? html`<a class="who" href="/app">${avatar()}${name ?? "My Courier"}</a>`
          : html`<a class="try" href="/start">Try the demo</a>`
      }`;
}

export function cnav(human: Human | null, here = ""): RawHtml {
  return html`<header class="cnav">
    <a href="/" aria-label="Courier home">${LOGO}</a>
    <nav>${navLinks(human, here)}</nav>
  </header>`;
}

export function cpage(
  title: string,
  human: Human | null,
  body: RawHtml,
  opts: { bodyClass?: string; scripts?: string[]; head?: RawHtml; nav?: boolean; here?: string } = {},
): string {
  return courierLayout({
    title: `${title} · Courier`,
    nav: opts.nav === false ? undefined : cnav(human, opts.here),
    body,
    bodyClass: opts.bodyClass,
    scripts: opts.scripts,
    head: opts.head,
  });
}

export const OK = raw(
  '<span class="okc" aria-hidden="true"><svg viewBox="0 0 12 12"><path d="M2.5 6.2 5 8.6l4.6-5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>',
);

const STEPS = ["Sign in", "Your courier", "Try it"];
export function progress(step: number): RawHtml {
  return html`<div class="prog" role="progressbar" aria-valuemin="1" aria-valuemax="${STEPS.length}" aria-valuenow="${step}" aria-label="Step ${step} of ${STEPS.length}: ${STEPS[step - 1]}">
    ${STEPS.map((_, i) => html`<i class="${i < step ? "on" : ""}"></i>`)}</div>`;
}
