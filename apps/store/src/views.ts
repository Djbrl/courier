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
import { itemArt } from "./art.ts";
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
      <ul class="shelf-g" aria-label="What’s here">${shown.map(
        (i) =>
          html`<li class="shelf-i"><span class="shelf-cv">${itemArt(i, shop.slug)}</span>
            <b>${i.title}</b><small>${i.artist} · ${i.blurb}</small><span class="pr">${money(i.priceCents)}</span></li>`,
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
        return html`<li>${item ? html`<div class="cv">${itemArt(item, order.shop)}</div>` : ""}
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
  ({
    live: "Live PayPal: real money moved.",
    sandbox: "PayPal sandbox: no real money moved.",
    simulated: "Simulated PayPal: no real money moved.",
  })[paypalFor(order).mode];

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

/**
 * Demo or sandbox, by the payment path: an order for a demo person, or any order while the shop has no PayPal sandbox,
 * only ever reaches the PayPal simulator. Sandbox orders move PayPal test money. Neither is real money.
 */
const isDemoOrder = (order: Order) => paypalFor(order).mode === "simulated";

const sum = (orders: Order[]) => orders.filter((o) => o.status === "paid").reduce((s, o) => s + o.totalCents, 0);

export function merchantDashboard(orders: Order[], requests: RequestLogEntry[]): string {
  const blocked = requests.filter((r) => r.outcome === "blocked");
  const accepted = requests.filter((r) => r.outcome === "accepted");
  const demoOrders = orders.filter(isDemoOrder);
  const sandboxOrders = orders.filter((o) => !isDemoOrder(o));
  // A courier is demo when its ID said so at the door, or when it only ever bought through the simulator. Entries
  // from before the door noted it, with no order to go by, are left out rather than guessed.
  const demoCouriers = new Set<string>([
    ...accepted.filter((r) => r.demo === true).flatMap((r) => (r.sub ? [r.sub] : [])),
    ...demoOrders.map((o) => o.sub),
  ]);
  const sandboxCouriers = new Set<string>(
    [
      ...accepted.filter((r) => r.demo === false).flatMap((r) => (r.sub ? [r.sub] : [])),
      ...sandboxOrders.map((o) => o.sub),
    ].filter((sub) => !demoCouriers.has(sub)),
  );
  return storePage(
    "What shops see",
    "merchant",
    html`<main class="jr-main mdash" data-autorefresh="6000">
      <header class="md-h">
        <div><h1 class="big">Who’s shopping here?</h1>
          <p class="lead">Every courier shows a signed ID and its limits. Never the person’s name.</p></div>
        <ul class="stats md-stats" aria-label="Today">
          <li class="ok"><span><b>${sandboxCouriers.size}</b><small>sandbox couriers</small></span></li>
          <li class="md-demo-s"><span><b>${demoCouriers.size}</b><small>demo couriers</small></span></li>
          <li><span><b>${accepted.length}</b><small>requests served</small></span></li>
          <li class="bad"><span><b>${blocked.length}</b><small>blocked</small></span></li>
          <li class="money"><span><b>${money(sum(sandboxOrders))}</b><small>paid in PayPal sandbox</small></span></li>
          <li class="md-demo-s"><span><b>${money(sum(demoOrders))}</b><small>simulated, not money</small></span></li>
        </ul>
      </header>
      <p class="md-note"><span class="md-demo">Demo</span> orders were paid at the PayPal simulator, by made-up people or on a shop with no PayPal sandbox. Nothing moved, so they are counted apart. Sandbox orders move PayPal test money only.</p>
      <div class="md-g">
        <section class="panel md-orders" aria-label="Orders">
          ${
            orders.length
              ? html`${
                  sandboxOrders.length
                    ? html`<h2 class="sec-t">Sandbox orders <span>${sandboxOrders.length}</span></h2>
                      <div class="rows">${sandboxOrders.map(orderRow)}</div>`
                    : ""
                }${
                  demoOrders.length
                    ? html`<h2 class="sec-t md-demo-h">Demo orders <span>${demoOrders.length}</span></h2>
                      <div class="rows">${demoOrders.map(orderRow)}</div>`
                    : ""
                }`
              : html`<h2 class="sec-t">Orders</h2><p class="empty">No courier orders yet.</p>`
          }
        </section>
        <section class="panel md-log" aria-label="Request log">
          <h2 class="sec-t">At the door</h2>
          <ul class="feed tight">${requests.slice(0, 40).map(
            (
              r,
            ) => html`<li><span class="k ${r.outcome === "blocked" ? "no" : "id"}" aria-hidden="true">${r.outcome === "blocked" ? "×" : "✓"}</span>
              <div><b>${r.agent ?? "No ID"}${r.demo ? html` <span class="md-demo">Demo</span>` : ""}</b><span class="d">${r.reason}</span></div><time>${timeAgo(r.at)}</time></li>`,
          )}</ul>
        </section>
      </div>
    </main>`,
  );
}

/** Who stands behind the order, as far as the shop can tell from the signed ID. */
function personLine(order: Order): string {
  if (order.simulated) return "Demo person, nothing checked by PayPal";
  if (!order.evidence.humanVerified) return "Not verified";
  return isDemoOrder(order) ? "Verified at the PayPal simulator" : "Verified by PayPal sandbox";
}

function orderRow(order: Order): RawHtml {
  const visa = order.evidence.visa as {
    id: string;
    intent: string | null;
    spend_limit: { value: string };
    per_purchase_limit: { value: string };
  };
  const intent = order.evidence.intent as { model?: string; reason?: string; probability?: number } | null;
  const demo = isDemoOrder(order);
  return html`<article class="mo${demo ? " mo-demo" : ""}">
    <div class="mo-top">
      <span class="mo-who cc" style="${courierVars(colorFor(order.agent))}">${portrait({ name: order.agent, color: colorFor(order.agent) })}<span><b>${order.agent}</b><small>${demo ? html`<span class="md-demo" title="Paid at the PayPal simulator">Demo</span>` : html`${CK}${PP}`}</small></span></span>
      <div class="mo-what"><b>${order.items.map((i) => i.title).join(", ")}</b><small>${(findShop(order.shop) ?? JUNIPER).name} · ${timeAgo(order.createdAt)} · ${visa.intent ? html`for “${visa.intent}”` : "no purpose given"}</small></div>
      <span class="pr">${money(order.totalCents)}</span>
      <span class="st ${order.status === "paid" ? "active" : order.status === "awaiting_approval" ? "pending_bond" : "revoked"}"><i></i>${STATUS[order.status]}</span>
    </div>
    <details class="mo-ev"><summary>${CK}Signed proof</summary>
      <dl>
        <dt>Person</dt><dd>${personLine(order)} · <code>${order.sub.slice(0, 14)}…</code></dd>
        <dt>Limits</dt><dd>$${visa.spend_limit.value} in total · $${visa.per_purchase_limit.value} each</dd>
        ${intent ? html`<dt>Check</dt><dd>${intent.model ?? "?"}${intent.probability !== undefined ? ` (${Math.round(intent.probability * 100)}%)` : ""}: ${intent.reason ?? ""}</dd>` : ""}
        <dt>Paid at</dt><dd>${demo ? "PayPal simulator: no money moved" : paypalFor(order).mode === "live" ? "Live PayPal: real money" : "PayPal sandbox: test money only"}</dd>
        <dt>Pass</dt><dd><code>${visa.id}</code></dd>
      </dl>
      <form method="post" action="/merchant/report/${visa.id}"><button class="btn danger sm" type="submit" title="Suspends this courier's pass and claims its bond, if any">Report this courier</button></form>
    </details>
  </article>`;
}
