import {
  CK,
  COURIER_COLORS,
  type CourierColor,
  config,
  courierLayout,
  courierVars,
  findShop,
  html,
  JUNIPER,
  LOGO,
  money,
  PP,
  paypalFor,
  portrait,
  type RawHtml,
  raw,
  SHOPS,
  type Shop,
  shopLogo,
  timeAgo,
} from "@courier/shared";
import type { RequestLogEntry } from "./auth.ts";
import { findItem, type Item } from "./catalog.ts";
import type { Order } from "./db.ts";

/* The shops' pages, in the Courier design system: the logo grid, each shop's shelf, and what shops see of couriers. */

const NOT_REAL = "Demo shops with made-up names and products, not affiliated with any real brand.";

function storeNav(view: "shop" | "merchant", shop?: Shop): RawHtml {
  return html`<header class="cnav jr-nav">
    <a class="jr" href="${shop ? `/${shop.slug}` : "/"}">${shop ? shopLogo(shop, "sm") : LOGO}<div><b>${shop?.name ?? "Courier shops"}</b><small>${shop?.sells ?? "Shops that welcome couriers"}</small></div></a>
    <nav>
      <a class="hide-sm" href="/" ${view === "shop" && !shop ? raw('aria-current="page"') : ""}>All shops</a>
      <a class="hide-sm" href="/merchant" ${view === "merchant" ? raw('aria-current="page"') : ""}>What shops see</a>
      ${shop ? html`<a class="welcome" href="${config.courier.url}">${LOGO}<span>couriers welcome</span></a>` : ""}
    </nav>
  </header>`;
}

function storePage(
  title: string,
  view: "shop" | "merchant",
  body: RawHtml,
  opts: { scripts?: string[]; shop?: Shop } = {},
): string {
  return courierLayout({
    title: `${title} · ${opts.shop?.name ?? "Courier shops"}`,
    nav: storeNav(view, opts.shop),
    body,
    bodyClass: `jr-page jr-${view}`,
    scripts: opts.scripts,
  });
}

/** Same artwork as the shop front inside the errand room (errand.js `cover`). */
function cover(i: Item): RawHtml {
  const k = i.category;
  const disc =
    k === "vinyl" || k === "turntable"
      ? `<circle cx="66" cy="50" r="30" fill="#141414"/><circle cx="66" cy="50" r="22" fill="none" stroke="#2E2E2E" stroke-width="1"/><circle cx="66" cy="50" r="9" fill="hsl(${i.hue} 90% 70%)"/><circle cx="66" cy="50" r="1.6" fill="#F2EFE9"/>`
      : k === "cassette"
        ? `<rect x="22" y="30" width="56" height="38" rx="5" fill="#141414"/><circle cx="38" cy="49" r="6" fill="#F2EFE9"/><circle cx="62" cy="49" r="6" fill="#F2EFE9"/>`
        : k === "cd"
          ? `<circle cx="50" cy="50" r="28" fill="#E8E6E1"/><circle cx="50" cy="50" r="8" fill="hsl(${i.hue} 55% 46%)"/>`
          : `<rect x="28" y="28" width="44" height="44" rx="12" fill="#141414" opacity=".85"/><circle cx="50" cy="50" r="10" fill="hsl(${i.hue} 90% 70%)"/>`;
  const sleeve =
    k === "vinyl"
      ? `<rect x="10" y="20" width="60" height="60" rx="3" fill="hsl(${i.hue} 60% 38%)"/><circle cx="40" cy="50" r="14" fill="hsl(${(i.hue + 40) % 360} 90% 72%)" opacity=".9"/>`
      : "";
  return raw(`<svg viewBox="0 0 100 100" aria-hidden="true">${k === "vinyl" ? disc + sleeve : disc}</svg>`);
}

/** Every shop as a logo: the front door people recognise. */
export function shopGrid(): string {
  return storePage(
    "All shops",
    "shop",
    html`<main class="jr-main shops-main">
      <h1 class="big">Send your courier to any of these.</h1>
      <p class="lead">Ask Claude for what you want. Your courier shops with a verified ID and the budget you give it.</p>
      <nav class="shopg" aria-label="Shops">${SHOPS.map(
        (s) => html`<a class="shopg-t" href="/${s.slug}">${shopLogo(s)}<b>${s.name}</b><small>${s.sells}</small></a>`,
      )}</nav>
      <p class="fine">${NOT_REAL}</p>
    </main>`,
  );
}

const labelFor = (category: string) => category[0]!.toUpperCase() + category.slice(1);

export function storefront(shop: Shop, items: Item[], category = ""): string {
  const shown = items.filter((i) => !category || i.category === category);
  const categories = [...new Set(items.map((i) => i.category))];
  return storePage(
    shop.name,
    "shop",
    html`<main class="jr-main">
      <nav class="shopf-filters jr-filters" aria-label="Filter">
        <a href="/${shop.slug}" aria-pressed="${!category}">Everything</a>
        ${categories.map((c) => html`<a href="/${shop.slug}?c=${encodeURIComponent(c)}" aria-pressed="${c === category}">${labelFor(c)}</a>`)}
      </nav>
      <ul class="shopl" aria-label="What’s here">${shown.map(
        (i) =>
          html`<li><div><b>${i.title}</b><small>${i.artist} · ${i.blurb}</small></div><span class="pr">${money(i.priceCents)}</span></li>`,
      )}</ul>
      <p class="fine">Ask Claude to send your courier here. ${NOT_REAL}</p>
    </main>`,
    { shop },
  );
}

export function paymentResult(order: Order | undefined, ok: boolean, message: string): string {
  // Opened as a popup from the Courier errand room: tell it, then close. Otherwise it's a normal page.
  const handoff = order
    ? `<script>(function(){var popup=false;try{if(window.opener){window.opener.postMessage(${JSON.stringify({ type: "courier:payment", orderId: order.id, ok })},${JSON.stringify(config.courier.url)});popup=true;setTimeout(function(){window.close()},1400)}}catch(e){}
        if(!popup){document.getElementById("back").hidden=false;document.getElementById("closing").hidden=true}})()</script>`
    : "";
  return courierLayout({
    title: `${ok ? "Paid" : "Not paid"} · ${(findShop(order?.shop) ?? JUNIPER).name}`,
    bodyClass: "store-pay",
    body: html`<main class="solo"><div class="solo-card">
      <div class="big-ic" aria-hidden="true" style="background:${ok ? "var(--hivis)" : "var(--paper)"}">${ok ? "✓" : "↩"}</div>
      <h1 class="big">${ok ? "Paid." : "Not paid."}</h1>
      <p class="lead">${message}</p>
      ${
        order
          ? html`<div class="paycard" style="margin-top:26px;text-align:left">
            ${order.items.map((i) => html`<div class="li"><span>${i.title}</span><span>${money(i.priceCents)}</span></div>`)}
            <div class="tot" style="margin-bottom:0"><span>${(findShop(order.shop) ?? JUNIPER).name}</span><b>${money(order.totalCents)}</b></div></div>
            ${ok && order.receiptKey ? html`<p class="fine" style="margin-top:14px"><a class="link" href="${receiptUrl(order)}">See your receipt</a></p>` : ""}`
          : ""
      }
      <p class="fine" style="margin-top:22px" id="closing">You can close this window and go back to your courier.</p>
      ${order ? html`<div class="acts-row" id="back" hidden><a class="btn" href="${config.courier.url}/errand?order=${encodeURIComponent(order.id)}">Back to your courier${raw('<span class="go"><svg><use href="#arr"/></svg></span>')}</a></div>` : ""}
    </div></main>
    ${raw(handoff)}`,
  });
}

export const receiptUrl = (order: Order) => `${config.store.url}/receipts/${order.receiptKey}`;

/** What a person sees after their courier buys something: proof it happened, without opening anything else. */
export function receiptPage(order: Order | undefined): string {
  if (!order)
    return storePage(
      "Receipt",
      "shop",
      html`<main class="solo"><div class="solo-card"><h1 class="big">No receipt here.</h1><p class="lead">This link doesn’t match an order.</p></div></main>`,
    );
  const paid = order.status === "paid";
  const shop = findShop(order.shop) ?? JUNIPER;
  return storePage(
    paid ? "Receipt" : STATUS[order.status],
    "shop",
    html`<main class="solo"><article class="solo-card rcpt">
      <p class="rcpt-st ${paid ? "paid" : ""}">${paid ? "✓ Paid" : STATUS[order.status]}</p>
      <h1 class="big">${paid ? `${order.agent} got it.` : "Not paid yet."}</h1>
      <ul class="rcpt-items">${order.items.map((line) => {
        const item = findItem(line.id);
        return html`<li>${item ? html`<div class="cv" style="--h:${item.hue}">${cover(item)}</div>` : ""}
          <div><b>${line.title}</b>${item ? html`<small>${item.artist} · ${item.category}</small>` : ""}</div>
          <span class="pr">${money(line.priceCents)}</span></li>`;
      })}</ul>
      <dl class="rcpt-facts">
        <dt>Total</dt><dd><b>${money(order.totalCents)}</b></dd>
        <dt>Paid with</dt><dd>${order.paidWith === "saved_paypal" ? html`Saved ${PP}` : PP}</dd>
        <dt>Shop</dt><dd>${shop.name}</dd>
        <dt>Bought by</dt><dd>${order.agent}, ${order.simulated ? "a demo courier" : "a verified courier"}</dd>
        <dt>Order</dt><dd><code>${order.id}</code></dd>
        ${order.paidAt ? html`<dt>When</dt><dd><time datetime="${order.paidAt}">${new Date(order.paidAt).toUTCString()}</time></dd>` : ""}
      </dl>
      <div class="acts-row">
        ${!paid && order.status === "awaiting_approval" && order.approveUrl ? html`<a class="btn" href="${order.approveUrl}">Pay with PayPal</a>` : ""}
        <a class="btn ghost" href="${config.courier.url}/app/errands?e=${order.visaId}">See it in Courier</a>
      </div>
      <p class="fine" style="margin-top:18px">${paypalNote(order)}</p>
    </article></main>`,
    { shop },
  );
}

const paypalNote = (order?: Order) =>
  paypalFor(order).mode === "sandbox"
    ? "PayPal sandbox: no real money moved."
    : "Simulated PayPal: no real money moved.";

/** A stable colour for a courier the shop only knows by name. */
function colorFor(name: string): CourierColor {
  const colors = Object.keys(COURIER_COLORS) as CourierColor[];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return colors[h % colors.length]!;
}

const STATUS: Record<Order["status"], string> = {
  awaiting_approval: "Waiting to pay",
  paid: "Paid",
  cancelled: "Cancelled",
  failed: "Failed",
};

export function merchantDashboard(orders: Order[], requests: RequestLogEntry[]): string {
  const blocked = requests.filter((r) => r.outcome === "blocked");
  const accepted = requests.filter((r) => r.outcome === "accepted");
  const revenue = orders.filter((o) => o.status === "paid").reduce((s, o) => s + o.totalCents, 0);
  const couriers = new Set(accepted.map((r) => r.sub).filter(Boolean));
  return storePage(
    "What shops see",
    "merchant",
    html`<main class="jr-main mdash" data-autorefresh="6000">
      <header class="md-h">
        <div><h1 class="big">Who’s shopping here?</h1>
          <p class="lead">Every courier shows a PayPal-verified ID and its limits. Never the person’s name.</p></div>
        <ul class="stats md-stats" aria-label="Today">
          <li class="ok"><span><b>${couriers.size}</b><small>verified couriers</small></span></li>
          <li><span><b>${accepted.length}</b><small>requests served</small></span></li>
          <li class="bad"><span><b>${blocked.length}</b><small>blocked</small></span></li>
          <li class="money"><span><b>${money(revenue)}</b><small>from couriers</small></span></li>
        </ul>
      </header>
      <div class="md-g">
        <section class="panel md-orders" aria-label="Orders">
          <h2 class="sec-t">Orders</h2>
          ${orders.length ? html`<div class="rows">${orders.map(orderRow)}</div>` : html`<p class="empty">No courier orders yet.</p>`}
        </section>
        <section class="panel md-log" aria-label="Request log">
          <h2 class="sec-t">At the door</h2>
          <ul class="feed tight">${requests.slice(0, 40).map(
            (
              r,
            ) => html`<li><span class="k ${r.outcome === "blocked" ? "no" : "id"}" aria-hidden="true">${r.outcome === "blocked" ? "×" : "✓"}</span>
              <div><b>${r.agent ?? "No ID"}</b><span class="d">${r.reason}</span></div><time>${timeAgo(r.at)}</time></li>`,
          )}</ul>
        </section>
      </div>
    </main>`,
  );
}

function orderRow(order: Order): RawHtml {
  const visa = order.evidence.visa as {
    id: string;
    intent: string | null;
    spend_limit: { value: string };
    per_purchase_limit: { value: string };
  };
  const intent = order.evidence.intent as { model?: string; reason?: string; probability?: number } | null;
  return html`<article class="mo">
    <div class="mo-top">
      <span class="mo-who cc" style="${courierVars(colorFor(order.agent))}">${portrait({ name: order.agent, color: colorFor(order.agent) })}<span><b>${order.agent}</b><small>${CK}${PP}</small></span></span>
      <div class="mo-what"><b>${order.items.map((i) => i.title).join(", ")}</b><small>${(findShop(order.shop) ?? JUNIPER).name} · ${timeAgo(order.createdAt)} · ${visa.intent ? html`for “${visa.intent}”` : "no purpose given"}</small></div>
      <span class="pr">${money(order.totalCents)}</span>
      <span class="st ${order.status === "paid" ? "active" : order.status === "awaiting_approval" ? "pending_bond" : "revoked"}"><i></i>${STATUS[order.status]}</span>
    </div>
    <details class="mo-ev"><summary>${CK}Signed proof</summary>
      <dl>
        <dt>Person</dt><dd>${order.simulated ? "Demo person, simulated PayPal" : order.evidence.humanVerified ? "Verified by PayPal" : "Not verified"} · <code>${order.sub.slice(0, 14)}…</code></dd>
        <dt>Limits</dt><dd>$${visa.spend_limit.value} in total · $${visa.per_purchase_limit.value} each</dd>
        ${intent ? html`<dt>Check</dt><dd>${intent.model ?? "?"}${intent.probability !== undefined ? ` (${Math.round(intent.probability * 100)}%)` : ""}: ${intent.reason ?? ""}</dd>` : ""}
        <dt>Pass</dt><dd><code>${visa.id}</code></dd>
      </dl>
      <form method="post" action="/merchant/report/${visa.id}"><button class="btn danger sm" type="submit" title="Suspends this courier's pass and claims its bond, if any">Report this courier</button></form>
    </details>
  </article>`;
}
