/** The public landing page. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  avatarFor,
  CK,
  type CourierLook,
  config,
  courierLayout,
  courierVars,
  html,
  idCard,
  LOGO,
  type RawHtml,
  ROOT_DIR,
  raw,
  SHOPS,
  VERIFIED,
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
const JUNO: CourierLook = { name: "Juno", color: "cobalt", avatar: "shades", model: "Claude", idNo: "CR-7Q3F-JR" };
const CREW: { look: CourierLook; sentBy: string; white?: boolean }[] = [
  { look: JUNO, sentBy: "Maya Chen" },
  { look: { name: "Otto", color: "tang", avatar: "afro", model: "ChatGPT", idNo: "CR-8KD2-OT" }, sentBy: "Sam Reed" },
  // White isn't a colour a person can pick, so landing.css repaints this one.
  { look: { name: "Mika", color: "ink", model: "Llama", idNo: "CR-4HT9-MK" }, sentBy: "Ana Chen", white: true },
];

/** Every courier name the page shows, including the globe's (landing.js), so each gets the same face as on its pass. */
const FACE_NAMES = ["Juno", "Otto", "Mika", "Rémy", "Pip", "Lou", "Ivy", "Bo", "Kit", "Nell", "Ari", "Zed"];

const MARK = raw(
  '<svg class="mark" viewBox="-2 0 42 20" aria-hidden="true"><path d="M15 0h25l-7 20H8z"/><path d="M5 0h6L4 20h-6z"/></svg>',
);

/** The back of the pass, in as few words as it takes: what a shop gets, what it never does, and who vouches. */
function passBack(c: CourierLook): RawHtml {
  return html`<div class="idc s-rev cc" style="${courierVars(c.color)}" role="img" aria-label="Shared with a shop: agent ${c.name}, a shopper ID, a real person. Withheld: your personal data. Verified by PayPal.">
    <div class="idf">
      <div class="tab"><div class="tr">${LOGO}<span class="idn">${c.idNo}</span></div></div>
      <i class="pf"></i><i class="slot"></i>
      <div class="s-revt"><h3>Shared</h3><ul class="s-fld"><li class="s-an">${c.name}</li><li><span>Shopper ID</span><code>pp_7f3a…c91</code></li><li>${CK}A real person</li></ul></div>
      <div class="s-revb">${MARK}<h3>Withheld</h3><p>Your personal data</p>${VERIFIED}</div>
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
    .replaceAll("{{faces}}", () => {
      const faces = Object.fromEntries(
        FACE_NAMES.map((n) => [n, CREW.find((m) => m.look.name === n)?.look.avatar ?? avatarFor(n)]),
      );
      return `<script type="application/json" id="faces-data">${JSON.stringify(faces).replace(/</g, "\\u003c")}</script>`;
    })
    .replaceAll("{{pass}}", () => String(html`<div>${idCard(JUNO, "Maya Chen")}</div><div>${passBack(JUNO)}</div>`))
    .replaceAll("{{sides}}", () =>
      String(
        html`${CREW.filter((m) => m.look !== JUNO).map(
          (m) => html`<div class="s-flank${m.white ? " s-white" : ""}">${idCard(m.look, m.sentBy)}</div>`,
        )}`,
      ),
    );
  return courierLayout({
    title: "Courier · Agents that shops can trust",
    head: raw(
      '<meta name="description" content="Your agent gets a face shops recognise. PayPal vouches for the person behind it.">',
    ),
    body: raw(body),
    styles: [assetUrl("landing.css")],
    scripts: [assetUrl("landing.js")],
  });
}
