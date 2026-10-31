import { ALL_SCOPES, config, internalFetch, newId, STORE_RESOURCE, type VisaTokenClaims } from "@courier/shared";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { db } from "./db.ts";

/**
 * The merchant side of Courier: an OAuth 2.1 resource server.
 * - Advertises Courier as its authorization server (RFC 9728).
 * - Verifies JWT access tokens (signature via JWKS, issuer, audience = this MCP server, expiry).
 * - Checks the visa is still active (revocation takes effect within seconds).
 * - Logs every accepted and blocked request for the merchant dashboard.
 */

export const PRM_PATH = "/.well-known/oauth-protected-resource/mcp";
export const PRM_URL = `${config.store.url}${PRM_PATH}`;

export const protectedResourceMetadata = {
  resource: STORE_RESOURCE,
  authorization_servers: [config.courier.url],
  scopes_supported: [...ALL_SCOPES],
  bearer_methods_supported: ["header"],
  resource_name: `${config.store.name} (Courier demo merchant)`,
  resource_documentation: `${config.courier.url}/developers`,
};

const jwks = createRemoteJWKSet(new URL(`${config.courier.url}/jwks.json`), { cooldownDuration: 30_000 });

export interface RequestLogEntry {
  id: string;
  at: string;
  outcome: "accepted" | "blocked";
  reason: string;
  status: number;
  sub?: string | null;
  visaId?: string | null;
  agent?: string | null;
  method?: string | null;
  source?: string | null;
}

export function logRequest(entry: Omit<RequestLogEntry, "id" | "at">): void {
  const full: RequestLogEntry = { id: newId("req"), at: new Date().toISOString(), ...entry };
  db.put("requests", full.id, full);
}

/* ---------------- visa status cache ---------------- */

interface VisaStatus {
  status: string;
  remainingCents: number;
  spendLimitCents: number;
  perPurchaseLimitCents: number;
  spentCents: number;
  bond: { status: string; amountCents: number } | null;
}

const statusCache = new Map<string, { value: VisaStatus; at: number }>();

export async function visaStatus(visaId: string, fresh = false): Promise<VisaStatus | null> {
  const cached = statusCache.get(visaId);
  if (!fresh && cached && Date.now() - cached.at < 3000) return cached.value;
  try {
    const value = await internalFetch<VisaStatus>(`${config.courier.url}/internal/visas/${encodeURIComponent(visaId)}`);
    statusCache.set(visaId, { value, at: Date.now() });
    return value;
  } catch {
    return null;
  }
}

export function forgetVisa(visaId: string): void {
  statusCache.delete(visaId);
}

/* ---------------- bearer middleware ---------------- */

function challenge(res: Response, status: number, error?: string, description?: string): void {
  const parts = [`resource_metadata="${PRM_URL}"`, `scope="${ALL_SCOPES.join(" ")}"`];
  if (error) parts.unshift(`error="${error}"`);
  if (description) parts.push(`error_description="${description.replace(/"/g, "'")}"`);
  res.set("WWW-Authenticate", `Bearer ${parts.join(", ")}`);
  res
    .status(status)
    .json({ error: error ?? "unauthorized", error_description: description ?? "A Courier visa is required." });
}

function describeSource(req: Request): string {
  return String(req.header("x-demo-source") ?? req.header("user-agent") ?? "unknown").slice(0, 80);
}

export async function requireVisa(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.header("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const source = describeSource(req);
  if (!match) {
    logRequest({ outcome: "blocked", reason: "No ID presented", status: 401, source });
    challenge(res, 401);
    return;
  }

  let claims: VisaTokenClaims;
  try {
    const { payload } = await jwtVerify(match[1], jwks, {
      issuer: config.courier.url,
      audience: STORE_RESOURCE,
      typ: "at+jwt",
    });
    claims = payload as unknown as VisaTokenClaims;
  } catch (error) {
    const message = (error as Error).message;
    const reason = /audience|aud/i.test(message)
      ? "Visa issued for a different merchant"
      : /exp/i.test(message)
        ? "Expired visa token"
        : /signature|JWKS|no applicable key|kid/i.test(message)
          ? "Forged ID (bad signature)"
          : `Invalid token: ${message}`;
    logRequest({ outcome: "blocked", reason, status: 401, source });
    challenge(res, 401, "invalid_token", reason);
    return;
  }

  const status = await visaStatus(claims.visa.id);
  if (status?.status !== "active") {
    const reason = `Visa ${status?.status ?? "unknown"}`;
    logRequest({
      outcome: "blocked",
      reason,
      status: 401,
      sub: claims.sub,
      visaId: claims.visa.id,
      agent: claims.visa.agent,
      source,
    });
    challenge(res, 401, "invalid_token", reason);
    return;
  }

  const auth: AuthInfo = {
    token: match[1],
    clientId: claims.client_id,
    scopes: claims.scope.split(" ").filter(Boolean),
    expiresAt: claims.exp,
    resource: new URL(STORE_RESOURCE),
    extra: { claims },
  };
  (req as Request & { auth?: AuthInfo }).auth = auth;
  const method = typeof req.body?.method === "string" ? req.body.method : null;
  const tool = method === "tools/call" ? req.body?.params?.name : null;
  logRequest({
    outcome: "accepted",
    reason: tool ? `tools/call ${tool}` : (method ?? "request"),
    status: 200,
    sub: claims.sub,
    visaId: claims.visa.id,
    agent: claims.visa.agent,
    method,
    source,
  });
  next();
}

export function claimsOf(authInfo: AuthInfo | undefined): VisaTokenClaims {
  const claims = (authInfo?.extra as { claims?: VisaTokenClaims } | undefined)?.claims;
  if (!claims) throw new Error("missing visa claims");
  return claims;
}
