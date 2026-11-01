# Live sandbox test

Goal: run real errands through the PayPal **sandbox** with real Claude, and check that the money lands in the
**sandbox Business account** (the account that owns the PayPal app). No real money moves.

Two sandbox accounts are involved:
- **Personal (buyer):** signs in to Courier with "Continue with PayPal" and pays.
- **Business (shop):** owns the sandbox app and receives the payments. Check it at https://www.sandbox.paypal.com.

These steps test code running on your machine, set up as in the
[Quickstart](../QUICKSTART.md#run-it-locally-with-paypal-sandbox). To test the hosted site instead, skip steps 0.1 to
0.3 and use `https://courier.167-99-248-134.sslip.io` as `COURIER_URL` and `https://shop.167-99-248-134.sslip.io` as
`STORE_URL`. Its payments go to the Business account that owns the hosted site's PayPal app.

## 0. Before you start (5 minutes)

1. **Start the tunnel.** Its addresses stop working after a while, so start a fresh one for each test:
   1. Stop any old tunnels: `pkill -f "cloudflared tunnel"`
   2. Run `./scripts/tunnel.sh` and leave it running. It saves the new addresses in `.env` and restarts both apps.
2. **Check your setup:** `npm run preflight -- --paypal`. Everything should be ✓. It prints the addresses for the next
   steps. (`--paypal` only checks that PayPal accepts your sandbox app's keys. It creates nothing.)
3. **PayPal sandbox app** (developer.paypal.com → Apps & Credentials → Sandbox → your app → Log in with PayPal):
   set the Return URL to the one the preflight printed (`…/auth/paypal/callback`). Then, for **Pay without asking**:
   App Feature Options → Accept payments → Advanced options → tick **Vault** (saving PayPal for later). If it's off,
   errands still work; Courier just falls back to a PayPal page per purchase.
4. **Claude:**
   - claude.ai / desktop: Settings → Connectors → remove the old Courier connector → Add custom connector →
     name `Courier`, URL `COURIER_URL/mcp`. It reaches every shop.
   - Claude Code: `claude mcp remove courier`, then the `claude mcp add …` line the preflight printed.
     Start a **new** session so it sees the current tools.
   - Claude Code, once: let it call Courier without its own permission prompt (Courier already asks you when
     something is off the ticket, and PayPal asks before any money moves). Add `"mcp__courier"` to
     `permissions.allow` in `~/.claude/settings.json`, or pick "Yes, don't ask again" the first time it asks.
5. Open these in tabs:
   - Courier: `COURIER_URL/app`
   - What the shop sees: `STORE_URL/merchant`
   - Business account: https://www.sandbox.paypal.com (sign in as the Business account) → Activity

## 1. An errand inside the ticket

1. In Claude: _"Ask my courier to find me a jazz record under $40 at Juniper Records and buy it."_
2. First time only: connecting asks you to sign in with the **Personal** account, name or pick a courier, and say yes.
   Nothing is bought yet.
3. First purchase on a ticketless Claude: it gives you a ticket link. Check the prefill ("Jazz records for my dad",
   $60 / $40), leave **Pay without asking** on, and send it. PayPal asks once to save PayPal for Juniper Records: agree.
   Back in Claude, say "done".
4. Claude calls `request_purchase` and comes back with "Bought … paid with your saved PayPal". No link, no questions.
   (With Pay without asking off, or Vault off on the app: a PayPal link instead; pay it with the **Personal** account.)
5. Check:
   - [ ] Claude's reply includes a receipt link that opens a page showing the record, the price and "Paid". If the app
     supports MCP Apps, a receipt card appears in the chat too.
   - [ ] `order_status` says paid.
   - [ ] Courier → Errands: the ticket shows the spend and "pays with saved PayPal"; the steps show "Bought …" with
     "Paid with saved PayPal".
   - [ ] What the shop sees: the order is **Paid**, with the courier's name and "Signed proof".
   - [ ] **Business account → Activity:** a payment from the Personal buyer for the right amount. Its details
     should carry the visa id (`visa_…`) as the custom id.

## 2. Off the errand: Courier asks you (only with `INTENT_CHECK=on`)

1. In Claude: _"Grab me the Night Bus Freestyles CD too."_ (rap, $14: not jazz).
2. Expected:
   - **Claude Code:** a Courier dialog, "Courier: Juno wants Night Bus Freestyles for $14.00 … Allow it?"
     Pick **Yes, allow it** → it's bought and paid straight away (or, without saved PayPal, Claude gets a link).
   - **claude.ai / desktop** (or if Claude Code doesn't show the dialog): Claude gives you an approval link.
     Open it, allow, then tell Claude to go ahead.
3. Check:
   - [ ] The errand's steps show "You allowed it" (with "answered in Claude" if you used the dialog).
   - [ ] It's paid as in step 1, and the Business account shows the second payment.
   - [ ] Try one with **No**: Claude should say you declined it, and nothing is created.
4. If Claude Code blocks the tool before asking ("requires permission"): that's Claude Code's auto mode. Switch
   to the default mode, or allow the Courier tools, and retry.

## 3. The $5 bond

1. Start a new errand from Courier (Couriers → Errand room, or "New errand"). On the ticket, open
   "What … may do" and turn on **Add a $5 refundable bond**. Send it.
2. PayPal asks the **Personal** account to approve a $5 **authorization** (a hold, not a payment). Approve.
3. Check:
   - [ ] Courier: the errand shows "$5 bond authorized"; the steps show "Bond held".
   - [ ] Business account: a $5 authorization (pending, not captured).
4. Then one of:
   - **Call it back** (Errands → Call back): the hold should be **voided**. Errand says "bond voided"; the
     Business account shows the authorization voided.
   - Or **report it** (What the shop sees → the order → Signed proof → Report this courier): the hold should be
     **captured**. Errand says "bond captured"; the Business account receives $5.
5. If either fails, note the error shown and the time; the server log has a `[bond]` line.

## 4. Calling a courier back

- [ ] Errands → Call back on an errand Claude is using. Claude stays connected, and its next purchase gets a new ticket
  link. It should not ask you to reconnect.
- [ ] Settings → Disconnect. Claude's next tool call should fail with 401 and it should ask you to connect again.
- [ ] Settings → Delete my account. Claude's next tool call should fail, and signing in with the same PayPal should
  start from the first screen.
- [ ] The errand's steps say "Saved PayPal removed". On sandbox.paypal.com (Personal account → Settings → Payments
  → Manage automatic payments), Juniper Records should no longer be listed.

## If something goes wrong

| Symptom                                                                                       | Likely cause                                                                            | Fix                                             |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------- |
| PayPal: "client_id or redirect_uri incorrect"                                                 | Return URL in the PayPal app is an old tunnel address                                   | Step 0.3                                        |
| Claude can't connect / 502                                                                    | The tunnel stopped (hosted site: the apps may still be starting, wait a few seconds)    | Restart `./scripts/tunnel.sh`, redo 0.3 and 0.4 |
| Claude Code: tool "requires permission"                                                       | Claude Code's own prompt or auto mode                                                   | Allow `mcp__courier` (step 0.4)                 |
| No dialog in Claude Code, only a link                                                         | Known Claude Code issue with MCP dialogs                                                | Use the link; it works the same                 |
| "Pay without asking" goes straight back without a PayPal page, and purchases still give links | Vault is off on the sandbox app (server log: `[autopay] could not start saving PayPal`) | Step 0.3                                        |
| Courier asks about things that clearly fit                                                    | Intent check runs on Claude and judged it off-ticket                                    | Allow it; or `INTENT_MODEL=rules` in `.env`     |
