import {
  ARROW,
  avatar,
  CK,
  config,
  courierLayout,
  courierVars,
  html,
  idCard,
  LOGO,
  money,
  PP,
  paypal,
  portrait,
  type RawHtml,
  raw,
  STORE_RESOURCE,
  timeAgo,
  VERIFIED,
  type Visa,
} from "@courier/shared";
import type { Approval, Connection, Courier, Human, Stamp } from "../db.ts";
import { backBy, courierForClient, courierLook, demoClientId, dots, firstName, lookForAgent, short } from "./shared.ts";

/* ---------------- the app: shell ---------------- */

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
}

type View = "home" | "errands" | "couriers" | "settings";

const ICON: Record<View, string> = {
  home: '<svg viewBox="0 0 20 20"><path d="M3 9.2 10 3l7 6.2V17h-5v-4.5H8V17H3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  errands:
    '<svg viewBox="0 0 20 20"><rect x="4" y="2.8" width="12" height="14.4" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7 7h6M7 10h6M7 13h3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
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
    html`<a href="${href}" ${view === v ? raw('aria-current="page"') : ""}>${raw(ICON[v])}${label}${n ? html`<span class="n ${hot ? "hot" : ""}">${n}</span>` : ""}</a>`;
  return courierLayout({
    title: `${title} · Courier`,
    bodyClass: "app-page",
    scripts: opts.scripts,
    body: html`<div class="app">
      <aside class="rail">
        <a class="rail-logo" href="/" aria-label="Courier">${LOGO}</a>
        <nav aria-label="Courier">
          ${item("home", "Home", "/app", d.approvals.length, true)}
          ${item("errands", "Errands", "/app/errands", out)}
          ${item("couriers", "Couriers", "/app/couriers")}
          ${item("settings", "Settings", "/app/settings")}
        </nav>
        <div class="rail-who">${avatar()}<span><b>${firstName(d.human) ?? "You"}</b>${VERIFIED}</span><a class="fine" href="/logout">Sign out</a></div>
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

/** One errand as a row: who, what for, where, the last step, and the money. */
function errandRow(d: Desk, v: VisaView, selected = false): RawHtml {
  const look = lookForAgent(d.human, v.clientId, v.agentName);
  const step = lastStep(d, v.id);
  return html`<a class="erow cc ${isOut(v) ? "" : "off"}" style="${courierVars(look.color)}" href="/app/errands?e=${v.id}" ${selected ? raw('aria-current="true"') : ""}>
    ${portrait(look)}
    <span class="et"><b>${v.intent || "Anything within the limits"}</b><small>${look.name} · ${v.merchantName}${step ? html` · <span class="ls">${step.title}</span>` : ""}</small></span>
    <span class="em">${meter(v, "sm")}<small><b>${short(v.spentCents)}</b> of ${short(v.spendLimitCents)}</small></span>
  </a>`;
}

/* ---------------- home ---------------- */

export function homePage(d: Desk, opts: { welcome: boolean; courierId?: string }): string {
  const { human, couriers, visas, approvals } = d;
  const sel = couriers.find((c) => c.id === opts.courierId) ?? couriers[0]!;
  const look = courierLook(human, sel);
  const name = firstName(human);
  const out = visas.filter(isOut);
  const past = visas.filter((v) => !isOut(v));
  const selErrand = out.find((v) => v.clientId === demoClientId(sel.id));
  const inClaude = couriers.filter((c) => c.clientId);
  const visaById = new Map(visas.map((v) => [v.id, v]));

  const lead = approvals.length
    ? `${approvals.length === 1 ? "One question" : `${approvals.length} questions`} waiting for you.`
    : out.length
      ? `${out.length === 1 ? "One errand" : `${out.length} errands`} out right now.`
      : `${look.name} is ready when you are.`;
  const ask = `Find me a jazz record under $40 at ${config.store.name}.`;
  const live = new Set(out.map((v) => v.id));
  const latest = d.stamps.filter((s) => live.has(s.visaId)).slice(0, 4);

  const main = html`<div class="hm2">
    <header class="hm2-top">
      <h1 class="big">${opts.welcome || !visas.length ? "Welcome" : "Hi"}${name ? `, ${name}` : ""}.</h1>
      <p class="lead">${lead}</p>
    </header>
    <div class="hm2-g">
      <div class="hm2-main">
        ${
          approvals.length
            ? html`<section class="panel hm2-s"><h2 class="sec-t">Needs you</h2>${approvals.map((a) => {
                const v = visaById.get(a.visaId);
                const al = v ? lookForAgent(human, v.clientId, v.agentName) : look;
                return html`<a class="ask cc" style="${courierVars(al.color)}" href="/approvals/${a.id}">${portrait(al)}
                  <span><b>${al.name} asks: ${a.items.map((i) => i.title.replace(/ \(.*\)$/, "")).join(", ")}, ${money(a.totalCents)}?</b><small>${a.reason}</small></span>
                  <span class="btn sm">Answer</span></a>`;
              })}</section>`
            : ""
        }
        ${
          out.length
            ? html`<section class="panel hm2-s"><h2 class="sec-t">Out now</h2><div class="rows">${out.map((v) => errandRow(d, v))}</div></section>`
            : ""
        }
        ${
          latest.length
            ? html`<section class="panel hm2-s"><h2 class="sec-t">Latest steps</h2><ul class="feed tight" data-autorefresh="8000">${latest.map(
                (s) => {
                  const ic = STAMP_ICON[s.kind];
                  const v = visaById.get(s.visaId)!;
                  return html`<li><span class="k ${ic.cls}" aria-hidden="true">${ic.k}</span><div><b>${s.title}</b><span class="d">${lookForAgent(human, v.clientId, v.agentName).name}${s.detail ? ` · ${s.detail}` : ""}</span></div><time>${timeAgo(s.at)}</time></li>`;
                },
              )}</ul></section>`
            : ""
        }
        ${
          !approvals.length && !out.length
            ? html`<section class="panel hm2-s hm2-start">
                <h2 class="sec-t">${visas.length ? "Send it on an errand" : "Your first errand"}</h2>
                ${
                  sel.clientId
                    ? html`<p>In any Claude chat, ask:</p><code class="copy inp code sm">${ask}</code>`
                    : html`<p>Connect Claude and just ask it to buy something.</p><a class="btn" href="/start/claude?c=${sel.id}">Connect Claude</a>`
                }
                <a class="link fine" href="${selErrand ? `/errand?c=${sel.id}` : `/errand/new?c=${sel.id}`}">Or try it on this website</a>
              </section>`
            : ""
        }
        ${
          past.length
            ? html`<section class="panel hm2-s"><h2 class="sec-t">Recently</h2><div class="rows">${past.slice(0, 3).map((v) => errandRow(d, v))}</div>
                <a class="link fine" href="/app/errands">All errands</a></section>`
            : ""
        }
      </div>
      <aside class="hm2-side">
        <section class="panel hm2-s">
          <h2 class="sec-t">Couriers</h2>
          ${couriers.map(
            (c) =>
              html`<a class="hm2-c cc" style="${courierVars(c.color)}" href="/app/couriers?c=${c.id}">${portrait(c)}<span><b>${c.name}</b><small class="mono">${c.idNo}</small></span></a>`,
          )}
          <a class="link fine" href="/start/courier?new=1">New courier</a>
        </section>
        <section class="panel hm2-s">
          <h2 class="sec-t">Status</h2>
          <ul class="hm2-st">
            <li class="ok">${CK}<span>Verified PayPal account<small>${paypal.mode === "simulated" ? "Simulated" : "Sandbox"}</small></span></li>
            <li class="${inClaude.length ? "ok" : "todo"}"><i aria-hidden="true"></i><span>${inClaude.length ? `In Claude: ${inClaude.map((c) => c.name).join(", ")}` : html`<a class="link" href="/start/claude?c=${sel.id}">Connect Claude</a>`}</span></li>
          </ul>
          <a class="link fine" href="/app/settings">Settings</a>
        </section>
      </aside>
    </div>
  </div>`;
  return shell("Home", d, "home", main);
}

/* ---------------- errands: list + detail ---------------- */

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
  const out = d.visas.filter(isOut);
  const past = d.visas.filter((v) => !isOut(v));
  const picked = d.visas.find((v) => v.id === opts.errandId);
  const tab =
    opts.tab === "past" || opts.tab === "out"
      ? opts.tab
      : picked
        ? isOut(picked)
          ? "out"
          : "past"
        : out.length
          ? "out"
          : "past";
  const list = tab === "out" ? out : past;
  const sel = picked ?? list[0];
  const first = d.couriers[0];

  const main = html`<div class="split">
    <section class="panel lst" aria-label="Errands">
      <div class="lst-h"><h1 class="big">Errands</h1>
        <nav class="seg-tabs"><a href="/app/errands?tab=out" ${tab === "out" ? raw('aria-current="true"') : ""}>Out now <span>${out.length}</span></a><a href="/app/errands?tab=past" ${tab === "past" ? raw('aria-current="true"') : ""}>Past <span>${past.length}</span></a></nav></div>
      <div class="rows scroll">${list.length ? list.map((v) => errandRow(d, v, v.id === sel?.id)) : html`<p class="empty">${tab === "out" ? "Nothing out right now." : "No past errands yet."}</p>`}</div>
      ${first ? html`<div class="panel-f"><a class="btn sm" href="/errand/new?c=${first.id}">New errand${ARROW}</a></div>` : ""}
    </section>
    ${sel ? errandDetail(d, sel) : html`<section class="panel dtl empty-dtl"><div><h2 class="big">No errand picked.</h2><p class="lead">Errands you send show up here, with every step.</p></div></section>`}
  </div>`;
  return shell("Errands", d, "errands", main);
}

function errandDetail(d: Desk, v: VisaView): RawHtml {
  const look = lookForAgent(d.human, v.clientId, v.agentName);
  const courier = courierForClient(d.human.id, v.clientId);
  const steps = d.stamps.filter((s) => s.visaId === v.id);
  const isRoom = courier && v.clientId === demoClientId(courier.id);
  const ended =
    v.revokeReason ??
    (v.effective === "expired" ? `Back since ${backBy(v.expiresAt)}` : `Ended ${timeAgo(v.revokedAt ?? v.expiresAt)}`);
  return html`<section class="panel dtl cc" style="${courierVars(look.color)}" aria-label="Errand">
    <header class="dtl-h">
      ${portrait(look)}<div class="dtl-t"><b>${v.merchantName}</b><small>${look.name} · ${isRoom ? "errand room" : "Claude"} · ${isOut(v) ? `back by ${backBy(v.expiresAt)}` : ended}${v.autopay?.status === "on" ? " · pays with saved PayPal" : ""}${v.bond ? ` · $${(v.bond.amountCents / 100).toFixed(0)} bond ${v.bond.status}` : ""}</small></div>
      <span class="dtl-a">
        ${isOut(v) && isRoom ? html`<a class="btn sm" href="/errand?c=${courier!.id}">Open${ARROW}</a>` : ""}
        ${isOut(v) ? html`<form method="post" action="/app/visas/${v.id}/revoke"><input type="hidden" name="next" value="/app/errands?e=${v.id}"><button class="btn danger sm" type="submit">Call back</button></form>` : ""}
      </span>
    </header>
    <div class="dtl-b">
      <div class="dtl-facts">
        ${v.intent ? html`<div class="fact"><p class="dtl-for">${v.intent}</p></div>` : ""}
        <div class="fact">${meter(v)}<div class="money-row"><span><b>${money(v.spentCents)}</b> spent</span><span>of ${money(v.spendLimitCents)}</span></div></div>
        <div class="fact grow">
          ${
            steps.length
              ? html`<ul class="feed scroll" ${isOut(v) ? raw('data-autorefresh="8000"') : ""}>${steps.map((s) => {
                  const ic = STAMP_ICON[s.kind];
                  return html`<li><span class="k ${ic.cls}" aria-hidden="true">${ic.k}</span><div><b>${s.title}</b>${s.detail ? html`<span class="d">${s.detail}</span>` : ""}</div><time>${timeAgo(s.at)}</time></li>`;
                })}</ul>`
              : html`<p class="fine">No steps yet.</p>`
          }
        </div>
      </div>
    </div>
  </section>`;
}

/* ---------------- couriers: list + detail ---------------- */

export function couriersPage(d: Desk, opts: { courierId?: string }): string {
  const sel = d.couriers.find((c) => c.id === opts.courierId) ?? d.couriers[0]!;
  const look = courierLook(d.human, sel);
  const mine = d.visas.filter((v) => courierForClient(d.human.id, v.clientId)?.id === sel.id);
  const spent = mine.reduce((sum, v) => sum + v.spentCents, 0);
  const out = mine.filter(isOut);
  const roomErrand = out.find((v) => v.clientId === demoClientId(sel.id));
  const main = html`<div class="split">
    <section class="panel lst" aria-label="Couriers">
      <div class="lst-h"><h1 class="big">Couriers</h1></div>
      <div class="rows scroll">${d.couriers.map(
        (
          c,
        ) => html`<a class="erow cc" style="${courierVars(c.color)}" href="/app/couriers?c=${c.id}" ${c.id === sel.id ? raw('aria-current="true"') : ""}>
          ${portrait(c)}<span class="et"><b>${c.name}</b><small class="mono">${c.idNo}</small></span>
          <span class="where-pill ${c.clientId ? "on" : ""}">${c.clientId ? "In Claude" : "Errand room"}</span></a>`,
      )}</div>
      <div class="panel-f"><a class="btn sm" href="/start/courier?new=1">New courier${ARROW}</a></div>
    </section>
    <section class="dtl-c" aria-label="${look.name}">
      <div class="tile li cstage">${dots()}<div class="tile-in">
        <div class="desk-card"><div class="idwrap">${idCard(look, firstName(d.human))}</div></div>
        <div class="bottom"><a class="link fine" href="/start/courier?c=${sel.id}">Edit name and colour</a><span class="fine">Since ${new Date(sel.createdAt).toLocaleDateString("en-GB", { dateStyle: "medium" })}</span></div>
      </div></div>
      <div class="panel lives">
        <h2 class="sec-t">Summon it</h2>
        <div class="live-row ${sel.clientId ? "on" : ""}"><i aria-hidden="true"></i><div><b>In Claude</b><small>${sel.clientId ? `Connected as ${sel.clientName ?? "Claude"}` : "Not connected yet"}</small></div>
          <a class="btn ${sel.clientId ? "ghost" : ""} sm" href="/start/claude?c=${sel.id}">${sel.clientId ? "How to summon" : "Set up"}${sel.clientId ? "" : ARROW}</a></div>
        <div class="live-row on"><i aria-hidden="true"></i><div><b>Errand room</b><small>On this website</small></div>
          <a class="btn sm" href="${roomErrand ? `/errand?c=${sel.id}` : `/errand/new?c=${sel.id}`}">${roomErrand ? "Open" : "Send"}${ARROW}</a></div>
        <p class="fine lives-f">${mine.length ? `${mine.length} ${mine.length === 1 ? "errand" : "errands"} · ${short(spent)} spent` : "No errands yet"}</p>
      </div>
    </section>
  </div>`;
  return shell(look.name, d, "couriers", main);
}

/* ---------------- connections ---------------- */

const row = (title: unknown, sub: unknown, action?: unknown) =>
  html`<div class="srow"><div><b>${title}</b><small>${sub}</small></div>${action ?? ""}</div>`;

export function settingsPage(d: Desk, savedEmail?: string | null | false): string {
  const first = d.couriers[0]!;
  const inClaude = d.couriers.filter((c) => c.clientId);
  const hasSaved = savedEmail !== undefined;
  const main = html`<div class="sett">
    <h1 class="big">Settings</h1>
    <section><h2 class="sec-t">Connections</h2><div class="panel slist">
      ${row(PP, `Verified. ${paypal.mode === "sandbox" ? "Sandbox" : "Simulated"}: no real money.`)}
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
        inClaude.length ? `Connected as ${inClaude.map((c) => c.name).join(", ")}.` : "Not connected yet.",
        d.connections.length
          ? html`${d.connections.map(
              (c) =>
                html`<form method="post" action="/app/connections/${c.id}/revoke"><button class="btn ghost sm" type="submit" title="Ends its errands and removes its access">Disconnect</button></form>`,
            )}`
          : html`<a class="btn sm" href="/start/claude?c=${first.id}">Connect</a>`,
      )}
      <div class="srow col"><div><b>Connector address</b></div><code class="copy inp code sm">${STORE_RESOURCE}</code></div>
      ${row(config.store.name, "A record shop that welcomes couriers.", html`<a class="link fine" href="${config.store.url}" target="_blank" rel="noopener">Visit ↗</a>`)}
    </div></section>
    <section><h2 class="sec-t">Account</h2><div class="panel slist">
      ${row(firstName(d.human) ?? "You", "Your name is never shared with shops.", html`<a class="btn ghost sm" href="/logout">Sign out</a>`)}
      ${row("Delete account", "Erase everything and start again from scratch.", html`<a class="btn ghost sm" href="/app/account/delete">Delete my account</a>`)}
    </div></section>
  </div>`;
  return shell("Settings", d, "settings", main);
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
      <p class="fine">Receipts you already have keep working. ${config.store.name} keeps its own order records, which don't include your name, and PayPal keeps its own payment history.</p>
      <form class="acts-row" method="post" action="/app/account/delete">
        <button class="btn danger" type="submit">Delete my account</button>
        <a class="btn ghost" href="/app/settings">Keep my account</a>
      </form>
    </section>
  </div>`;
  return shell("Delete account", d, null, main);
}
