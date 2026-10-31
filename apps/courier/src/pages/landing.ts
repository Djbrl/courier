/** The public landing page. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, courierLayout, raw } from "@courier/shared";
import type { Human } from "../db.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

/* ---------------- landing ---------------- */

let landingTemplate = "";

export function landingPage(human: Human | null): string {
  landingTemplate ||= fs.readFileSync(path.join(here, "landing.html"), "utf8");
  const body = landingTemplate
    .replaceAll("{{navHref}}", human ? "/app" : "/start")
    .replaceAll("{{navLabel}}", human ? "Open Courier" : "Add to Claude")
    .replaceAll("{{storeUrl}}", config.store.url);
  return courierLayout({
    title: "Courier · Give your agent an ID",
    head: raw('<meta name="description" content="PayPal verifies you. Your agent gets its own ID.">'),
    body: raw(body),
    styles: ["/assets/landing.css"],
    scripts: ["/assets/landing.js"],
  });
}
