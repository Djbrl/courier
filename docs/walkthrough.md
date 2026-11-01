# Code walkthrough

This follows one request through the code: _"Buy me a jazz record under $40."_ It takes about 15 minutes, and by the end
you'll know where everything is.

Run it first, so the code has something to attach to:

```bash
npm install
npm run demo
```

Open <http://localhost:4000>, click **Try the demo**, and sign in as Maya Chen on the simulated PayPal page.

## The map

```text
apps/
  courier/src/
    server.ts            Entry point, OAuth wiring, PayPal sign-in, the ticket
    visas.ts             The spend authority: limits, holds, approvals, stamps
    db.ts                Data types and queries
    agent.ts             The agent behind the errand room
    paypal-simulator.ts  Stand-in PayPal pages and API
    auth/                OAuth provider, signing keys, sessions
    routes/              Onboarding and the app; Release the bots
    pages/               Server-rendered pages
  store/src/
    server.ts            Shop routes and the /mcp endpoint
    auth.ts              Verifies every token
    mcp.ts               The tools agents can call
    catalog.ts           What each shop sells
    views.ts             Logo grid, shop pages and merchant view
packages/shared/
  src/                   Config, PayPal gateway, intent check, visa model, store
  assets/                CSS and browser JavaScript
tests/                   Unit tests, the e2e, the MCP client check
```

## 1. The person sets up a courier

`apps/courier/src/routes/app.ts` holds the first-run routes, `/start` to `/start/summon`. Each renders a function from
`pages/onboarding.ts`.

Pages are plain functions that return strings. They use the `html` tag from `packages/shared/src/html.ts`, which escapes
every value unless it's wrapped in `raw()`. There's no client framework. `packages/shared/assets/` holds small scripts
for the few things that need the browser.

## 2. The agent discovers Courier

The agent only knows the shop's URL. Its first call has no token, and `requireVisa` in `apps/store/src/auth.ts` answers
with a 401 that points to the shop's metadata. That metadata names Courier as the authorization server, and the agent
registers itself using the OAuth routes wired up in `apps/courier/src/server.ts`.

Read `CourierOAuthProvider` in `apps/courier/src/auth/oauth.ts` next. It's where the MCP SDK's OAuth router meets our
data, and where `/authorize` hands over to a human.

## 3. The person connects Claude

Connecting is one question. After PayPal sign-in (`/auth/paypal/callback`), the person names a courier if they don't have
one, then answers `connectConsentPage` in `pages/consent.ts`. `POST /consent/:id` in `server.ts` creates a `Connection`.
No ticket and no payment are involved, so Claude can browse but not hold or buy.

## 4. The person writes the ticket

The first time Claude tries to hold or buy, the tool returns a link from `needsTicket` in `apps/store/src/mcp.ts`. It opens
the ticket, prefilled from what the person asked for: purpose, budget, per-purchase limit, how long it lasts.
`consentPage` renders it, and the same `POST /consent/:id` creates the visa once the person sends it. Nothing the agent
suggested applies until then.

The `Visa` type in `packages/shared/src/visa.ts` is the most important type in the codebase. Read it closely.

If **Pay without asking** is on, the person detours through PayPal once to save it, then returns to `/autopay/return`.
`continueIssuing` finishes the job either way, so a failure there falls back to PayPal links instead of blocking the
errand.

## 5. The tokens

Claude holds a connection token from `issueConnectionTokens` in `auth/oauth.ts`: who it acts for, with no limits, so it
outlasts any errand. On each request, the shop asks `GET /internal/connections/:id` for the current ticket, which comes as
a short-lived JWT from `mintAccessToken` with the visa's limits. The errand room holds that visa token directly.

Both use a pairwise pseudonym as their subject. Decode one from the e2e to see what a shop sees: no name, no email, no
PayPal ID.

## 6. The agent shops

Claude reaches shops through one connector: `createGateway` in `apps/courier/src/gateway.ts` holds `start_errand`, `buy` and the
rest, checks every shop and courier name it's given, and forwards each call to the shop's own tools with a token for that shop.
`withinCap` in `visas.ts` decides whether an errand starts straight away or waits for the person. The sections on tickets above
describe the older direct connector, which still works for Juniper Records.

`createMcpServer` in `apps/store/src/mcp.ts` registers the tools: `whoami`, `search_catalog`, `get_item`, `hold_item`,
`request_purchase` and `order_status`. Every call has passed `requireVisa` first, which checks the signature, issuer,
audience, expiry and the live status of the connection or visa.

Read the `request_purchase` tool from top to bottom. It's the heart of the product, and everything below happens inside
it.

## 7. Courier decides

The shop asks `POST /internal/spend/check`, in `apps/courier/src/visas.ts`. The order is the whole security model:

1. **Hard limits, in code:** scope and expiry always; for a purchase, the per-purchase limit and remaining budget
   including holds.
2. **Intent check (only with `INTENT_CHECK=on`):** `checkIntent` in `packages/shared/src/intent.ts` answers `approve`, `ask_human` or `deny`.
3. **Hold:** on an approved purchase, the budget is set aside.

To see each branch, try the demo with a jazz record, then a $149 turntable (refused by code), then a slipmat (Courier
asks you).

## 8. Asking the person

On `ask_human`, `askInChat` in `mcp.ts` sends an MCP elicitation, so the question appears inside Claude. If the client
can't show a dialog, or it closes without an answer, the tool returns an approval link instead (`/approvals/:id`). Only
an answer the person actually picks counts.

## 9. Paying

There are two paths, both in `request_purchase`:

- **Saved PayPal:** the shop calls `POST /internal/spend/charge`. Courier charges the Vault token and the agent gets a
  receipt. No PayPal page.
- **PayPal link:** the shop creates an order with the visa id in `custom_id`, and the agent shares the link. When the
  person returns, `/paypal/return` runs `settleOrder`, which captures the payment.

Both end in `fulfil`, which commits the spend and adds a stamp. All PayPal calls go through `PayPalGateway` in
`packages/shared/src/paypal.ts`.

Every order has a receipt page at `/receipts/:key` (`receiptPage` in `apps/store/src/views.ts`), and the tool result links
to it. Chat apps that support MCP Apps also show `receipt-card.ts` inside the conversation.

## 10. Calling it back

`revokeVisa` in `visas.ts` ends the errand and voids any bond. The saved PayPal belongs to the person, not the errand, and
stays until `removeSavedPayPal` deletes it. The connection stays, so Claude's next purchase gets a new ticket link instead. `sweepExpiredVisas` does the same on a timer
for errands that ran out. `disconnect` removes the Claude itself, and its next call fails `requireVisa`.
`deleteAccount` ends every errand, then erases the person's records, stopping first if PayPal won't release something.

## 11. See it attacked

`apps/courier/src/routes/bots.ts` fires eight attacks at the real endpoint. Each one is short and exercises a defence
you've just read about, so it's a good recap. Open <http://localhost:4000/bots> to run them.

## Where to go next

- `tests/e2e.ts` reads like a spec. Each `step` is one behaviour we promise.
- [architecture.md](architecture.md) explains the decisions.
- [live-test.md](live-test.md) runs all of this against the real PayPal sandbox with real Claude.
