import { createHash } from "node:crypto";
import {
  type ConnectionTokenClaims,
  centsToValue,
  config,
  isScope,
  newId,
  randomToken,
  type Scope,
  type Visa,
  type VisaTokenClaims,
} from "@courier/shared";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import {
  InvalidGrantError,
  InvalidTargetError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Response } from "express";
import { jwtVerify, SignJWT } from "jose";
import {
  type AuthCode,
  type AuthRequest,
  type Connection,
  connectionAgent,
  db,
  effectiveStatus,
  findMerchant,
  type Human,
  normalizeResource,
  pairwiseSubject,
  type RefreshTokenRecord,
} from "../db.ts";
import { signingKey } from "./keys.ts";

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const AUTH_REQUEST_TTL_MS = 20 * 60 * 1000;
const CODE_TTL_MS = 2 * 60 * 1000;
const CONNECTION_REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/* ---------------- clients (DCR + Client ID Metadata Documents) ---------------- */

const cimdCache = new Map<string, { client: OAuthClientInformationFull; fetchedAt: number }>();

async function fetchClientMetadataDocument(clientId: string): Promise<OAuthClientInformationFull | undefined> {
  const cached = cimdCache.get(clientId);
  if (cached && Date.now() - cached.fetchedAt < 10 * 60 * 1000) return cached.client;
  const url = new URL(clientId);
  if (url.protocol !== "https:") return undefined;
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) return undefined;
  const doc = (await res.json()) as Partial<OAuthClientInformationFull>;
  if (doc.client_id !== clientId || !Array.isArray(doc.redirect_uris) || doc.redirect_uris.length === 0)
    return undefined;
  const client = { ...doc, client_id: clientId, token_endpoint_auth_method: "none" } as OAuthClientInformationFull;
  cimdCache.set(clientId, { client, fetchedAt: Date.now() });
  return client;
}

export const clientsStore: OAuthRegisteredClientsStore = {
  async getClient(clientId: string) {
    const stored = db.get<OAuthClientInformationFull>("clients", clientId);
    if (stored) return stored;
    if (clientId.startsWith("https://")) {
      try {
        return await fetchClientMetadataDocument(clientId);
      } catch {
        return undefined;
      }
    }
    return undefined;
  },
  async registerClient(client) {
    const full = client as OAuthClientInformationFull;
    return db.put("clients", full.client_id, full);
  },
};

export function clientDisplayName(client: OAuthClientInformationFull): string {
  if (client.client_name) return client.client_name;
  try {
    return new URL(client.redirect_uris[0]).hostname;
  } catch {
    return "An AI agent";
  }
}

/* ---------------- tokens ---------------- */

export async function mintAccessToken(
  visa: Visa,
  human: Human,
  clientId: string,
  opts: { expiresInSeconds?: number; audience?: string } = {},
) {
  // An errand through the Courier connector works at every shop, with one token per shop.
  const audience = opts.audience ?? visa.resource;
  const { privateKey, kid } = await signingKey();
  const now = Math.floor(Date.now() / 1000);
  const visaExp = Math.floor(new Date(visa.expiresAt).getTime() / 1000);
  const exp =
    opts.expiresInSeconds !== undefined
      ? now + opts.expiresInSeconds
      : Math.min(now + ACCESS_TOKEN_TTL_SECONDS, visaExp);
  const claims: Omit<VisaTokenClaims, "iss" | "aud" | "sub" | "exp" | "iat" | "jti"> = {
    client_id: clientId,
    scope: visa.scopes.join(" "),
    human: { verified: human.verified, age_range: human.ageRange },
    visa: {
      id: visa.id,
      agent: visa.agentName,
      merchant: audience,
      spend_limit: { currency: visa.currency, value: centsToValue(visa.spendLimitCents) },
      per_purchase_limit: { currency: visa.currency, value: centsToValue(visa.perPurchaseLimitCents) },
      intent: visa.intent || null,
      expires_at: visa.expiresAt,
      bond: visa.bond ? { amount: centsToValue(visa.bond.amountCents), status: visa.bond.status } : null,
      autopay: visa.autopay?.status === "on",
    },
  };
  const token = await new SignJWT(claims as Record<string, unknown>)
    .setProtectedHeader({ alg: "EdDSA", kid, typ: "at+jwt" })
    .setIssuer(config.courier.url)
    .setAudience(audience)
    .setSubject(pairwiseSubject(human.id, audience))
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setJti(newId("at"))
    .sign(privateKey);
  return { token, expiresIn: Math.max(0, exp - now) };
}

async function issueTokens(visa: Visa, human: Human, clientId: string): Promise<OAuthTokens> {
  const { token, expiresIn } = await mintAccessToken(visa, human, clientId);
  const refresh = `crt_${randomToken(32)}`;
  db.put<RefreshTokenRecord>("refresh_tokens", sha256(refresh), {
    id: sha256(refresh),
    clientId,
    visaId: visa.id,
    humanId: human.id,
    expiresAt: visa.expiresAt,
    revoked: false,
  });
  return {
    access_token: token,
    token_type: "Bearer",
    expires_in: expiresIn,
    scope: visa.scopes.join(" "),
    refresh_token: refresh,
  };
}

async function signConnectionToken(connection: Connection, human: Human, audience: string, ttlSeconds: number) {
  const { privateKey, kid } = await signingKey();
  const claims: Omit<ConnectionTokenClaims, "iss" | "aud" | "sub" | "exp" | "iat" | "jti"> = {
    client_id: connection.clientId,
    scope: connection.scopes.join(" "),
    human: { verified: human.verified, age_range: human.ageRange },
    connection: { id: connection.id, agent: connectionAgent(connection) },
  };
  return new SignJWT(claims as Record<string, unknown>)
    .setProtectedHeader({ alg: "EdDSA", kid, typ: "at+jwt" })
    .setIssuer(config.courier.url)
    .setAudience(audience)
    .setSubject(pairwiseSubject(human.id, audience))
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .setJti(newId("at"))
    .sign(privateKey);
}

/** What the Courier connector shows one shop while browsing: just long enough for one call, for that shop alone. */
export const mintShopConnectionToken = (connection: Connection, human: Human, shopResource: string) =>
  signConnectionToken(connection, human, shopResource, 60);

/** A connection's token says who Claude acts for and carries no limits, so it lasts across errands. */
async function issueConnectionTokens(connection: Connection, human: Human): Promise<OAuthTokens> {
  const token = await signConnectionToken(connection, human, connection.resource, ACCESS_TOKEN_TTL_SECONDS);
  const refresh = `crt_${randomToken(32)}`;
  db.put<RefreshTokenRecord>("refresh_tokens", sha256(refresh), {
    id: sha256(refresh),
    clientId: connection.clientId,
    connectionId: connection.id,
    humanId: human.id,
    expiresAt: new Date(Date.now() + CONNECTION_REFRESH_TTL_MS).toISOString(),
    revoked: false,
  });
  return {
    access_token: token,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    scope: connection.scopes.join(" "),
    refresh_token: refresh,
  };
}

function assertConnectionUsable(connection: Connection | undefined): asserts connection is Connection {
  if (connection?.status !== "active") throw new InvalidGrantError("this connection was removed");
}

function assertVisaUsable(visa: Visa | undefined): asserts visa is Visa {
  if (!visa) throw new InvalidGrantError("visa not found");
  const status = effectiveStatus(visa);
  if (status !== "active") throw new InvalidGrantError(`visa is ${status}`);
}

/* ---------------- authorization codes ---------------- */

export function issueAuthorizationCode(
  request: AuthRequest,
  grant: { visaId: string } | { connectionId: string },
  human: Human,
): string {
  const code = `cc_${randomToken(24)}`;
  db.put<AuthCode>("codes", sha256(code), {
    code: sha256(code),
    authRequestId: request.id,
    clientId: request.clientId,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    ...grant,
    humanId: human.id,
    resource: request.resource,
    expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    used: false,
  });
  db.update<AuthRequest>("auth_requests", request.id, (r) => ({ ...r, completed: true, ...grant }));
  return code;
}

/** Builds the redirect back to the MCP client, including the RFC 9207 `iss` parameter. */
export function clientRedirect(request: AuthRequest, params: Record<string, string>): string {
  const url = new URL(request.redirectUri);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (request.state) url.searchParams.set("state", request.state);
  url.searchParams.set("iss", config.courier.url);
  return url.toString();
}

/* ---------------- the provider ---------------- */

export class CourierOAuthProvider implements OAuthServerProvider {
  get clientsStore() {
    return clientsStore;
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const merchant = findMerchant(params.resource?.href);
    if (!merchant) {
      throw new InvalidTargetError(
        `Unknown resource ${params.resource?.href ?? "(none)"}. Courier only issues visas for registered merchants.`,
      );
    }
    const requested = (params.scopes ?? []).filter(isScope) as Scope[];
    const scopes = (requested.length ? requested : merchant.scopes).filter((s) => merchant.scopes.includes(s));

    const request: AuthRequest = {
      id: newId("ar"),
      clientId: client.client_id,
      clientName: clientDisplayName(client),
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state,
      scopes: scopes.length ? scopes : ["store:browse"],
      resource: merchant.resource,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + AUTH_REQUEST_TTL_MS).toISOString(),
    };
    db.put("auth_requests", request.id, request);
    res.redirect(302, `/connect/${request.id}`);
  }

  async challengeForAuthorizationCode(_client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const code = db.get<AuthCode>("codes", sha256(authorizationCode));
    if (!code) throw new InvalidGrantError("invalid authorization code");
    return code.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const id = sha256(authorizationCode);
    const code = db.get<AuthCode>("codes", id);
    if (!code || code.used) throw new InvalidGrantError("invalid or already used authorization code");
    if (new Date(code.expiresAt).getTime() < Date.now()) throw new InvalidGrantError("authorization code expired");
    if (code.clientId !== client.client_id) throw new InvalidGrantError("code was issued to another client");
    if (redirectUri && redirectUri !== code.redirectUri) throw new InvalidGrantError("redirect_uri mismatch");
    if (resource && normalizeResource(resource.href) !== normalizeResource(code.resource)) {
      throw new InvalidTargetError("resource does not match the authorization request");
    }
    db.update<AuthCode>("codes", id, (c) => ({ ...c, used: true }));

    const human = db.get<Human>("humans", code.humanId);
    if (!human) throw new InvalidGrantError("unknown person");
    if (code.connectionId) {
      const connection = db.get<Connection>("connections", code.connectionId);
      assertConnectionUsable(connection);
      return issueConnectionTokens(connection, human);
    }
    const visa = db.get<Visa>("visas", code.visaId ?? "");
    assertVisaUsable(visa);
    return issueTokens(visa, human, client.client_id);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    _scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const id = sha256(refreshToken);
    const record = db.get<RefreshTokenRecord>("refresh_tokens", id);
    if (!record || record.revoked || record.clientId !== client.client_id)
      throw new InvalidGrantError("invalid refresh token");
    if (new Date(record.expiresAt).getTime() < Date.now()) throw new InvalidGrantError("refresh token expired");
    const connection = record.connectionId ? db.get<Connection>("connections", record.connectionId) : undefined;
    const visa = record.visaId ? db.get<Visa>("visas", record.visaId) : undefined;
    if (record.connectionId) assertConnectionUsable(connection);
    else assertVisaUsable(visa);
    const granted = connection?.resource ?? visa?.resource ?? "";
    if (resource && normalizeResource(resource.href) !== normalizeResource(granted)) {
      throw new InvalidTargetError("resource does not match this grant");
    }
    const human = db.get<Human>("humans", record.humanId);
    if (!human) throw new InvalidGrantError("unknown person");
    // Rotate: the old refresh token can't be used again.
    db.update<RefreshTokenRecord>("refresh_tokens", id, (r) => ({ ...r, revoked: true }));
    return connection ? issueConnectionTokens(connection, human) : issueTokens(visa!, human, client.client_id);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const { privateKey: _p, publicJwk } = await signingKey();
    const { importJWK } = await import("jose");
    const key = await importJWK(publicJwk, "EdDSA");
    try {
      const { payload } = await jwtVerify(token, key, { issuer: config.courier.url });
      return {
        token,
        clientId: String(payload.client_id ?? ""),
        scopes: String(payload.scope ?? "")
          .split(" ")
          .filter(Boolean),
        expiresAt: payload.exp,
        resource: payload.aud ? new URL(String(payload.aud)) : undefined,
        extra: payload as Record<string, unknown>,
      };
    } catch (error) {
      throw new InvalidTokenError((error as Error).message);
    }
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const record = db.get<RefreshTokenRecord>("refresh_tokens", sha256(request.token));
    if (record && record.clientId === client.client_id) {
      db.update<RefreshTokenRecord>("refresh_tokens", record.id, (r) => ({ ...r, revoked: true }));
    }
  }
}

export function findAuthRequest(id: string): AuthRequest | null {
  const request = db.get<AuthRequest>("auth_requests", id);
  if (!request) return null;
  if (new Date(request.expiresAt).getTime() < Date.now()) return null;
  return request;
}
