/** The public landing page. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  avatar,
  type CardBack,
  type CourierLook,
  config,
  courierLayout,
  html,
  idCard,
  idCardBack,
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

/** The badges the page's story moves around, each by its data-b in landing.js. Juno gets a second copy for its other back. */
const JUNO: CourierLook = { name: "Juno", color: "cobalt", model: "Claude", idNo: "CR-7Q3F-JR" };
const BADGES: { key: string; look: CourierLook; sentBy: string; back?: CardBack }[] = [
  {
    key: "juno",
    look: JUNO,
    sentBy: "Maya Chen",
    back: {
      title: "Call back",
      line: "One tap stops Juno and its helpers.",
      intro: "Juno may buy a record for your dad, and nothing else.",
      rows: [
        ["$60", "max budget"],
        ["$40", "for any one thing"],
        ["24 h", "then it comes back"],
        ["Asks", "before anything off the errand"],
      ],
    },
  },
  {
    key: "juno-gift",
    look: JUNO,
    sentBy: "Maya Chen",
    back: {
      title: "Coordination",
      line: "Couriers work it out, so you don’t have to.",
      intro: "Juno and Otto are buying one gift together.",
      rows: [
        ["Split", "the cost between you"],
        ["Agree", "on one item and one order"],
        ["Flag", "anyone who falls short"],
      ],
    },
  },
  {
    key: "otto",
    look: { name: "Otto", color: "hivis", model: "ChatGPT", idNo: "CR-2M8K-OT" },
    sentBy: "Leo Chen",
    back: {
      title: "Safety",
      line: "Nothing changes without a yes from you.",
      intro: "Otto can only speak for Leo, and only spend what Leo allows.",
      rows: [
        ["Own", "share only, paid with PayPal"],
        ["Asks", "before covering anyone else"],
        ["All", "or nothing, so no half a gift"],
      ],
    },
  },
  // White isn't a colour a person can pick, so landing.css repaints this one.
  { key: "mika", look: { name: "Mika", color: "ink", model: "Llama", idNo: "CR-9X4D-MK" }, sentBy: "Ana Chen" },
];

function badges(): RawHtml {
  const all = BADGES.map(
    (b) =>
      html`<div class="hg" data-b="${b.key}"><i class="cord"></i><div class="turn"><div class="face">${idCard(b.look, b.sentBy)}</div>${b.back ? html`<div class="face rear">${idCardBack(b.look, b.back)}</div>` : ""}</div></div>`,
  );
  return html`${all}`;
}

export function landingPage(human: Human | null): string {
  landingTemplate ||= fs.readFileSync(path.join(here, "landing.html"), "utf8");
  const account = human
    ? html`<a class="who" href="/app">${avatar()}${firstName(human) ?? "My Courier"}</a>`
    : html`<a class="who signin" href="/app">Sign in</a>`;
  const body = landingTemplate
    .replaceAll("{{navAccount}}", () => String(account))
    .replaceAll("{{storeUrl}}", config.store.url)
    .replaceAll("{{badges}}", () => String(badges()));
  return courierLayout({
    title: "Courier · Give your agent an ID",
    head: raw('<meta name="description" content="PayPal verifies you. Your agent gets its own ID.">'),
    body: raw(body),
    styles: [assetUrl("landing.css")],
    scripts: [assetUrl("landing.js")],
  });
}
