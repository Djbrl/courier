/**
 * Connects to the demo MCP server with the official MCP TypeScript SDK's own OAuth client (the same discovery,
 * dynamic registration, PKCE and resource-indicator logic third-party MCP clients use), then completes the
 * human part of the flow in a scripted browser.
 *
 * Runs as part of `npm run test:e2e`.
 */
import assert from "node:assert/strict";
import { type OAuthClientProvider, UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

const STORE = process.env.STORE_URL ?? "http://localhost:4100";
const MCP = new URL(`${STORE}/mcp`);
const REDIRECT = "http://localhost:4998/sdk-callback";

class MemoryProvider implements OAuthClientProvider {
  info?: OAuthClientInformationMixed;
  saved?: OAuthTokens;
  verifier = "";
  authUrl?: URL;
  get redirectUrl() {
    return REDIRECT;
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "MCP SDK reference client",
      redirect_uris: [REDIRECT],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }
  clientInformation() {
    return this.info;
  }
  saveClientInformation(info: OAuthClientInformationMixed) {
    this.info = info;
  }
  tokens() {
    return this.saved;
  }
  saveTokens(tokens: OAuthTokens) {
    this.saved = tokens;
  }
  redirectToAuthorization(url: URL) {
    this.authUrl = url;
  }
  saveCodeVerifier(v: string) {
    this.verifier = v;
  }
  codeVerifier() {
    return this.verifier;
  }
}

/* minimal cookie-jar browser */
const jar = new Map<string, string>();
async function go(url: string, form?: Record<string, string | string[]>): Promise<Response> {
  let body: string | undefined;
  const headers: Record<string, string> = { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") };
  if (form) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) for (const one of ([] as string[]).concat(v)) p.append(k, one);
    body = p.toString();
    headers["content-type"] = "application/x-www-form-urlencoded";
  }
  const res = await fetch(url, { method: form ? "POST" : "GET", headers, body, redirect: "manual" });
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  return res;
}

const provider = new MemoryProvider();
console.log("\nMCP SDK reference client → Juniper Records → Courier\n");

// 1. Connect without a token: the SDK discovers Courier, registers, and asks us to send the user to /authorize.
let client = new Client({ name: "sdk-check", version: "1" });
try {
  await client.connect(new StreamableHTTPClientTransport(MCP, { authProvider: provider }));
  assert.fail("expected the first connection to require authorization");
} catch (error) {
  assert.ok(error instanceof UnauthorizedError, `expected UnauthorizedError, got ${(error as Error).message}`);
}
assert.ok(provider.authUrl, "SDK should produce an authorization URL");
assert.ok(provider.info?.client_id, "SDK should have registered dynamically");
assert.equal(provider.authUrl!.searchParams.get("resource"), MCP.href, "resource indicator");
console.log(`  ✓ discovery + dynamic registration (client ${provider.info!.client_id.slice(0, 8)}…)`);
console.log(`  ✓ authorization URL: ${provider.authUrl!.origin}${provider.authUrl!.pathname} with PKCE + resource`);

// 2. The human: PayPal sign-in (simulator), naming a courier, and one yes. No ticket and no payment.
const toConnect = await go(provider.authUrl!.href);
const connectPath = toConnect.headers.get("location")!;
const courier = provider.authUrl!.origin;
const reqId = connectPath.split("/connect/")[1];
const start = await go(`${courier}/auth/paypal/start?req=${reqId}`);
const sim = new URL(start.headers.get("location")!);
const login = await go(`${courier}/sim-paypal/login`, {
  persona: "malik",
  redirect_uri: sim.searchParams.get("redirect_uri")!,
  state: sim.searchParams.get("state")!,
});
await go(login.headers.get("location")!);
await go(`${courier}/start/courier`, { name: "Otto", human: "Malik", color: "tang", req: reqId });
const consent = await go(`${courier}/consent/${reqId}`, { decision: "approve" });
const back = new URL(consent.headers.get("location")!);
assert.equal(back.origin + back.pathname, REDIRECT);
assert.equal(back.searchParams.get("iss"), courier);
console.log("  ✓ human signed in with PayPal and connected; redirected back with code + iss");

// 3. The SDK finishes the exchange (PKCE verifier + resource) and reconnects with the token.
const transport = new StreamableHTTPClientTransport(MCP, { authProvider: provider });
await transport.finishAuth(back.searchParams.get("code")!);
client = new Client({ name: "sdk-check", version: "1" });
await client.connect(transport);
const who: any = await client.callTool({ name: "whoami", arguments: {} });
assert.equal(who.structuredContent.sent_by.verified_human, true);
assert.equal(who.structuredContent.visa, null);
console.log(`  ✓ token exchanged by the SDK; whoami → ${who.content[0].text.split("\n")[0]}`);

const search: any = await client.callTool({ name: "search_catalog", arguments: { query: "ambient" } });
assert.ok(search.structuredContent.results.length > 0);
console.log(`  ✓ search_catalog → ${search.structuredContent.results.length} results`);
await client.close();
console.log("\nThe official MCP SDK client works end to end against Courier.\n");
process.exit(0);
