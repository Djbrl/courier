/** The public landing page. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CK,
  type CourierLook,
  config,
  courierLayout,
  courierVars,
  html,
  idCard,
  LOGO,
  PP,
  type RawHtml,
  ROOT_DIR,
  raw,
  SHOPS,
} from "@courier/shared";
import type { Human } from "../db.ts";
import { navLinks } from "./shared.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

/* ---------------- landing ---------------- */

let landingTemplate = "";
const assetUrls = new Map<string, string>();

/** Assets are cached for an hour, so the URL carries a content hash: new HTML must never get an old script. */
function assetUrl(file: string): string {
  let url = assetUrls.get(file);
  if (!url) {
    const content = fs.readFileSync(path.join(ROOT_DIR, "packages/shared/assets", file));
    url = `/assets/${file}?v=${crypto.createHash("sha256").update(content).digest("hex").slice(0, 8)}`;
    assetUrls.set(file, url);
  }
  return url;
}

/** Juno hangs in the hero and turns over to show what a shop gets; the closing screen shows three couriers side by side. */
const JUNO: CourierLook = { name: "Juno", color: "cobalt", model: "Claude", idNo: "CR-7Q3F-JR" };
const CREW: { look: CourierLook; sentBy: string; white?: boolean }[] = [
  { look: JUNO, sentBy: "Maya Chen" },
  { look: { name: "Otto", color: "hivis", model: "ChatGPT", idNo: "CR-8KD2-OT" }, sentBy: "Sam Reed" },
  // White isn't a colour a person can pick, so landing.css repaints this one.
  { look: { name: "Mika", color: "ink", model: "Llama", idNo: "CR-4HT9-MK" }, sentBy: "Ana Chen", white: true },
];

const MARK = raw(
  '<svg class="mark" viewBox="-2 0 42 20" aria-hidden="true"><path d="M15 0h25l-7 20H8z"/><path d="M5 0h6L4 20h-6z"/></svg>',
);

/** The back of the pass: the fields a shop gets, and the ones it never does, as an ID would print them. */
function passBack(c: CourierLook): RawHtml {
  const shared: [string, RawHtml | string][] = [
    ["Agent", c.name],
    ["Shopper", "pp_7f3a…c91"],
    ["Person", html`${CK}Real`],
    ["Verified", html`${CK}${PP}`],
  ];
  const withheld = ["Name", "Email", "PayPal ID"];
  return html`<div class="idc s-rev cc" style="${courierVars(c.color)}" role="img" aria-label="Shared with a shop: agent ${c.name}, a shopper pseudonym, a real person, verified by PayPal. Withheld: name, email, PayPal account ID.">
    <div class="idf">
      <div class="tab"><div class="tr">${LOGO}<span class="idn">${c.idNo}</span></div></div>
      <i class="pf"></i><i class="slot"></i>
      <div class="s-revt"><h3>Shared</h3><dl class="s-fld">${shared.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl></div>
      <div class="s-revb">${MARK}<h3>Withheld</h3><dl class="s-fld">${withheld.map((k) => html`<div><dt>${k}</dt><dd><i aria-hidden="true"></i></dd></div>`)}</dl></div>
    </div>
  </div>`;
}

export function landingPage(human: Human | null): string {
  landingTemplate ||= fs.readFileSync(path.join(here, "landing.html"), "utf8");
  const body = landingTemplate
    .replaceAll("{{navLinks}}", () => String(navLinks(human)))
    .replaceAll("{{storeUrl}}", config.store.url)
    .replaceAll("{{shops}}", () => {
      const shops = SHOPS.map(({ slug, name, tile, mark }) => ({ slug, name, tile, mark }));
      return `<script type="application/json" id="shops-data">${JSON.stringify(shops).replace(/</g, "\\u003c")}</script>`;
    })
    .replaceAll("{{pass}}", () => String(html`<div>${idCard(JUNO, "Maya Chen")}</div><div>${passBack(JUNO)}</div>`))
    .replaceAll("{{passes}}", () =>
      String(
        html`${CREW.map((m) => html`<div class="${m.white ? "s-white" : ""}">${idCard(m.look, m.sentBy)}</div>`)}`,
      ),
    );
  return courierLayout({
    title: "Courier · Give your agent an ID",
    head: raw('<meta name="description" content="PayPal verifies you. Your agent gets its own ID.">'),
    body: raw(body),
    styles: [assetUrl("landing.css")],
    scripts: [assetUrl("landing.js")],
  });
}
