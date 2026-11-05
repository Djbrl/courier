import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, "../../..");

const envFile = path.join(ROOT_DIR, ".env");
if (fs.existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

function env(name: string, fallback = ""): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

const courierPort = Number(env("COURIER_PORT", "4000"));
const storePort = Number(env("STORE_PORT", "4100"));

const paypalClientId = env("PAYPAL_CLIENT_ID");
const paypalClientSecret = env("PAYPAL_CLIENT_SECRET");
/**
 * Live PayPal moves real money, so it is never inferred from keys or endpoints: it takes this exact switch, and
 * the guards at the bottom of this file keep it on localhost, in its own data, under a small cap.
 */
const live = env("PAYPAL_LIVE") === "real-money";
const paypalMode: "live" | "sandbox" | "simulated" =
  paypalClientId && paypalClientSecret && env("PAYPAL_MODE") !== "simulated"
    ? live
      ? "live"
      : "sandbox"
    : "simulated";

export const config = {
  // Empty means every interface. A host behind a reverse proxy sets 127.0.0.1.
  bindHost: env("BIND_HOST"),
  courier: {
    port: courierPort,
    url: stripSlash(env("COURIER_URL", `http://localhost:${courierPort}`)),
  },
  store: {
    port: storePort,
    url: stripSlash(env("STORE_URL", `http://localhost:${storePort}`)),
    name: env("STORE_NAME", "Juniper Records"),
  },
  /** Shared secret for server-to-server calls between the store and Courier. */
  internalSecret: env("INTERNAL_SECRET", "dev-internal-secret-change-me"),
  /** Secret used for session cookies and pairwise pseudonyms. */
  sessionSecret: env("COURIER_SECRET", "dev-session-secret-change-me"),
  dataDir: path.resolve(ROOT_DIR, env("DATA_DIR", "data")),
  paypal: {
    // Needs "Full name" ticked for the PayPal app first, or sign-in may be refused.
    askName: env("PAYPAL_ASK_NAME") === "on",
    /**
     * "sandbox" when credentials are present, otherwise the built-in simulator. PAYPAL_MODE=simulated forces the
     * simulator. "live" only with PAYPAL_LIVE=real-money, for a one-off local recording.
     */
    mode: paypalMode,
    clientId: paypalClientId,
    clientSecret: paypalClientSecret,
    webhookId: env("PAYPAL_WEBHOOK_ID"),
    apiBase: env("PAYPAL_API_BASE", live ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com"),
    webBase: env("PAYPAL_WEB_BASE", live ? "https://www.paypal.com" : "https://www.sandbox.paypal.com"),
    /** The most one live payment may be, in cents. Never more than $20, whatever the setting. */
    liveCapCents: Math.min(2000, Number(env("PAYPAL_LIVE_CAP_CENTS", "500")) || 500),
  },
  intent: {
    // Off: a courier may buy anything inside its budget at its shop. Limits are enforced either way.
    enabled: env("INTENT_CHECK") === "on",
    /** Preferred intent-check backend: jev | claude | rules */
    model: env("INTENT_MODEL", "jev") as "jev" | "claude" | "rules",
    jevApiKey: env("JEV_API_KEY"),
    jevBaseUrl: env("JEV_BASE_URL"),
    claudeModel: env("INTENT_CLAUDE_MODEL", "claude-haiku-5-5"),
    timeoutMs: Number(env("INTENT_TIMEOUT_MS", "1500")),
  },
  agent: {
    model: env("AGENT_MODEL", "claude-sonnet-5-5"),
  },
  anthropicConfigured: Boolean(env("ANTHROPIC_API_KEY") || env("ANTHROPIC_AUTH_TOKEN")),
};

/** The canonical resource URI of the demo MCP server (RFC 8707 audience). */
export const STORE_RESOURCE = `${config.store.url}/mcp`;

/** The one connector a person adds to Claude. It reaches every shop. */
export const COURIER_RESOURCE = `${config.courier.url}/mcp`;

fs.mkdirSync(config.dataDir, { recursive: true });

if (
  process.env.NODE_ENV === "production" &&
  (config.internalSecret.startsWith("dev-") || config.sessionSecret.startsWith("dev-"))
) {
  console.warn(
    "[config] WARNING: INTERNAL_SECRET / COURIER_SECRET are still the development defaults. Set real secrets.",
  );
}

/* Real money stays off the public demo. Every check here stops the process rather than warn. */
const isLocal = (url: string) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
const sandboxed = (url: string) => new URL(url).hostname.includes("sandbox");
if (config.paypal.mode === "live") {
  if (!isLocal(config.courier.url) || !isLocal(config.store.url))
    throw new Error("[config] Live PayPal only runs on localhost. Unset PAYPAL_LIVE to use the sandbox.");
  if (!/live/.test(path.basename(config.dataDir)))
    throw new Error(
      "[config] Live PayPal needs its own data: set DATA_DIR to a folder named with 'live', e.g. data/live.",
    );
  if (sandboxed(config.paypal.apiBase) || sandboxed(config.paypal.webBase))
    throw new Error("[config] PAYPAL_LIVE is set but the PayPal endpoints point at the sandbox.");
} else if (
  config.paypal.mode === "sandbox" &&
  (!sandboxed(config.paypal.apiBase) || !sandboxed(config.paypal.webBase))
) {
  throw new Error(
    "[config] PayPal endpoints point outside the sandbox. Live PayPal needs PAYPAL_LIVE=real-money, on localhost.",
  );
}
