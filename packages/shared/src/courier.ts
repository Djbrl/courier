/**
 * Courier design system, server side: the page layout, logo, PayPal text lockup and the agent ID card.
 * Styles live in assets/courier.css. "PayPal" is only ever set as a text lockup, never the logo mark.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "./config.ts";
import { escapeHtml, html, type RawHtml, raw } from "./html.ts";

/** An address that changes with the file, so a deploy never meets a browser's cached copy. */
function versioned(file: string): string {
  const content = fs.readFileSync(path.join(ROOT_DIR, "packages/shared/assets", file));
  return `/assets/${file}?v=${createHash("sha256").update(content).digest("hex").slice(0, 8)}`;
}
const CSS_URL = versioned("courier.css");
const APP_JS_URL = versioned("app.js");

/* ---------------- colours ---------------- */

/** Each courier's own colour: band, text on band, slash, deep (lines, dots), light tint. */
export const COURIER_COLORS = {
  cobalt: { ac: "#3D3AF5", at: "#FFFFFF", as: "#D6FF2E", ad: "#3D3AF5", al: "#DEDDFF" },
  tang: { ac: "#FF6B2C", at: "#141414", as: "#FFFFFF", ad: "#E85A1C", al: "#FFE2D2" },
  ink: { ac: "#141414", at: "#FFFFFF", as: "#D6FF2E", ad: "#141414", al: "#E8E6E1" },
  hivis: { ac: "#D6FF2E", at: "#141414", as: "#141414", ad: "#7FA300", al: "#EFFFC0" },
} as const;
export type CourierColor = keyof typeof COURIER_COLORS;

export function isCourierColor(value: unknown): value is CourierColor {
  return typeof value === "string" && value in COURIER_COLORS;
}

/** The portrait tile that goes with each colour (shapes from the landing page's Juno, Otto, Mika and Rémy). */
const PORTRAITS: Record<CourierColor, { pc: string; lc: string; sh: string }> = {
  cobalt: { pc: "#141414", lc: "#FFFFFF", sh: '<circle cx="68" cy="34" r="24" fill="#D6FF2E"/>' },
  tang: {
    pc: "#FFC629",
    lc: "#141414",
    sh: '<rect x="48" y="12" width="40" height="20" rx="10" fill="#141414"/><rect x="48" y="38" width="40" height="20" rx="10" fill="#141414"/>',
  },
  ink: { pc: "#3D3AF5", lc: "#F2EFE9", sh: '<path d="M90 10 90 56 48 10z" fill="#D6FF2E"/>' },
  hivis: {
    pc: "#E8352A",
    lc: "#141414",
    sh: '<path d="M46 12a22 22 0 0 0 44 0z" fill="#FFFFFF"/><circle cx="82" cy="58" r="7" fill="#FFC629"/>',
  },
};

export function courierVars(color: CourierColor): string {
  const c = COURIER_COLORS[color];
  return `--ac:${c.ac};--at:${c.at};--as:${c.as};--ad:${c.ad};--al:${c.al}`;
}

/* ---------------- small parts ---------------- */

export interface CourierLook {
  name: string;
  color: CourierColor;
  /** The model it runs on, a small detail (e.g. "Claude"). */
  model: string;
  idNo: string;
}

export const SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <symbol id="mk" viewBox="0 0 40 20"><path fill="currentColor" d="M15 0h25l-7 20H8z"/><path fill="currentColor" d="M5 0h6L4 20h-6z"/></symbol>
  <symbol id="arr" viewBox="0 0 16 16"><path d="M2 8h11M9 3.5 13.5 8 9 12.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
</defs></svg>`;

export const LOGO = raw('<span class="logo"><svg><use href="#mk"/></svg>Courier</span>');
export const PP = raw('<span class="pp"><span class="a">Pay</span><span class="b">Pal</span></span>');
export const CK = raw(
  '<span class="ck"><svg viewBox="0 0 12 12"><path d="M2.5 6.2 5 8.6l4.6-5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>',
);
/** Courier names work like usernames: 2–12 letters, digits or hyphens, starting with a letter. */
export const COURIER_NAME_MAX = 12;
export const COURIER_NAME_PATTERN = "[\\p{L}][\\p{L}\\p{N}\\-]{1,11}";
export const COURIER_NAME_HINT = "2–12 letters, numbers or hyphens. Starts with a letter.";
export function isCourierName(name: string): boolean {
  return /^\p{L}[\p{L}\p{N}-]{1,11}$/u.test(name);
}

export const ARROW = raw('<span class="go"><svg><use href="#arr"/></svg></span>');
export const VERIFIED = html`<span class="vt">${CK}Verified by ${PP}</span>`;
/** A person's avatar: a simple silhouette on a coloured disc. */
export function avatar(bg = "#FFC629"): RawHtml {
  return raw(
    `<span class="av" aria-hidden="true"><svg viewBox="0 0 20 20"><rect width="20" height="20" fill="${escapeHtml(bg)}"/><circle cx="10" cy="8" r="3.6" fill="#141414"/><path d="M3.2 20c.6-4.4 3.3-6.6 6.8-6.6s6.2 2.2 6.8 6.6z" fill="#141414"/></svg></span>`,
  );
}

export function portrait(c: Pick<CourierLook, "name" | "color">): RawHtml {
  const p = PORTRAITS[c.color];
  const letter = [...c.name.trim()][0]?.toUpperCase() ?? "C";
  return raw(
    `<span class="pt" style="--pc:${p.pc};--lc:${p.lc}" aria-hidden="true"><svg viewBox="0 0 100 100">${p.sh}</svg><b>${escapeHtml(letter)}</b></span>`,
  );
}

/** "Continue with PayPal" style button (PayPal-yellow, text lockup only). */
export function paypalButton(href: string, label = "Continue with"): RawHtml {
  return html`<a class="btn-pp" href="${href}">${label} ${PP}</a>`;
}

/* ---------------- the ID card ---------------- */

export function idCard(c: CourierLook, sentBy: string | null, opts: { id?: string } = {}): RawHtml {
  return html`<div class="idc cc" style="${courierVars(c.color)}" ${opts.id ? raw(`id="${escapeHtml(opts.id)}"`) : ""}
      role="img" aria-label="Courier ID: ${c.name}, runs on ${c.model}, ${c.idNo}${sentBy ? `, sent by ${sentBy}` : ""}, verified by PayPal">
    <div class="band">${LOGO}</div>
    <div class="bd">${portrait(c)}<div class="dt"><div class="nm" data-f="name" data-fit>${c.name}</div><div class="on">runs on <b>${c.model}</b></div><div class="idn">${c.idNo}</div></div></div>
    <div class="ft"><span class="chip">${avatar()}Sent by <b data-f="human">${sentBy ?? "you"}</b></span>${VERIFIED}</div>
  </div>`;
}

/* ---------------- layout ---------------- */

export interface CourierLayoutOptions {
  title: string;
  body: RawHtml;
  nav?: RawHtml;
  head?: RawHtml;
  bodyClass?: string;
  /** Extra stylesheets after courier.css. */
  styles?: string[];
  /** Deferred scripts after app.js. */
  scripts?: string[];
}

export function courierLayout(opts: CourierLayoutOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:ital,wdth,wght@0,62..125,100..900;1,62..125,100..900&family=Instrument+Sans:ital,wdth,wght@0,75..100,400..700;1,75..100,400..700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${CSS_URL}">
${(opts.styles ?? []).map((s) => `<link rel="stylesheet" href="${escapeHtml(s)}">`).join("\n")}
<link rel="icon" href="/assets/courier-icon.svg" type="image/svg+xml">
${opts.head ? opts.head.value : ""}
</head>
<body class="${escapeHtml(opts.bodyClass ?? "")}">
${SPRITE}
${opts.nav ? opts.nav.value : ""}
${opts.body.value}
<script src="${APP_JS_URL}" defer></script>
${(opts.scripts ?? []).map((s) => `<script src="${escapeHtml(s)}" defer></script>`).join("\n")}
</body>
</html>`;
}
