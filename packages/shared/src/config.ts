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
    /** "sandbox" when credentials are present, otherwise the built-in simulator. PAYPAL_MODE=simulated forces the simulator. */
    mode: (paypalClientId && paypalClientSecret && env("PAYPAL_MODE") !== "simulated" ? "sandbox" : "simulated") as
      | "sandbox"
      | "simulated",
    clientId: paypalClientId,
    clientSecret: paypalClientSecret,
    webhookId: env("PAYPAL_WEBHOOK_ID"),
    apiBase: env("PAYPAL_API_BASE", "https://api-m.sandbox.paypal.com"),
    webBase: env("PAYPAL_WEB_BASE", "https://www.sandbox.paypal.com"),
  },
  intent: {
    /** Preferred intent-check backend: jev | claude | rules */
    model: env("INTENT_MODEL", "jev") as "jev" | "claude" | "rules",
    jevApiKey: env("JEV_API_KEY"),
    jevBaseUrl: env("JEV_BASE_URL"),
    claudeModel: env("INTENT_CLAUDE_MODEL", "claude-haiku-5-5"),
    timeoutMs: Number(env("INTENT_TIMEOUT_MS", "1500")),
  },
  agent: {
    model: env("AGENT_MODEL", "claude-opus-5-5"),
  },
  anthropicConfigured: Boolean(env("ANTHROPIC_API_KEY") || env("ANTHROPIC_AUTH_TOKEN")),
};

/** The canonical resource URI of the demo MCP server (RFC 8707 audience). */
export const STORE_RESOURCE = `${config.store.url}/mcp`;

fs.mkdirSync(config.dataDir, { recursive: true });

if (
  process.env.NODE_ENV === "production" &&
  (config.internalSecret.startsWith("dev-") || config.sessionSecret.startsWith("dev-"))
) {
  console.warn(
    "[config] WARNING: INTERNAL_SECRET / COURIER_SECRET are still the development defaults. Set real secrets.",
  );
}
