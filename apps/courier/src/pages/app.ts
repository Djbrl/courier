import {
  ARROW,
  avatar,
  CK,
  type CourierLook,
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

type View = "home" | "errands" | "couriers" | "connections";

const ICON: Record<View, string> = {
  home: '<svg viewBox="0 0 20 20"><path d="M3 9.2 10 3l7 6.2V17h-5v-4.5H8V17H3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  errands:
    '<svg viewBox="0 0 20 20"><rect x="4" y="2.8" width="12" height="14.4" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7 7h6M7 10h6M7 13h3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  couriers:
    '<svg viewBox="0 0 20 20"><rect x="2.5" y="4" width="15" height="12" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="7.3" cy="9.3" r="1.9" fill="currentColor"/><path d="M11 9h4M11 12h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  connections:
    '<svg viewBox="0 0 20 20"><path d="M7 2.5v4M13 2.5v4M5 6.5h10v3a5 5 0 0 1-10 0zM10 14.5v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const isOut = (v: VisaView) => v.effective === "active";

export function shell(
  title: string,
  d: Desk,
  view: View | null,
  main: RawHtml,
  opts: { scripts?: string[]; selected?: string } = {},
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
          ${item("connections", "Connections", "/app/connections")}
        </nav>
        <div class="crew" aria-label="Your couriers">
          <span class="crew-h">Your couriers</span>
          ${d.couriers.map(
            (
              c,
            ) => html`<a class="crew-c cc" style="${courierVars(c.color)}" href="/app/couriers?c=${c.id}" ${opts.selected === c.id ? raw('aria-current="true"') : ""}>
              ${portrait(c)}<span><b>${c.name}</b><small>${c.clientId ? "In Claude" : "Errand room"}</small></span><i class="${c.clientId ? "on" : ""}" aria-hidden="true"></i></a>`,
          )}
          <a class="crew-add" href="/start/courier?new=1"><span aria-hidden="true">+</span>New courier</a>
        </div>
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
  const quiet = !approvals.length && !out.length;

  const lead = approvals.length
    ? `${approvals.length === 1 ? "One question" : `${approvals.length} questions`} waiting for you.`
    : out.length
      ? `${out.length === 1 ? "One errand" : `${out.length} errands`} out right now.`
      : visas.length
        ? `All quiet. ${look.name} is ready when you are.`
        : `${look.name} has its ID. Time for a first errand.`;

  const ask = `Ask ${look.name} to find me a jazz record under $40 at ${config.store.name}.`;

  const main = html`<div class="hm">
    <header class="hm-top">
      <div><h1 class="big">${opts.welcome || !visas.length ? `Welcome${name ? `, ${name}` : ""}.` : `Hi${name ? `, ${name}` : ""}.`}</h1><p class="lead">${lead}</p></div>
      <ul class="stats" aria-label="Status">
        <li class="ok">${CK}<span><b>Verified PayPal account</b><small>${paypal.mode === "simulated" ? "Simulated sandbox" : "Sandbox"}</small></span></li>
        <li class="${inClaude.length ? "ok" : "todo"}"><i aria-hidden="true"></i><span><b>${inClaude.length ? `In Claude: ${inClaude.map((c) => c.name).join(", ")}` : "Not in Claude yet"}</b>${inClaude.length ? html`<small>Connector linked</small>` : html`<a class="link" href="/start/claude?c=${sel.id}">Connect</a>`}</span></li>
        <li class="${config.anthropicConfigured ? "ok" : "todo"}"><i aria-hidden="true"></i><span><b>Errand room</b><small>${config.anthropicConfigured ? `Runs on Claude` : "Demo stand-in for Claude"}</small></span></li>
      </ul>
    </header>

    <section class="tile c hm-desk" aria-label="${look.name}">${dots()}<div class="tile-in">
      <div class="desk-top">
        <span class="lbl">Your courier</span>
        <nav class="switch" aria-label="Switch courier">
          ${couriers.map((c) => html`<a class="cc" style="${courierVars(c.color)}" href="/app?c=${c.id}" title="${c.name}" ${c.id === sel.id ? raw('aria-current="true"') : ""}>${portrait(c)}</a>`)}
          <a class="add" href="/start/courier?new=1" title="New courier" aria-label="New courier">+</a>
        </nav>
      </div>
      <div class="desk-card"><div class="idwrap">${idCard(look, name)}</div></div>
      <div class="bottom">
        ${
          selErrand
            ? html`<a class="btn" href="/errand?c=${sel.id}">Open the errand${ARROW}</a>`
            : html`<a class="btn" href="/errand/new?c=${sel.id}">Send on an errand${ARROW}</a>`
        }
        <details class="pop">
          <summary class="btn ghost">Summon from Claude</summary>
          <div class="pop-in">
            ${
              sel.clientId
                ? html`<p>In any Claude chat, say:</p><code class="copy inp code sm">${ask}</code>`
                : html`<p><b>${look.name} isn’t in Claude yet.</b></p><a class="btn sm" href="/start/claude?c=${sel.id}">Set it up${ARROW}</a>`
            }
          </div>
        </details>
      </div>
    </div></section>

    ${
      quiet
        ? html`<section class="tile g hm-now" aria-label="First errand">${dots()}<div class="tile-in">
          <h2>${visas.length ? "Send it on an errand." : "Try your first errand."}</h2>
          <div class="center"><div class="notepv">${ticket(look)}</div></div>
          <div class="two-ways">
            <a href="/errand/new?c=${sel.id}"><b>From here</b><span>Open the errand room${ARROW}</span></a>
            <a href="${sel.clientId ? "/app/connections" : `/start/claude?c=${sel.id}`}"><b>From Claude</b><span>${sel.clientId ? "Just ask in any chat" : "Set up the connector"}${ARROW}</span></a>
          </div>
          ${past.length ? html`<a class="fine past-link" href="/app/errands?tab=past">${past.length} past ${past.length === 1 ? "errand" : "errands"} →</a>` : ""}
        </div></section>`
        : html`<section class="panel hm-now" aria-label="Now">
          ${
            approvals.length
              ? html`<div class="sec"><h2 class="sec-t">Needs you</h2>${approvals.map((a) => {
                  const v = visaById.get(a.visaId);
                  const al = v ? lookForAgent(human, v.clientId, v.agentName) : look;
                  return html`<a class="ask cc" style="${courierVars(al.color)}" href="/approvals/${a.id}">${portrait(al)}
                  <span><b>${al.name} asks: ${a.items.map((i) => i.title.replace(/ \(.*\)$/, "")).join(", ")}, ${money(a.totalCents)}?</b><small>${a.reason}</small></span>
                  <span class="btn sm">Answer${ARROW}</span></a>`;
                })}</div>`
              : ""
          }
          ${
            out.length
              ? html`<div class="sec"><h2 class="sec-t">Out now <span>${out.length}</span></h2><div class="rows">${out.map((v) => errandRow(d, v))}</div></div>`
              : ""
          }
          ${
            out.length
              ? (
                  () => {
                    const live = new Set(out.map((v) => v.id));
                    const latest = d.stamps.filter((s) => live.has(s.visaId)).slice(0, 4);
                    return latest.length
                      ? html`<div class="sec"><h2 class="sec-t">Latest steps</h2><ul class="feed tight" data-autorefresh="8000">${latest.map(
                          (s) => {
                            const ic = STAMP_ICON[s.kind];
                            const v = visaById.get(s.visaId)!;
                            return html`<li><span class="k ${ic.cls}" aria-hidden="true">${ic.k}</span><div><b>${s.title}</b><span class="d">${lookForAgent(human, v.clientId, v.agentName).name}${s.detail ? ` · ${s.detail}` : ""}</span></div><time>${timeAgo(s.at)}</time></li>`;
                          },
                        )}</ul></div>`
                      : "";
                  }
                )()
              : ""
          }
          ${
            past.length
              ? html`<div class="sec"><h2 class="sec-t">Recently</h2><div class="rows">${past.slice(0, 3).map((v) => errandRow(d, v))}</div></div>`
              : ""
          }
          <div class="panel-f"><a class="link fine" href="/app/errands">All errands</a><span class="fine">${visas.length} in total</span></div>
        </section>`
    }
  </div>`;
  return shell("Home", d, "home", main, { selected: sel.id });
}

/** An errand as a ticket: a receipt-style slip, so it never reads as a second ID card. */
export function ticket(look: CourierLook, visa?: VisaView): RawHtml {
  const row = (k: string, v: string | RawHtml) => html`<div class="tr"><span>${k}</span><b>${v}</b></div>`;
  return html`<div class="tkt-lift"><div class="tkt zz cc" style="${courierVars(look.color)}" aria-hidden="true">
    <div class="th"><span>Errand ticket</span><span>${visa ? `#${visa.id.slice(-6).toUpperCase()}` : "#000001"}</span></div>
    <div class="tshop">${visa?.merchantName ?? config.store.name}</div>
    <div class="tfor">${visa ? visa.intent || "Anything within the limits" : "Jazz records for my dad"}</div>
    <div class="tlines">
      ${row("Max", visa ? short(visa.spendLimitCents) : "$60")}
      ${row("Each", visa ? short(visa.perPurchaseLimitCents) : "$40")}
      ${row("Back by", visa ? backBy(visa.expiresAt) : "Tomorrow")}
      ${visa ? row("Spent", short(visa.spentCents)) : ""}
    </div>
    <div class="tby">${portrait(look)}<span><b data-fit>${look.name}</b><small>${look.idNo}</small></span></div>
  </div></div>`;
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
      <div class="dtl-note"><div class="notepv">${ticket(look, v)}</div></div>
      <div class="dtl-facts">
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
  return shell(look.name, d, "couriers", main, { selected: sel.id });
}

/* ---------------- connections ---------------- */

const TOOLS: [string, string][] = [
  ["search_catalog", "Search the shop"],
  ["get_item", "Look at an item"],
  ["hold_item", "Hold an item"],
  ["request_purchase", "Buy within the ticket"],
  ["order_status", "Check an order"],
  ["whoami", "Show its ID and limits"],
];

export function connectionsPage(d: Desk): string {
  const inClaude = d.couriers.filter((c) => c.clientId);
  const first = d.couriers[0]!;
  const main = html`<div class="conn">
    <header class="conn-h"><h1 class="big">Connections</h1></header>
    <div class="conn-g">
      <section class="panel cbox">
        <div class="cbox-h"><span class="cic ok-ic" aria-hidden="true">${CK}</span><div><b>${PP}</b><small>Proves you’re a real adult. Pays for errands.</small></div><span class="st active"><i></i>Verified</span></div>
        <p class="fine">${paypal.mode === "sandbox" ? "Sandbox" : "Simulated"}: no real money.</p>
      </section>
      <section class="panel cbox">
        <div class="cbox-h"><span class="cic" aria-hidden="true">C</span><div><b>Claude connector</b><small>Summon a courier from any Claude chat.</small></div><span class="st ${inClaude.length ? "active" : "expired"}"><i></i>${inClaude.length ? `${inClaude.length} linked` : "Not linked"}</span></div>
        <code class="copy inp code sm">${STORE_RESOURCE}</code>
        <p class="fine">${inClaude.length ? `Linked: ${inClaude.map((c) => `${c.name} (${c.clientName ?? "Claude"})`).join(", ")}.` : "No Claude has connected yet."} <a href="/start/claude?c=${first.id}">Walkthrough</a></p>
        ${d.connections.map(
          (c) =>
            html`<form method="post" action="/app/connections/${c.id}/revoke"><button class="btn ghost sm" type="submit" title="Ends its errands and removes its access">Disconnect ${c.clientName}</button></form>`,
        )}
      </section>
      <section class="panel cbox">
        <div class="cbox-h"><span class="cic room-ic" aria-hidden="true">R</span><div><b>Errand room</b><small>The courier you chat with on this website.</small></div><span class="st ${config.anthropicConfigured ? "active" : "expired"}"><i></i>${config.anthropicConfigured ? "Claude" : "Demo"}</span></div>
        <p class="fine">${config.anthropicConfigured ? html`<span class="mono">${config.agent.model}</span>` : "Scripted stand-in. Add ANTHROPIC_API_KEY to run it on Claude."}</p>
      </section>
      <section class="panel cbox tools">
        <div class="cbox-h"><span class="cic jr-ic" aria-hidden="true">J</span><div><b>${config.store.name}</b><small>A record shop that welcomes couriers.</small></div><a class="link fine" href="${config.store.url}" target="_blank" rel="noopener">Visit ↗</a></div>
        <span class="lbl">A courier can</span>
        <ul class="tool-list">${TOOLS.map(([t, label]) => html`<li title="${t}">${label}</li>`)}</ul>
      </section>
    </div>
  </div>`;
  return shell("Connections", d, "connections", main);
}
