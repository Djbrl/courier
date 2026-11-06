import {
  ARROW,
  avatar,
  avatarFor,
  avatarPicker,
  COURIER_COLORS,
  COURIER_NAME_HINT,
  COURIER_NAME_MAX,
  COURIER_NAME_PATTERN,
  COURIER_RESOURCE,
  type CourierColor,
  config,
  courierLayout,
  courierVars,
  html,
  idCard,
  LOGO,
  MONEY,
  money,
  PP,
  paypalFor,
  portrait,
  type RawHtml,
  raw,
  SHOPS,
  SIMULATED,
  shopLogo,
  timeAgo,
  VERIFIED,
  type Visa,
} from "@courier/shared";
import type { Approval, Connection, Courier, Human, Stamp } from "../db.ts";
import type { Friend } from "../friends.ts";
import type { Contact } from "../people.ts";
import { capFields } from "./consent.ts";
import { backBy, courierForErrand, courierLook, demoClientId, dots, firstName, lookForAgent, short } from "./shared.ts";

/* ---------------- the app: shell ---------------- */

/** A sign-out link, which asks first. A demo person can't be signed back into. */
const signOut = (d: Pick<Desk, "human">) =>
  raw(
    `href="/logout" data-sure="Sign out?" data-sure-yes="Sign out" data-sure-body="${
      d.human.simulated
        ? "This demo person and their chats go with it. Trying the demo again starts a new one."
        : "You can sign back in with PayPal any time."
    }"`,
  );

export type VisaView = Visa & { remainingCents: number; effective: string };

/** Everything the signed-in views draw from. */
export interface Desk {
  human: Human;
  couriers: Courier[];
  /** Active first, then newest. */
  visas: VisaView[];
  /** Newest first. */
  stamps: Stamp[];
  /** Pending only. */
  approvals: Approval[];
  /** Active only. */
  connections: Connection[];
  /** Where an errand's chat is, for errands sent from the errand room. */
  chatByVisa: Map<string, string>;
}

type View = "home" | "errands" | "shops" | "people" | "couriers" | "settings";
const LABEL: Record<View, string> = {
  home: "Home",
  errands: "Errands",
  shops: "Shops",
  people: "Friends",
  couriers: "Couriers",
  settings: "Settings",
};

const ICON: Record<View, string> = {
  home: '<svg viewBox="0 0 20 20"><path d="M3 9.2 10 3l7 6.2V17h-5v-4.5H8V17H3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  errands:
    '<svg viewBox="0 0 20 20"><rect x="4" y="2.8" width="12" height="14.4" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7 7h6M7 10h6M7 13h3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  shops:
    '<svg viewBox="0 0 20 20"><rect x="3" y="3" width="6" height="6" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="11" y="3" width="6" height="6" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="3" y="11" width="6" height="6" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="11" y="11" width="6" height="6" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  people:
    '<svg viewBox="0 0 20 20"><circle cx="7.5" cy="7" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="13.6" cy="8" r="2.1" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M2.8 16c.6-2.8 2.4-4.3 4.7-4.3s4.1 1.5 4.7 4.3M12.4 12.4c.4-.1.8-.2 1.2-.2 1.9 0 3.3 1.2 3.7 3.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  couriers:
    '<svg viewBox="0 0 20 20"><rect x="2.5" y="4" width="15" height="12" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="7.3" cy="9.3" r="1.9" fill="currentColor"/><path d="M11 9h4M11 12h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  settings:
    '<svg viewBox="0 0 20 20"><path d="M3 6h8M15 6h2M3 14h2M9 14h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="13" cy="6" r="2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="7" cy="14" r="2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
};

const isOut = (v: VisaView) => v.effective === "active";

export function shell(
  title: string,
  d: Desk,
  view: View | null,
  main: RawHtml,
  opts: { scripts?: string[] } = {},
): string {
  const out = d.visas.filter(isOut).length;
  const item = (v: View, label: string, href: string, n?: number, hot = false) =>
    html`<a href="${href}" data-tour="rail-${v}" ${view === v ? raw('aria-current="page"') : ""}>${raw(ICON[v])}${label}${n ? html`<span class="n ${hot ? "hot" : ""}">${n}</span>` : ""}</a>`;
  const here = view ? LABEL[view] : "Menu";
  return courierLayout({
    title: `${title} · Courier`,
    bodyClass: "app-page",
    scripts: opts.scripts,
    body: html`<div class="app">
      <aside class="rail">
        <a class="rail-logo" href="/" aria-label="Courier">${LOGO}</a>
        <button type="button" class="rail-menu" aria-expanded="false" aria-controls="rail-drawer" aria-label="Menu: ${here}">
          <span>${here}</span>${d.approvals.length ? html`<i class="rail-dot" aria-hidden="true"></i>` : ""}<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5.5h14M3 10h14M3 14.5h14"/></svg>
        </button>
        <div class="rail-drawer" id="rail-drawer">
        <nav aria-label="Courier">
          ${item("home", "Home", "/app", d.approvals.length, true)}
          ${item("errands", "Errands", "/app/errands", out)}
          ${item("shops", "Shops", "/app/shops")}
          ${item("people", "Friends", "/app/people")}
          ${item("couriers", "Couriers", "/app/couriers")}
          ${item("settings", "Settings", "/app/settings")}
        </nav>
        <div class="rail-who">${avatar()}<span><b>${firstName(d.human) ?? "You"}</b>${d.human.simulated ? SIMULATED : VERIFIED}</span><a class="fine" ${signOut(d)}>Sign out</a></div>
        </div>
      </aside>
      <main class="pane">${main}</main>
    </div>`,
  });
}

function lastStep(d: Desk, visaId: string): Stamp | undefined {
  return d.stamps.find((s) => s.visaId === visaId);
}

function meter(v: VisaView, cls = ""): RawHtml {
  const spentPct = Math.min(100, (v.spentCents / v.spendLimitCents) * 100);
  const heldCents = Math.max(0, v.spendLimitCents - v.spentCents - v.remainingCents);
  const heldPct = isOut(v) ? Math.min(100 - spentPct, (heldCents / v.spendLimitCents) * 100) : 0;
  return html`<span class="meter ${cls}" role="img" aria-label="${money(v.spentCents)} spent of ${money(v.spendLimitCents)}"><i style="width:${spentPct.toFixed(1)}%"></i><i class="held" style="width:${heldPct.toFixed(1)}%"></i></span>`;
}

/** The shops an errand has been to, or where it may go if it hasn't been anywhere yet. */
function whereTo(d: Desk, v: VisaView): string {
  const been = [...new Set(d.stamps.filter((s) => s.visaId === v.id).map((s) => s.merchantName))];
  const shops = been.filter((name) => name !== "any shop");
  return shops.length ? shops.join(", ") : v.merchantName;
}

/** Every shop as a logo. */
function shopGrid(): RawHtml {
  return html`<nav class="shopg" aria-label="Shops">${SHOPS.map(
    (s) =>
      html`<a class="shopg-t" href="${config.store.url}/${s.slug}" target="_blank" rel="noopener">${shopLogo(s)}<b>${s.name}</b><small>${s.sells}</small></a>`,
  )}</nav>`;
}

/** One errand as a row: who, what for, where, the last step, and the money. */
function errandRow(d: Desk, v: VisaView, selected = false): RawHtml {
  const look = lookForAgent(d.human, v.clientId, v.agentName);
  const step = lastStep(d, v.id);
  return html`<a class="erow cc ${isOut(v) ? "" : "off"}" style="${courierVars(look.color)}" href="${d.chatByVisa.get(v.id) ?? `/app/errands?e=${v.id}`}" ${selected ? raw('aria-current="true"') : ""}>
    ${portrait(look)}
    <span class="et"><b>${v.intent || "Anything within the limits"}</b><small>${look.name} · ${whereTo(d, v)}${step ? html` · <span class="ls">${step.title}</span>` : ""}</small></span>
    <span class="em">${meter(v, "sm")}<small><b>${short(v.spentCents)}</b> of ${short(v.spendLimitCents)}</small></span>
  </a>`;
}

/* ---------------- the page frame every view shares ---------------- */

/** A title, one line under it, at most one action, then the page. */
function page(title: string, sub: unknown, action: unknown, body: RawHtml, cls = ""): RawHtml {
  return html`<div class="pg ${cls}"><div class="pg-in">
    <header class="pg-h"><div><h1 class="big">${title}</h1>${sub ? html`<p>${sub}</p>` : ""}</div>${action ?? ""}</header>
    ${body}
  </div></div>`;
}

const CHEVRON = raw(
  '<svg class="chev" viewBox="0 0 20 20" aria-hidden="true"><path d="m8 5 5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
);

/* ---------------- home ---------------- */

/** The first look around: where things are, ending on the one thing to do next. */
function tourSteps(look: { name: string }, courierId: string) {
  return [
    {
      target: "now",
      title: "This is your dashboard.",
      body: "What your couriers spend and buy shows up here.",
    },
    {
      target: "courier",
      title: `This is ${look.name}, your courier.`,
      body: "You get one courier per AI provider, and each one can reach any shop.",
    },
    {
      target: "shops",
      title: "These are your shops.",
      body: `${look.name} can buy from any of them. They only ever see a pseudonym, never your name.`,
    },
    {
      target: "rail-errands",
      title: "Now send it on an errand.",
      body: "Just ask for anything. You set the budget, and it does the rest.",
      cta: { label: "Start an errand", href: `/errand?c=${encodeURIComponent(courierId)}` },
    },
  ];
}

/** Shops to show first: where this person's couriers have been, then a few good places to start. */
const STARTERS = ["floor-dash", "beanbucks", "juniper", "bookworm", "lord-knight", "itsy"];
function topShops(d: Desk, n = 6) {
  const visits = new Map<string, number>();
  for (const s of d.stamps) visits.set(s.merchantName, (visits.get(s.merchantName) ?? 0) + 1);
  const been = SHOPS.filter((s) => visits.has(s.name)).sort((a, b) => visits.get(b.name)! - visits.get(a.name)!);
  const rest = STARTERS.map((slug) => SHOPS.find((s) => s.slug === slug)).filter(
    (s): s is (typeof SHOPS)[number] => !!s && !been.includes(s),
  );
  return { shops: [...been, ...rest].slice(0, n), visited: been.length > 0 };
}

export function homePage(d: Desk, opts: { welcome: boolean; courierId?: string; tour?: boolean }): string {
  const { human, couriers, visas, approvals } = d;
  const sel = couriers.find((c) => c.id === opts.courierId) ?? couriers[0]!;
  const look = courierLook(human, sel);
  const name = firstName(human);
  const out = visas.filter(isOut);
  const inClaude = d.connections.length > 0;
  const visaById = new Map(visas.map((v) => [v.id, v]));

  const lead = approvals.length
    ? `${approvals.length === 1 ? "One question" : `${approvals.length} questions`} waiting for you.`
    : out.length
      ? `${out.length === 1 ? "One errand" : `${out.length} errands`} out right now.`
      : `${look.name} is ready when you are.`;
  const ask = `Get me a burger on Floor Dash. I have about $15.`;
  const spent = visas.reduce((sum, v) => sum + v.spentCents, 0);
  const others = couriers.filter((c) => c.id !== sel.id).slice(0, 2);
  const steps = d.stamps.slice(0, 4);
  const { shops, visited } = topShops(d);

  const body = html`<div class="hm3-g">
      <section class="tile li cstage hm3-stage" data-tour="courier" aria-label="Your couriers">${dots()}
        <div class="hm3-stack">
          ${others.map(
            (c) =>
              html`<a class="hm3-peek cc" style="${courierVars(c.color)}" href="/app?c=${c.id}"><b>${c.name}</b><small class="mono">${c.idNo}</small></a>`,
          )}
          <a class="hm3-card" href="/app/couriers?c=${sel.id}" aria-label="${look.name}’s details"><div class="idwrap">${idCard(look, name)}</div></a>
        </div>
      </section>
      <section class="card hm3-now" data-tour="now">
        <div class="hm3-fig"><small>Spent so far</small><b>${short(spent)}</b><span>${visas.length ? `across ${visas.length} ${visas.length === 1 ? "errand" : "errands"}` : "No errands yet"}</span></div>
        <div class="hm3-state">
          ${approvals.map((a) => {
            const v = visaById.get(a.visaId);
            const al = v ? lookForAgent(human, v.clientId, v.agentName) : look;
            return html`<a class="ask cc" style="${courierVars(al.color)}" href="/approvals/${a.id}">${portrait(al)}
              <span><b>${al.name} asks: ${a.items.map((i) => i.title.replace(/ \(.*\)$/, "")).join(", ")}, ${money(a.totalCents)}?</b><small>${a.reason}</small></span>
              <span class="btn sm">Answer</span></a>`;
          })}
          ${out.length ? html`<div class="rows">${out.slice(0, 2).map((v) => errandRow(d, v))}</div>` : ""}
        </div>
        ${
          inClaude
            ? html`<div class="hm3-claude"><small>In any Claude chat</small><code class="copy inp code sm">${ask}</code></div>`
            : html`<a class="hm3-claude link-row" href="/start/claude?c=${sel.id}"><span><b>Connect Claude</b><small>Send ${look.name} from any chat</small></span>${CHEVRON}</a>`
        }
      </section>
    </div>
    <section data-tour="shops"><div class="pg-st"><h2>${visited ? "Your shops" : "Shops to try"}</h2><a class="link fine" href="/app/shops">All shops</a></div>
      <nav class="shopg shopg-row" aria-label="Shops">${shops.map(
        (s) =>
          html`<a class="shopg-t" href="${config.store.url}/${s.slug}" target="_blank" rel="noopener">${shopLogo(s)}<b>${s.name}</b><small>${s.sells}</small></a>`,
      )}</nav></section>
    <section>
      <div class="pg-st"><h2>Activity</h2>${visas.length ? html`<a class="link fine" href="/app/errands">All errands</a>` : ""}</div>
      <div class="card pad">${
        steps.length
          ? html`<ul class="feed tight" ${out.length ? raw('data-autorefresh="8000"') : ""}>${steps.map((s) => {
              const ic = STAMP_ICON[s.kind];
              const v = visaById.get(s.visaId);
              return html`<li><span class="k ${ic.cls}" aria-hidden="true">${ic.k}</span><div><b>${s.title}</b><span class="d">${v ? lookForAgent(human, v.clientId, v.agentName).name : look.name}${s.detail ? ` · ${s.detail}` : ""}</span></div><time>${timeAgo(s.at)}</time></li>`;
            })}</ul>`
          : html`<p class="fine">What ${look.name} browses and buys shows up here.</p>`
      }</div>
    </section>`;
  const main = page(
    `${opts.welcome || !visas.length ? "Welcome" : "Hi"}${name ? `, ${name}` : ""}.`,
    lead,
    html`<a class="btn sm" id="start-errand" href="/errand?c=${sel.id}">Start an errand${ARROW}</a>`,
    body,
    "pg-wide",
  );
  return shell(
    "Home",
    d,
    "home",
    opts.tour
      ? html`${main}${raw(`<script type="application/json" id="tour">${JSON.stringify(tourSteps(look, sel.id)).replace(/</g, "\\u003c")}</script>`)}`
      : main,
    { scripts: opts.tour ? ["/assets/tour.js"] : [] },
  );
}

/* ---------------- errands: history, then one errand ---------------- */

const STAMP_ICON: Record<Stamp["kind"], { k: string; cls: string }> = {
  visa_issued: { k: "→", cls: "id" },
  browse: { k: "⌕", cls: "" },
  reserve: { k: "◷", cls: "" },
  purchase: { k: "$", cls: "buy" },
  approval: { k: "✓", cls: "ask" },
  blocked: { k: "×", cls: "no" },
  revoked: { k: "×", cls: "no" },
  report: { k: "!", cls: "no" },
  bond: { k: "◎", cls: "" },
};

export function errandsPage(d: Desk, opts: { tab?: string; errandId?: string }): string {
  const picked = d.visas.find((v) => v.id === opts.errandId);
  if (picked) return shell("Errand", d, "errands", errandDetail(d, picked));
  const out = d.visas.filter(isOut);
  const spent = d.visas.reduce((sum, v) => sum + v.spentCents, 0);
  const bought = d.stamps.filter((s) => s.kind === "purchase").length;
  const first = d.couriers.find((c) => !c.revokedAt) ?? d.couriers[0];
  const row = (v: VisaView) => {
    const look = lookForAgent(d.human, v.clientId, v.agentName);
    return html`<a class="li cc ${isOut(v) ? "" : "off"}" style="${courierVars(look.color)}" href="/app/errands?e=${v.id}">
      ${portrait(look)}<span class="li-t"><b>${v.intent || "Anything within the limits"}</b><small>${look.name} · ${whereTo(d, v)} · ${isOut(v) ? "Out now" : timeAgo(v.createdAt)}</small></span>
      <span class="li-m"><b>${short(v.spentCents)}</b><small>of ${short(v.spendLimitCents)}</small></span>${CHEVRON}</a>`;
  };
  const body = html`<section><div class="pg-st"><h2>History</h2>${out.length ? html`<span class="fine">${out.length} out now</span>` : ""}</div>
      ${
        d.visas.length
          ? html`<div class="card list">${d.visas.map(row)}</div>`
          : html`<div class="card pad blank-card"><p>No errands yet. Ask ${first?.name ?? "your courier"} for anything, with a budget.</p></div>`
      }
    </section>`;
  return shell(
    "Errands",
    d,
    "errands",
    page(
      "Errands",
      d.visas.length
        ? `${short(spent)} spent across ${d.visas.length} ${d.visas.length === 1 ? "errand" : "errands"}, ${bought} ${bought === 1 ? "thing" : "things"} bought.`
        : "Every chat with your couriers, and what it spent.",
      first ? html`<a class="btn sm" href="/errand?c=${first.id}">New errand${ARROW}</a>` : "",
      body,
    ),
  );
}

function errandDetail(d: Desk, v: VisaView): RawHtml {
  const look = lookForAgent(d.human, v.clientId, v.agentName);
  const courier = courierForErrand(d.human.id, v.clientId, v.agentName);
  const steps = d.stamps.filter((s) => s.visaId === v.id);
  const isRoom = courier && v.clientId === demoClientId(courier.id);
  const chat = isRoom ? d.chatByVisa.get(v.id) : undefined;
  const when = isOut(v)
    ? `Back by ${backBy(v.expiresAt)}`
    : (v.revokeReason ??
      (v.effective === "expired"
        ? `Back since ${backBy(v.expiresAt)}`
        : `Ended ${timeAgo(v.revokedAt ?? v.expiresAt)}`));
  const bought = steps.filter((s) => s.kind === "purchase").length;
  const body = html`<div class="ed cc" style="${courierVars(look.color)}">
    <div class="card ed-who">${portrait(look)}<span class="li-t"><b>${look.name}</b><small>${whereTo(d, v)} · ${isRoom ? "Errand room" : "Claude"} · ${bought} bought</small></span>
      <span class="ed-money"><span><b>${money(v.spentCents)}</b> of ${money(v.spendLimitCents)}</span>${meter(v, "sm")}</span>
      <span class="st ${isOut(v) ? "active" : ""}"><i></i>${isOut(v) ? "Out now" : "Done"}</span></div>
    <section><div class="pg-st"><h2>What happened</h2></div>
      <div class="card pad">${
        steps.length
          ? html`<ol class="tl" ${isOut(v) ? raw('data-autorefresh="8000"') : ""}>${steps.map(
              (s) =>
                html`<li class="${STAMP_ICON[s.kind].cls}"><b>${s.title}</b>${s.detail ? html`<span>${s.detail}</span>` : ""}<time>${timeAgo(s.at)}</time></li>`,
            )}</ol>`
          : html`<p class="fine">No steps yet.</p>`
      }</div>
      ${isOut(v) ? html`<form class="ed-end" method="post" action="/app/visas/${v.id}/revoke" data-sure="End this errand?" data-sure-body="Anything unpaid is called back." data-sure-yes="End errand"><input type="hidden" name="next" value="/app/errands?e=${v.id}"><button class="link fine danger-t" type="submit">End this errand</button></form>` : ""}
    </section>
  </div>`;
  return html`<div class="pg"><div class="pg-in">
    <a class="back fine" href="/app/errands">← All errands</a>
    <header class="pg-h"><div><h1 class="big">${v.intent || "Anything within the limits"}</h1><p>${when}${v.autopay?.status === "on" ? " · pays with saved PayPal" : ""}${v.bond ? ` · $${(v.bond.amountCents / 100).toFixed(0)} bond ${v.bond.status}` : ""}</p></div>
      ${chat ? html`<a class="btn sm" href="${chat}">Open the chat${ARROW}</a>` : ""}</header>
    ${body}
  </div></div>`;
}

/* ---------------- shops ---------------- */

export function shopsPage(d: Desk): string {
  const body = html`${shopGrid()}<p class="fine">Demo shops with made-up names and products, not affiliated with any real brand. No real money moves.</p>`;
  return shell(
    "Shops",
    d,
    "shops",
    page("Shops", "Every shop your couriers can reach. Name one when you ask, with a budget.", "", body),
  );
}

/* ---------------- friends ---------------- */

const X_ICON = raw(
  '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
);

export function peoplePage(
  d: Desk,
  people: { contact: Contact; courier: Courier | undefined; idea: string }[],
  friends: Friend[],
  link: string,
): string {
  const mine = d.couriers.find((c) => !c.revokedAt) ?? d.couriers[0]!;
  const ask = (say: string) => `/errand?c=${mine.id}&say=${encodeURIComponent(say)}`;
  const card = (
    look: { name: string; color: Courier["color"] } | undefined,
    color: Courier["color"],
    who: string,
    sub: string,
    href: string,
    remove?: RawHtml,
  ) => html`<div class="fc cc" style="${courierVars(color)}">
      ${remove ?? ""}${look ? portrait(look) : html`<span class="pt pt-empty"></span>`}
      <b>${who}</b><small>${sub}</small>
      <a class="btn ghost sm" href="${href}">Ask to an errand</a>
    </div>`;
  const body = html`<section aria-label="Your friends on Courier">
      <div class="pg-st"><h2>On Courier</h2><span class="n">${friends.length}</span></div>
      <div class="fgrid">
        ${friends.map((f) =>
          card(
            f.courier,
            f.courier?.color ?? "ink",
            f.name,
            f.courier ? `Courier ${f.courier.name}` : "No courier yet",
            ask(`Ask ${f.name} if they want to come along`),
            html`<form class="fc-x" method="post" action="/app/people/remove" data-sure="Remove ${f.name}?" data-sure-body="Your couriers won't be able to ask each other to errands." data-sure-yes="Remove"><input type="hidden" name="h" value="${f.human.id}"><button type="submit" aria-label="Remove ${f.name}">${X_ICON}</button></form>`,
          ),
        )}
        <button type="button" class="fc fc-add" data-copy="${link}"><span class="pt pt-empty">+</span><b>Add a friend</b><small>Copies your invite link</small></button>
      </div>
    </section>
    <section aria-label="Demo friends">
      <div class="pg-st"><h2>Demo friends</h2><span class="fine">Made-up people with simulated PayPal</span></div>
      <div class="fgrid">${people.map(({ contact: c, courier, idea }) =>
        card(
          courier,
          c.color,
          c.name,
          `Your ${c.relation} · courier ${c.courierName}`,
          ask(`Chip in with ${c.name} on ${idea}`),
        ),
      )}</div>
    </section>`;
  return shell(
    "Friends",
    d,
    "people",
    page(
      "Friends",
      `${mine.name} can ask them to errands by name. Each pays their own share.`,
      html`<button type="button" class="btn sm" data-copy="${link}">Copy invite link</button>`,
      body,
    ),
  );
}

/* ---------------- couriers: the card is the page ---------------- */

const COLORS = Object.keys(COURIER_COLORS) as CourierColor[];
const COLOR_LABEL: Record<string, string> = { cobalt: "Cobalt", tang: "Orange", ink: "Ink", hivis: "Hi-vis" };

export function couriersPage(d: Desk, opts: { courierId?: string }): string {
  const sel = d.couriers.find((c) => c.id === opts.courierId) ?? d.couriers[0]!;
  const look = courierLook(d.human, sel);
  const you = firstName(d.human);
  const mine = d.visas.filter((v) => courierForErrand(d.human.id, v.clientId, v.agentName)?.id === sel.id);
  const inClaude = d.connections.length > 0;
  const spent = mine.reduce((sum, v) => sum + v.spentCents, 0);
  const swatch = (c: CourierColor) =>
    html`<label title="${COLOR_LABEL[c] ?? c}"><input type="radio" name="color" value="${c}" ${look.color === c ? raw("checked") : ""} aria-label="${COLOR_LABEL[c] ?? c}"><span style="--c:${COURIER_COLORS[c].ac}"></span></label>`;
  const body = html`
    ${
      d.couriers.length > 1
        ? html`<nav class="chips" aria-label="Your couriers">${d.couriers.map(
            (c) =>
              html`<a class="chip cc" style="${courierVars(c.color)}" href="/app/couriers?c=${c.id}" ${c.id === sel.id ? raw('aria-current="true"') : ""}>${portrait(c)}${c.name}</a>`,
          )}</nav>`
        : ""
    }
    <form class="cedit card" method="post" action="/start/courier" id="setup">
      <div class="cedit-stage cstage">${dots()}<div class="wiz-id" id="preview" data-vars="${JSON.stringify(Object.fromEntries(COLORS.map((c) => [c, courierVars(c)])))}">${idCard(look, you)}</div></div>
      <div class="cedit-f">
        <input type="hidden" name="c" value="${sel.id}"><input type="hidden" name="human" value="${you ?? "You"}">
        <label class="fld"><span>Name</span><input class="inp" name="name" value="${look.name}" minlength="2" maxlength="${COURIER_NAME_MAX}" pattern="${COURIER_NAME_PATTERN}" title="${COURIER_NAME_HINT}" required autocomplete="off" autocapitalize="words" spellcheck="false"></label>
        <small class="hint" id="name-hint">${COURIER_NAME_HINT}</small>
        ${avatarPicker(look.avatar ?? avatarFor(look.name))}
        <div class="fld"><span>Colour</span><div class="sw">${COLORS.filter((c) => COLOR_LABEL[c]).map(swatch)}</div></div>
        <button class="btn sm" type="submit">Save card</button>
        <p class="cedit-n">${mine.length} ${mine.length === 1 ? "errand" : "errands"} · ${short(spent)} spent · since ${new Date(sel.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</p>
      </div>
    </form>
    <div class="card list">
      <div class="li"><span class="dot ${inClaude ? "on" : ""}"></span><span class="li-t"><b>Claude</b><small>${inClaude ? `Connected. Say “send ${sel.name}” in any chat.` : "Not connected yet"}</small></span>
        <a class="btn ${inClaude ? "ghost" : ""} sm" href="${inClaude ? "/app/settings" : `/start/claude?c=${sel.id}`}">${inClaude ? "Manage" : "Connect"}</a></div>
      <div class="li"><span class="dot on"></span><span class="li-t"><b>Errand room</b><small>Chat with ${sel.name} on this website</small></span>
        <a class="btn ghost sm" href="/errand?c=${sel.id}">Open</a></div>
      ${
        sel.revokedAt
          ? html`<div class="li"><span class="dot no"></span><span class="li-t"><b>Revoked</b><small>It can't start errands. Revoked ${timeAgo(sel.revokedAt)}.</small></span>
            <form method="post" action="/app/couriers/${sel.id}/restore"><button class="btn ghost sm" type="submit">Restore</button></form></div>`
          : html`<div class="li"><span class="dot"></span><span class="li-t"><b>Revoke ${look.name}</b><small>Ends its open errands now and stops new ones.</small></span>
            <form method="post" action="/app/couriers/${sel.id}/revoke" data-sure="Revoke ${look.name}?" data-sure-body="Its open errands end now." data-sure-yes="Revoke"><button class="btn danger sm" type="submit">Revoke</button></form></div>`
      }
    </div>`;
  return shell(
    look.name,
    d,
    "couriers",
    page(
      "Couriers",
      "Your courier’s card is what shops see. Make it yours.",
      html`<a class="btn ghost sm" href="/start/courier?new=1">New courier</a>`,
      body,
    ),
    { scripts: ["/assets/onboard.js"] },
  );
}

/* ---------------- settings ---------------- */

const row = (title: unknown, sub: unknown, action?: unknown) =>
  html`<div class="li"><span class="li-t"><b>${title}</b><small>${sub}</small></span>${action ?? ""}</div>`;

type SettingsTab = "connections" | "security" | "account";

export function settingsPage(d: Desk, savedEmail?: string | null | false): string {
  const first = d.couriers[0]!;
  const inClaude = d.connections.length > 0;
  const hasSaved = savedEmail !== undefined;
  const panes: Record<SettingsTab, RawHtml> = {
    connections: html`<div class="card list">
      ${row(PP, `${d.human.simulated ? "Demo person." : "Verified."} ${MONEY[paypalFor(d.human).mode].note}`)}
      ${row(
        "Saved PayPal",
        hasSaved
          ? savedEmail
            ? `Pays for errands: ${savedEmail}`
            : "Pays for errands inside your budget."
          : "Not saved. You’ll be offered this on your next errand.",
        hasSaved
          ? html`<form method="post" action="/app/paypal/remove"><button class="btn ghost sm" type="submit">Remove</button></form>`
          : "",
      )}
      ${row(
        "Claude",
        inClaude ? `Connected. It can send ${d.couriers.map((c) => c.name).join(", ")}.` : "Not connected yet.",
        d.connections.length
          ? html`${d.connections.map(
              (c) =>
                html`<form method="post" action="/app/connections/${c.id}/revoke"><button class="btn ghost sm" type="submit" title="Ends its errands and removes its access">Disconnect</button></form>`,
            )}`
          : html`<a class="btn sm" href="/start/claude?c=${first.id}">Connect</a>`,
      )}
      ${row("Connector address", "For Claude or any MCP agent.", html`<button type="button" class="btn ghost sm" data-copy="${COURIER_RESOURCE}">Copy</button>`)}
    </div>`,
    security: html`<form class="card list" method="post" action="/app/settings/cap">
      <div class="li li-cap"><span class="li-t"><b>Spend without asking</b><small>Above this, Claude asks you first. 0 always asks. Errand budgets can't go over the per-errand amount.${d.human.cap ? "" : " Off until you save."}</small></span>
        ${capFields(d.human)}<button class="btn sm" type="submit">Save</button></div>
    </form>`,
    account: html`<div class="card list">
      ${row(firstName(d.human) ?? "You", "Your name is never shared with shops.", html`<a class="btn ghost sm" ${signOut(d)}>Sign out</a>`)}
      ${row("Delete account", "Erase everything and start again from scratch.", html`<a class="btn danger sm" href="/app/account/delete">Delete</a>`)}
    </div>`,
  };
  const section = (title: string, pane: RawHtml) =>
    html`<section><div class="pg-st"><h2>${title}</h2></div>${pane}</section>`;
  const body = html`${section("Connections", panes.connections)}${section("Security", panes.security)}${section("Account", panes.account)}`;
  return shell("Settings", d, "settings", page("Settings", "", "", body, "pg-narrow"));
}

export function deleteAccountPage(d: Desk): string {
  const out = d.visas.filter(isOut).length;
  const main = html`<div class="conn">
    <header class="conn-h"><h1 class="big">Delete your account?</h1></header>
    <section class="panel cbox gone">
      <p class="lead">This erases your account right away, and it can't be undone.</p>
      <ul class="gone-list">
        <li>Your couriers, errands and history are erased.</li>
        <li>${out ? `${out === 1 ? "Your 1 errand" : `Your ${out} errands`} still out will be called back.` : "You have no errands out."} Any bond or saved PayPal is released.</li>
        <li>Any Claude connected to Courier loses access.</li>
      </ul>
      <p class="fine">Receipts you already have keep working. Shops keep their own order records, which don't include your name, and PayPal keeps its own payment history.</p>
      <form class="acts-row" method="post" action="/app/account/delete">
        <button class="btn danger" type="submit">Delete my account</button>
        <a class="btn ghost" href="/app/settings">Keep my account</a>
      </form>
    </section>
  </div>`;
  return shell("Delete account", d, null, main);
}
