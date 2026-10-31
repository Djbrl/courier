import assert from "node:assert/strict";
import { test } from "node:test";

// Set before loading configuration: tests never use real PayPal credentials.
process.env.PAYPAL_CLIENT_ID = "login-test-client";
process.env.PAYPAL_CLIENT_SECRET = "login-test-secret";
const { paypal, PayPalError } = await import("../../packages/shared/src/paypal.ts");
const originalFetch = globalThis.fetch;
const callback = "https://courier.example/auth/paypal/callback";

await test("refreshes the login token, requests the OpenID schema, and preserves missing age", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    if (calls.length === 1) return Response.json({ access_token: "initial-token", refresh_token: "refresh-token" });
    if (calls.length === 2) return Response.json({ access_token: "refreshed-token" });
    return Response.json({ user_id: "test-user", verified_account: "true", account_type: "PERSONAL" });
  };
  try {
    const identity = await paypal.exchangeLoginCode("test-code", callback);
    assert.equal(calls.length, 3);
    assert.equal(new URLSearchParams(String(calls[1]!.init!.body)).get("grant_type"), "refresh_token");
    assert.equal(new URL(calls[2]!.url).pathname, "/v1/identity/openidconnect/userinfo/");
    assert.equal(new URL(calls[2]!.url).searchParams.get("schema"), "openid");
    assert.equal(new Headers(calls[2]!.init!.headers).get("authorization"), "Bearer refreshed-token");
    assert.deepEqual(identity, {
      payerId: "test-user",
      verified: true,
      ageRange: null,
      accountType: "PERSONAL",
      emailVerified: null,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("falls back to the documented PayPal schema after an empty profile response", async () => {
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls++;
    if (calls === 1) return Response.json({ access_token: "user-token" });
    if (calls === 2) return new Response(null, { status: 200 });
    const url = new URL(String(input));
    assert.equal(url.pathname, "/v1/identity/oauth2/userinfo");
    assert.equal(url.searchParams.get("schema"), "paypalv1.1");
    return Response.json({ sub: "fallback-user", verified_account: false });
  };
  try {
    const identity = await paypal.exchangeLoginCode("test-code", callback);
    assert.equal(calls, 3);
    assert.equal(identity.payerId, "fallback-user");
    assert.equal(identity.verified, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("does not retry an authentication rejection or log personal fields", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return Response.json({ access_token: "private-token" });
    return Response.json(
      { error: "invalid_token", email: "private@example.test", access_token: "private-token" },
      { status: 401 },
    );
  };
  try {
    await assert.rejects(paypal.exchangeLoginCode("test-code", callback), (error: unknown) => {
      assert.ok(error instanceof PayPalError);
      assert.equal(error.status, 401);
      const details = JSON.stringify(error.details);
      assert.ok(details.includes("invalid_token"));
      assert.ok(!details.includes("private-token"));
      assert.ok(!details.includes("private@example.test"));
      return true;
    });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("identifies an empty code-exchange response without an unhelpful JSON exception", async () => {
  globalThis.fetch = async () => new Response(null, { status: 502 });
  try {
    await assert.rejects(paypal.exchangeLoginCode("test-code", callback), (error: unknown) => {
      assert.ok(error instanceof PayPalError);
      assert.match(error.message, /login code exchange returned an empty response/);
      assert.equal(error.status, 502);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
