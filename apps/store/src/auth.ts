import {
  ALL_SCOPES,
  type ConnectionTokenClaims,
  config,
  internalFetch,
  JUNIPER,
  newId,
  type Shop,
  type VisaTokenClaims,
} from "@courier/shared";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { db } from "./db.ts";

/**
 * The merchant side of Courier: an OAuth 2.1 resource server.
 * - Advertises Courier as its authorization server (RFC 9728).
 * - Verifies JWT access tokens (signature via JWKS, issuer, audience = this MCP server, expiry).
 * - Checks the visa or connection is still active (revocation takes effect within seconds).
 * - For a connected Claude, gets the current errand's visa from Courier as a short-lived signed token.
 * - Logs every accepted and blocked request for the merchant dashboard.
 */

export const PRM_PATH = "/.well-known/oauth-protected-resource/mcp";
export const PRM_URL = `${config.store.url}${PRM_PATH}`;

export const protectedResourceMetadata = {
  resource: JUNIPER.resource,
  authorization_servers: [config.courier.url],
  scopes_supported: [...ALL_SCOPES],
  bearer_methods_supported: ["header"],
  resource_name: `${JUNIPER.name} (Courier demo merchant)`,
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

/* ---------------- connections ---------------- */

/** Who a request acts for. A connected Claude has no visa between errands: it can browse, but not hold or buy. */
export type AgentClaims = Omit<VisaTokenClaims, "visa"> & {
  visa: VisaTokenClaims["visa"] | null;
  connection: ConnectionTokenClaims["connection"] | null;
};
export type TicketClaims = AgentClaims & VisaTokenClaims;
export const hasTicket = (claims: AgentClaims): claims is TicketClaims => claims.visa !== null;
export const agentName = (claims: AgentClaims) => claims.visa?.agent ?? claims.connection?.agent ?? "Courier";
/** What an MCP session is tied to, and what rate limits count against. */
export const ownerId = (claims: AgentClaims) => claims.connection?.id ?? claims.visa?.id ?? "";

interface ConnectionStatus {
  status: string;
  agent: string;
  ticketToken: string | null;
}

const connectionCache = new Map<string, { value: ConnectionStatus; at: number }>();

async function connectionStatus(id: string): Promise<ConnectionStatus | null> {
  const cached = connectionCache.get(id);
  if (cached && Date.now() - cached.at < 3000) return cached.value;
  try {
    const value = await internalFetch<ConnectionStatus>(
      `${config.courier.url}/internal/connections/${encodeURIComponent(id)}`,
    );
    connectionCache.set(id, { value, at: Date.now() });
    return value;
  } catch {
    return null;
  }
}

const verifyToken = (token: string, shop: Shop) =>
  jwtVerify(token, jwks, { issuer: config.courier.url, audience: shop.resource, typ: "at+jwt" });

/** The current ticket, verified like any Courier token and checked to belong to this Claude. */
async function ticketFor(
  base: ConnectionTokenClaims,
  ticketToken: string | null,
  shop: Shop,
): Promise<VisaTokenClaims | null> {
  if (!ticketToken) return null;
  try {
    const ticket = (await verifyToken(ticketToken, shop)).payload as unknown as VisaTokenClaims;
    return ticket.sub === base.sub && ticket.client_id === base.client_id ? ticket : null;
  } catch (error) {
    console.warn("[store] ticket didn't verify", (error as Error).message);
    return null;
  }
}

/** Looks again for a ticket on this connection, for when the person has just written one mid-call. */
export async function withFreshTicket(claims: AgentClaims, shop: Shop): Promise<AgentClaims> {
  const id = claims.connection!.id;
  connectionCache.delete(id);
  const standing = await connectionStatus(id);
  const ticket =
    standing?.status === "active" ? await ticketFor(claims as ConnectionTokenClaims, standing.ticketToken, shop) : null;
  return ticket ? { ...claims, ...ticket, visa: ticket.visa, connection: claims.connection } : claims;
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

/** The bearer check for one shop's MCP server. A token for another shop's address doesn't verify here. */
export const requireVisa =
  (shop: Shop) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.header("authorization") ?? "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    const source = describeSource(req);
    if (!match) {
      logRequest({ outcome: "blocked", reason: "No ID presented", status: 401, source });
      challenge(res, 401);
      return;
    }

    let token: VisaTokenClaims | ConnectionTokenClaims;
    try {
      token = (await verifyToken(match[1], shop)).payload as unknown as VisaTokenClaims | ConnectionTokenClaims;
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

    let claims: AgentClaims;
    if ("connection" in token) {
      const standing = await connectionStatus(token.connection.id);
      if (standing?.status !== "active") {
        const reason = `Connection ${standing?.status ?? "unknown"}`;
        logRequest({ outcome: "blocked", reason, status: 401, sub: token.sub, agent: token.connection.agent, source });
        challenge(res, 401, "invalid_token", reason);
        return;
      }
      const ticket = await ticketFor(token, standing.ticketToken, shop);
      claims = {
        ...token,
        ...ticket,
        visa: ticket?.visa ?? null,
        connection: { id: token.connection.id, agent: standing.agent },
      };
    } else {
      const status = await visaStatus(token.visa.id);
      if (status?.status !== "active") {
        const reason = `Visa ${status?.status ?? "unknown"}`;
        logRequest({
          outcome: "blocked",
          reason,
          status: 401,
          sub: token.sub,
          visaId: token.visa.id,
          agent: token.visa.agent,
          source,
        });
        challenge(res, 401, "invalid_token", reason);
        return;
      }
      claims = { ...token, connection: null };
    }

    const auth: AuthInfo = {
      token: match[1],
      clientId: claims.client_id,
      scopes: claims.scope.split(" ").filter(Boolean),
      expiresAt: claims.exp,
      resource: new URL(shop.resource),
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
      visaId: claims.visa?.id ?? null,
      agent: agentName(claims),
      method,
      source,
    });
    next();
  };

export function claimsOf(authInfo: AuthInfo | undefined): AgentClaims {
  const claims = (authInfo?.extra as { claims?: AgentClaims } | undefined)?.claims;
  if (!claims) throw new Error("missing claims");
  return claims;
}
