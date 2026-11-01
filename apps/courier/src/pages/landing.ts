/** The public landing page. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { avatar, config, courierLayout, html, raw } from "@courier/shared";
import type { Human } from "../db.ts";
import { firstName } from "./shared.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

/* ---------------- landing ---------------- */

let landingTemplate = "";

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
    styles: ["/assets/landing.css"],
    scripts: ["/assets/landing.js"],
  });
}
