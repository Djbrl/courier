/**
 * Before a live sandbox test: checks settings, the local apps, the public tunnels and the MCP connector, then prints
 * the URLs to paste into PayPal and Claude. Never prints secret values.
 *
 *   npm run preflight             (no PayPal calls)
 *   npm run preflight -- --paypal (also checks the sandbox app's credentials with a client-credentials token request;
 *                                  read-only, nothing is created in the PayPal account)
 */
import { config } from "@courier/shared";

let failures = 0;
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const bad = (msg: string, fix?: string) => {
  failures++;
  console.log(`  ✗ ${msg}${fix ? `\n      → ${fix}` : ""}`);
};
const note = (msg: string) => console.log(`  · ${msg}`);
const set = (name: string) => Boolean(process.env[name]);

async function get(url: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
  } catch {
    return null;
  }
}

console.log("\nCourier preflight\n");

console.log("Settings (.env)");
for (const name of ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"])
  set(name) ? ok(`${name} is set`) : bad(`${name} is missing`, "Copy it from the sandbox app in developer.paypal.com");
config.paypal.mode === "sandbox"
  ? ok("PayPal mode: sandbox")
  : bad("PayPal mode is simulated", "Remove PAYPAL_MODE=simulated from .env, keep both PayPal keys");
for (const name of ["COURIER_SECRET", "INTERNAL_SECRET"])
  set(name) ? ok(`${name} is set`) : bad(`${name} uses the dev default`, "Set a random value in .env");
config.anthropicConfigured
  ? ok("Anthropic key set: the errand room and the intent check run on Claude")
  : note("No Anthropic key: scripted errand room, rules-based intent check");
const intentOrder = { jev: "jev → claude → rules", claude: "claude → rules", rules: "rules" }[config.intent.model];
note(`Intent check order: ${intentOrder} (first one configured wins)`);

console.log("\nLocal apps");
const localP = await get(`http://localhost:${process.env.COURIER_PORT ?? 4000}/healthz`);
localP?.ok ? ok("Courier is running on :4000") : bad("Courier is not answering on :4000", "npm run dev");
const localS = await get(`http://localhost:${process.env.STORE_PORT ?? 4100}/`);
localS?.ok
  ? ok("Juniper Records is running on :4100")
  : bad("Juniper Records is not answering on :4100", "npm run dev");

console.log("\nPublic URLs (tunnels)");
const pub = (u: string) => /^https:\/\//.test(u) && !/localhost|127\.0\.0\.1/.test(u);
if (!pub(config.courier.url) || !pub(config.store.url)) {
  bad("COURIER_URL / STORE_URL are not public https URLs", "./scripts/tunnel.sh (it writes the new URLs into .env)");
} else {
  const health = await get(`${config.courier.url}/healthz`);
  const body = health?.ok ? ((await health.json()) as { paypal?: string }) : null;
  if (!body)
    bad(
      `${config.courier.url} is not reachable`,
      "The tunnel died: ./scripts/tunnel.sh, then update the PayPal return URL",
    );
  else
    body.paypal === "sandbox"
      ? ok("Courier is reachable through its tunnel, in sandbox mode")
      : bad(`Courier answers but in ${body.paypal} mode`, "Restart with npm run dev");

  const prm = await get(`${config.store.url}/.well-known/oauth-protected-resource/mcp`);
  const meta = prm?.ok ? ((await prm.json()) as { authorization_servers?: string[] }) : null;
  if (!meta)
    bad(
      `${config.store.url} is not reachable`,
      "The tunnel died: ./scripts/tunnel.sh, then re-add the connector in Claude",
    );
  else
    meta.authorization_servers?.includes(config.courier.url)
      ? ok("The shop points connectors at this Courier")
      : bad("The shop's metadata names a different Courier URL", "Restart both apps after changing .env");

  const mcp = await get(`${config.store.url}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  mcp?.status === 401 && mcp.headers.get("www-authenticate")
    ? ok("MCP endpoint asks unauthenticated clients to sign in (401 + WWW-Authenticate)")
    : bad(`MCP endpoint returned ${mcp?.status ?? "nothing"}`);
}

if (process.argv.includes("--paypal")) {
  console.log("\nPayPal sandbox app");
  const res = await get(`${config.paypal.apiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  res?.ok
    ? ok("Sandbox credentials work (token issued)")
    : bad(
        `Sandbox token request failed (${res?.status ?? "no response"})`,
        "Check the client id and secret of the sandbox app",
      );
}

console.log(`
Paste these
  PayPal sandbox app → Log in with PayPal → Return URL:
      ${config.courier.url}/auth/paypal/callback
  Claude → Settings → Connectors → Add custom connector (name it Courier):
      ${config.store.url}/mcp
  Claude Code:
      claude mcp add --transport http courier ${config.store.url}/mcp
  What the shop sees:
      ${config.store.url}/merchant
`);
console.log(failures ? `${failures} problem${failures === 1 ? "" : "s"} to fix first.\n` : "All set.\n");
process.exit(failures ? 1 : 0);
