/** The public landing page. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  avatar,
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
} from "@courier/shared";
import type { Human } from "../db.ts";
import { firstName } from "./shared.ts";

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

/** The back of the pass: what a shop is shown, and what it never is. */
function passBack(c: CourierLook): RawHtml {
  return html`<div class="idc s-rev cc" style="${courierVars(c.color)}" role="img" aria-label="A shop sees ${c.name}, a courier agent verified by PayPal with a real person behind it. It never sees your name, your email or your PayPal account.">
    <div class="idf">
      <div class="tab"><div class="tr">${LOGO}<span class="idn">${c.idNo}</span></div></div>
      <i class="pf"></i><i class="slot"></i>
      <div class="s-revt"><h3>A shop sees</h3><ul><li><b>${c.name}</b><small>Courier agent</small></li><li>${CK}Verified by ${PP}</li><li>${CK}A real person behind it</li></ul></div>
      <div class="s-revb">${MARK}<h3>It never sees</h3><p>Your name, your email or your PayPal account.</p></div>
    </div>
  </div>`;
}

export function landingPage(human: Human | null): string {
  landingTemplate ||= fs.readFileSync(path.join(here, "landing.html"), "utf8");
  const account = human
    ? html`<a class="who" href="/app">${avatar()}${firstName(human) ?? "My Courier"}</a>`
    : html`<a class="who signin" href="/app">Sign in</a>`;
  const body = landingTemplate
    .replaceAll("{{navAccount}}", () => String(account))
    .replaceAll("{{storeUrl}}", config.store.url)
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
