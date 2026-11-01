import { config } from "./config.ts";

/**
 * PayPal gateway used by both apps.
 *
 * - `SandboxPayPal` talks to the real PayPal sandbox REST APIs (used when PAYPAL_CLIENT_ID/SECRET are set).
 * - `SimulatedPayPal` talks to the built-in simulator mounted in Courier app at /sim-paypal,
 *   so the whole product can be run and demoed before credentials exist.
 *
 * Both expose the same interface, so the rest of the code never branches on the mode.
 */

export interface PayPalIdentity {
  payerId: string;
  verified: boolean;
  ageRange: string | null;
  accountType: string | null;
  emailVerified: boolean | null;
  /** Display name, only when the login scopes include it (the simulator always sends one). */
  name?: string | null;
}

export interface CreateOrderInput {
  intent: "CAPTURE" | "AUTHORIZE";
  amountCents: number;
  currency: string;
  description: string;
  customId: string;
  returnUrl: string;
  cancelUrl: string;
  brandName: string;
  items?: { name: string; unitCents: number; quantity: number; sku?: string }[];
}

export interface OrderSummary {
  id: string;
  status: string;
  approveUrl: string | null;
  customId: string | null;
  amountCents: number | null;
  captureId?: string | null;
  authorizationId?: string | null;
}

/** Saving the person's PayPal for one errand, so the shop can charge it later without a PayPal page each time. */
export interface VaultSetupInput {
  description: string;
  brandName: string;
  returnUrl: string;
  cancelUrl: string;
}

export interface SavedPayPal {
  /** The payment token id (PayPal's vault_id). Stays inside Courier; never sent to shops or agents. */
  id: string;
  email: string | null;
}

export interface PayPalGateway {
  readonly mode: "sandbox" | "simulated";
  loginUrl(params: { redirectUri: string; state: string }): string;
  exchangeLoginCode(code: string, redirectUri: string): Promise<PayPalIdentity>;
  createOrder(input: CreateOrderInput, idempotencyKey: string): Promise<OrderSummary>;
  getOrder(orderId: string): Promise<OrderSummary>;
  captureOrder(orderId: string, idempotencyKey: string): Promise<OrderSummary>;
  authorizeOrder(orderId: string, idempotencyKey: string): Promise<OrderSummary>;
  voidAuthorization(authorizationId: string): Promise<void>;
  captureAuthorization(authorizationId: string, idempotencyKey: string): Promise<{ captureId: string; status: string }>;
  verifyWebhook(headers: Record<string, string | undefined>, body: unknown): Promise<boolean>;
  /** Vault v3: a setup token the person approves on PayPal (one time, no payment). */
  createVaultSetup(input: VaultSetupInput, idempotencyKey: string): Promise<{ id: string; approveUrl: string | null }>;
  /** After approval: turns the setup token into a saved payment token. */
  createVaultToken(setupTokenId: string, idempotencyKey: string): Promise<SavedPayPal>;
  /** Charges a saved PayPal right away (Orders v2 with vault_id); no buyer page. */
  chargeVault(
    input: Omit<CreateOrderInput, "returnUrl" | "cancelUrl" | "intent">,
    vaultId: string,
    idempotencyKey: string,
  ): Promise<OrderSummary>;
  deleteVaultToken(vaultId: string): Promise<void>;
}

export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function toBool(value: unknown): boolean | null {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
}

/** Login failures must identify the failed stage without logging tokens or personal data. */
async function loginJson(res: Response, stage: string): Promise<Record<string, unknown>> {
  const text = await res.text();
  const details = {
    stage,
    httpStatus: res.status,
    contentType: res.headers.get("content-type"),
    bodyBytes: Buffer.byteLength(text),
    debugId: res.headers.get("paypal-debug-id"),
  };
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Not an object");
    data = parsed as Record<string, unknown>;
  } catch {
    throw new PayPalError(
      `PayPal ${stage} returned ${text.trim() ? "non-JSON" : "an empty response"}`,
      res.status,
      details,
    );
  }
  if (!res.ok) {
    throw new PayPalError(`PayPal ${stage} failed`, res.status, {
      ...details,
      error: typeof data.error === "string" ? data.error : data.name,
    });
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* Real PayPal sandbox                                                  */
/* ------------------------------------------------------------------ */

class SandboxPayPal implements PayPalGateway {
  readonly mode = "sandbox" as const;
  private appToken: { value: string; expiresAt: number } | null = null;

  private basicAuth(): string {
    return `Basic ${Buffer.from(`${config.paypal.clientId}:${config.paypal.clientSecret}`).toString("base64")}`;
  }

  private async token(): Promise<string> {
    if (this.appToken && this.appToken.expiresAt > Date.now() + 60_000) return this.appToken.value;
    const res = await fetch(`${config.paypal.apiBase}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: this.basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!res.ok || !json.access_token) throw new PayPalError("PayPal app token request failed", res.status, json);
    this.appToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
    return json.access_token;
  }

  private async api<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.token()}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };
    if (idempotencyKey) headers["PayPal-Request-Id"] = idempotencyKey;
    const res = await fetch(`${config.paypal.apiBase}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) throw new PayPalError(`PayPal ${method} ${path} failed (${res.status})`, res.status, json);
    return json as T;
  }

  loginUrl({ redirectUri, state }: { redirectUri: string; state: string }): string {
    // PayPal's documented Log in authorization endpoint (sandbox and live).
    // https://developer.paypal.com/log-in/build-button/
    const url = new URL(`${config.paypal.webBase}/connect`);
    url.searchParams.set("flowEntry", "static");
    url.searchParams.set("client_id", config.paypal.clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set(
      "scope",
      `openid ${config.paypal.askName ? "profile " : ""}https://uri.paypal.com/services/paypalattributes`,
    );
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeLoginCode(code: string, _redirectUri: string): Promise<PayPalIdentity> {
    const res = await fetch(`${config.paypal.apiBase}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: this.basicAuth(),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const tokenJson = await loginJson(res, "login code exchange");
    if (typeof tokenJson.access_token !== "string" || !tokenJson.access_token) {
      throw new PayPalError("PayPal login code exchange omitted the access token", 502);
    }

    let userToken = tokenJson.access_token;
    // PayPal's login guide calls for exchanging the refresh token before fetching
    // customer information. Keep both tokens local to this callback, never persisted.
    if (typeof tokenJson.refresh_token === "string" && tokenJson.refresh_token) {
      const refreshed = await fetch(`${config.paypal.apiBase}/v1/oauth2/token`, {
        method: "POST",
        headers: {
          Authorization: this.basicAuth(),
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokenJson.refresh_token }).toString(),
        signal: AbortSignal.timeout(15_000),
      });
      const refreshedJson = await loginJson(refreshed, "login token refresh");
      if (typeof refreshedJson.access_token !== "string" || !refreshedJson.access_token) {
        throw new PayPalError("PayPal login refresh omitted the access token", 502);
      }
      userToken = refreshedJson.access_token;
    }

    // PayPal's profile-sharing example includes the schema selector. Support the
    // login guide's PayPal schema too; deployments differ in which endpoint works.
    const profilePaths = [
      "/v1/identity/openidconnect/userinfo/?schema=openid",
      "/v1/identity/oauth2/userinfo?schema=paypalv1.1",
    ];
    let info: Record<string, unknown> | undefined;
    const failures: unknown[] = [];
    for (const profilePath of profilePaths) {
      try {
        const infoRes = await fetch(`${config.paypal.apiBase}${profilePath}`, {
          headers: {
            Authorization: `Bearer ${userToken}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(15_000),
        });
        info = await loginJson(infoRes, `userinfo (${profilePath})`);
        break;
      } catch (error) {
        if (!(error instanceof PayPalError)) throw error;
        failures.push(error.details);
        if (error.status === 401 || error.status === 403) throw error;
      }
    }
    if (!info) throw new PayPalError("PayPal userinfo endpoints failed", 502, { attempts: failures });

    const payerId = String(info.payer_id ?? info.user_id ?? info.sub ?? "");
    if (!payerId)
      throw new PayPalError("PayPal userinfo did not include an account id", 502, { fields: Object.keys(info) });
    return {
      payerId,
      verified: toBool(info.verified_account) === true,
      ageRange: (info.age_range as string) ?? null,
      accountType: (info.account_type as string) ?? null,
      emailVerified: toBool(info.email_verified),
    };
  }

  private summarize(order: any): OrderSummary {
    const links: { rel: string; href: string }[] = order.links ?? [];
    const approve = links.find((l) => l.rel === "payer-action" || l.rel === "approve");
    const unit = order.purchase_units?.[0];
    const capture = unit?.payments?.captures?.[0];
    const authorization = unit?.payments?.authorizations?.[0];
    return {
      id: order.id,
      status: order.status,
      approveUrl: approve?.href ?? null,
      customId: unit?.custom_id ?? capture?.custom_id ?? authorization?.custom_id ?? null,
      amountCents: unit?.amount?.value ? Math.round(Number(unit.amount.value) * 100) : null,
      captureId: capture?.id ?? null,
      authorizationId: authorization?.id ?? null,
    };
  }

  async createOrder(input: CreateOrderInput, idempotencyKey: string): Promise<OrderSummary> {
    const value = (input.amountCents / 100).toFixed(2);
    const unit: Record<string, unknown> = {
      custom_id: input.customId,
      description: input.description.slice(0, 127),
      amount: { currency_code: input.currency, value },
    };
    if (input.items?.length) {
      unit.items = input.items.map((item) => ({
        name: item.name.slice(0, 127),
        sku: item.sku,
        quantity: String(item.quantity),
        unit_amount: { currency_code: input.currency, value: (item.unitCents / 100).toFixed(2) },
        category: "PHYSICAL_GOODS",
      }));
      unit.amount = {
        currency_code: input.currency,
        value,
        breakdown: { item_total: { currency_code: input.currency, value } },
      };
    }
    const order = await this.api<any>(
      "POST",
      "/v2/checkout/orders",
      {
        intent: input.intent,
        purchase_units: [unit],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: input.brandName.slice(0, 127),
              user_action: input.intent === "CAPTURE" ? "PAY_NOW" : "CONTINUE",
              shipping_preference: "NO_SHIPPING",
              return_url: input.returnUrl,
              cancel_url: input.cancelUrl,
            },
          },
        },
      },
      idempotencyKey,
    );
    return this.summarize(order);
  }

  async getOrder(orderId: string): Promise<OrderSummary> {
    return this.summarize(await this.api<any>("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`));
  }

  async captureOrder(orderId: string, idempotencyKey: string): Promise<OrderSummary> {
    return this.summarize(
      await this.api<any>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {}, idempotencyKey),
    );
  }

  async authorizeOrder(orderId: string, idempotencyKey: string): Promise<OrderSummary> {
    return this.summarize(
      await this.api<any>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {}, idempotencyKey),
    );
  }

  async voidAuthorization(authorizationId: string): Promise<void> {
    await this.api("POST", `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`);
  }

  async captureAuthorization(authorizationId: string, idempotencyKey: string) {
    const res = await this.api<any>(
      "POST",
      `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`,
      { final_capture: true },
      idempotencyKey,
    );
    return { captureId: res.id as string, status: res.status as string };
  }

  // https://developer.paypal.com/docs/checkout/save-payment-methods/purchase-later/payment-tokens-api/paypal/
  // The sandbox app needs Vault enabled (App Feature Options → Accept payments → Advanced options → Vault).
  async createVaultSetup(input: VaultSetupInput, idempotencyKey: string) {
    const token = await this.api<any>(
      "POST",
      "/v3/vault/setup-tokens",
      {
        payment_source: {
          paypal: {
            description: input.description.slice(0, 127),
            permit_multiple_payment_tokens: true,
            usage_pattern: "IMMEDIATE",
            usage_type: "MERCHANT",
            customer_type: "CONSUMER",
            experience_context: {
              brand_name: input.brandName.slice(0, 127),
              shipping_preference: "NO_SHIPPING",
              return_url: input.returnUrl,
              cancel_url: input.cancelUrl,
            },
          },
        },
      },
      idempotencyKey,
    );
    const links: { rel: string; href: string }[] = token.links ?? [];
    return { id: token.id as string, approveUrl: links.find((l) => l.rel === "approve")?.href ?? null };
  }

  async createVaultToken(setupTokenId: string, idempotencyKey: string): Promise<SavedPayPal> {
    const token = await this.api<any>(
      "POST",
      "/v3/vault/payment-tokens",
      { payment_source: { token: { id: setupTokenId, type: "SETUP_TOKEN" } } },
      idempotencyKey,
    );
    return { id: token.id, email: token.payment_source?.paypal?.email_address ?? null };
  }

  async chargeVault(
    input: Omit<CreateOrderInput, "returnUrl" | "cancelUrl" | "intent">,
    vaultId: string,
    idempotencyKey: string,
  ) {
    const value = (input.amountCents / 100).toFixed(2);
    const unit: Record<string, unknown> = {
      custom_id: input.customId,
      description: input.description.slice(0, 127),
      soft_descriptor: input.brandName.slice(0, 22),
      amount: { currency_code: input.currency, value },
    };
    if (input.items?.length) {
      unit.items = input.items.map((item) => ({
        name: item.name.slice(0, 127),
        sku: item.sku,
        quantity: String(item.quantity),
        unit_amount: { currency_code: input.currency, value: (item.unitCents / 100).toFixed(2) },
        category: "PHYSICAL_GOODS",
      }));
      unit.amount = {
        currency_code: input.currency,
        value,
        breakdown: { item_total: { currency_code: input.currency, value } },
      };
    }
    let order = this.summarize(
      await this.api<any>(
        "POST",
        "/v2/checkout/orders",
        { intent: "CAPTURE", purchase_units: [unit], payment_source: { paypal: { vault_id: vaultId } } },
        idempotencyKey,
      ),
    );
    // PayPal usually completes a saved-PayPal order on creation; capture if it stopped at APPROVED.
    if (order.status === "APPROVED") order = await this.captureOrder(order.id, `${idempotencyKey}-capture`);
    return order;
  }

  async deleteVaultToken(vaultId: string): Promise<void> {
    await this.api("DELETE", `/v3/vault/payment-tokens/${encodeURIComponent(vaultId)}`);
  }

  async verifyWebhook(headers: Record<string, string | undefined>, body: unknown): Promise<boolean> {
    if (!config.paypal.webhookId) return false;
    const res = await this.api<{ verification_status: string }>("POST", "/v1/notifications/verify-webhook-signature", {
      auth_algo: headers["paypal-auth-algo"],
      cert_url: headers["paypal-cert-url"],
      transmission_id: headers["paypal-transmission-id"],
      transmission_sig: headers["paypal-transmission-sig"],
      transmission_time: headers["paypal-transmission-time"],
      webhook_id: config.paypal.webhookId,
      webhook_event: body,
    });
    return res.verification_status === "SUCCESS";
  }
}

/* ------------------------------------------------------------------ */
/* Simulator (mounted in Courier app at /sim-paypal)             */
/* ------------------------------------------------------------------ */

class SimulatedPayPal implements PayPalGateway {
  readonly mode = "simulated" as const;
  private base = `${config.courier.url}/sim-paypal`;

  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", "X-Internal-Secret": config.internalSecret },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) throw new PayPalError(json.message ?? `Simulator ${method} ${path} failed`, res.status, json);
    return json as T;
  }

  loginUrl({ redirectUri, state }: { redirectUri: string; state: string }): string {
    const url = new URL(`${this.base}/login`);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    return url.toString();
  }

  exchangeLoginCode(code: string): Promise<PayPalIdentity> {
    return this.api("POST", "/login/token", { code });
  }

  createOrder(input: CreateOrderInput, idempotencyKey: string): Promise<OrderSummary> {
    return this.api("POST", "/orders", { ...input, idempotencyKey });
  }

  getOrder(orderId: string): Promise<OrderSummary> {
    return this.api("GET", `/orders/${encodeURIComponent(orderId)}`);
  }

  captureOrder(orderId: string): Promise<OrderSummary> {
    return this.api("POST", `/orders/${encodeURIComponent(orderId)}/capture`);
  }

  authorizeOrder(orderId: string): Promise<OrderSummary> {
    return this.api("POST", `/orders/${encodeURIComponent(orderId)}/authorize`);
  }

  async voidAuthorization(authorizationId: string): Promise<void> {
    await this.api("POST", `/authorizations/${encodeURIComponent(authorizationId)}/void`);
  }

  captureAuthorization(authorizationId: string) {
    return this.api<{ captureId: string; status: string }>(
      "POST",
      `/authorizations/${encodeURIComponent(authorizationId)}/capture`,
    );
  }

  async verifyWebhook(headers: Record<string, string | undefined>): Promise<boolean> {
    return headers["x-internal-secret"] === config.internalSecret;
  }

  createVaultSetup(input: VaultSetupInput, idempotencyKey: string) {
    return this.api<{ id: string; approveUrl: string | null }>("POST", "/vault/setup-tokens", {
      ...input,
      idempotencyKey,
    });
  }

  createVaultToken(setupTokenId: string): Promise<SavedPayPal> {
    return this.api("POST", "/vault/payment-tokens", { setupTokenId });
  }

  chargeVault(
    input: Omit<CreateOrderInput, "returnUrl" | "cancelUrl" | "intent">,
    vaultId: string,
    idempotencyKey: string,
  ): Promise<OrderSummary> {
    return this.api("POST", "/vault/charge", { ...input, vaultId, idempotencyKey });
  }

  async deleteVaultToken(vaultId: string): Promise<void> {
    await this.api("DELETE", `/vault/payment-tokens/${encodeURIComponent(vaultId)}`);
  }
}

export const paypal: PayPalGateway = config.paypal.mode === "sandbox" ? new SandboxPayPal() : new SimulatedPayPal();
