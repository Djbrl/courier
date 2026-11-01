/** The public landing page. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { avatar, config, courierLayout, html, ROOT_DIR, raw } from "@courier/shared";
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

export function landingPage(human: Human | null): string {
  landingTemplate ||= fs.readFileSync(path.join(here, "landing.html"), "utf8");
  const account = human
    ? html`<a class="who" href="/app">${avatar()}${firstName(human) ?? "My Courier"}</a>`
    : html`<a class="who signin" href="/app">Sign in</a>`;
  const body = landingTemplate
    .replaceAll("{{navAccount}}", () => String(account))
    .replaceAll("{{storeUrl}}", config.store.url);
  return courierLayout({
    title: "Courier · Give your agent an ID",
    head: raw('<meta name="description" content="PayPal verifies you. Your agent gets its own ID.">'),
    body: raw(body),
    styles: [assetUrl("landing.css")],
    scripts: [assetUrl("landing.js")],
  });
}
