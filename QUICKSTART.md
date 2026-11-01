# Quickstart

Courier lets you ask Claude to buy something and have it just happen, inside limits you set. PayPal confirms you're a
real person, and your AI gets its own ID and spending rules.

This page covers what Courier does, what works today and what's next, as of November 1, 2026. It also covers
[the ways to try it](#ways-to-try-it), [how to run it on your machine with PayPal's test
environment](#run-it-locally-with-paypal-sandbox) and [what changed recently](#changelog).

## The story

You want a jazz record for your dad's birthday, and you'd rather not shop for it yourself. Here's how that goes with
Courier.

1. **PayPal confirms it's you.** You sign in to Courier with PayPal. Courier only needs to know you're a real, verified
   adult.
2. **You name your courier.** A courier is your AI with its own ID card. Say you call yours Juno.
3. **You add Courier to Claude.** You paste one address into Claude's settings and click Connect. This only happens once,
   and nothing is bought or charged.
4. **You ask.** "Find me a jazz record at Juniper Records. I have about $40." Or "Send Steve for flowers on Floor Dash, $20."
5. **The budget belongs to the errand.** Under the cap you set when connecting (say $50 an errand, $100 a day), the errand
   just starts. Above it you confirm the budget in a card under Claude's reply, or at a link. Several errands can run at
   once, with any courier, at any shop. Each ends when you call it back, when its budget is used up, or after 24 hours.
6. **You save PayPal once.** The first time, PayPal asks if Courier can pay without asking each time. You agree, and you
   won't see that page again.
7. **Juno does the shopping.** Claude notices the budget by itself and carries on. Juno searches the shop, picks a record
   and pays. You don't see a checkout page, and you get a receipt you can open.
8. **If it breaks the rules, the answer is no.** A $149 turntable is over a $60 budget, so it's refused without anyone
   being asked.
9. **The shop knows who it's dealing with.** It sees that a verified courier is shopping and what it's allowed to do,
   but Courier doesn't give it your name.
10. **You stay in charge.** Every step shows up in your Courier home, and you can call Juno back at any time. When the
    errand ends, the saved PayPal is removed, and Claude stays connected for next time.

That's the whole idea: one ticket, then it just happens. To try it yourself, follow the steps under
[Try it](README.md#try-it). You won't need any accounts or keys, because the demo uses a pretend PayPal.

## What works today

Everything in the story is built and passes our automated tests using a pretend PayPal. The real-PayPal status is at the
end of this section.

**For the person**

| Feature             | What it does                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| PayPal sign-in      | Confirms you're real, and turns away unverified accounts and under-18s                                                                |
| Couriers            | Your AI gets a name, a colour and an ID card, and you can have several                                                                |
| Errand tickets      | Set one budget, in the chat or on a page. The courier works out the rest                                                              |
| Works inside Claude | Add one Courier connector, with no ticket or payment, and reach every shop and courier                                                |
| Spending cap        | Set once: under it Claude starts errands without asking, above it you confirm. Enforced in code                                       |
| Errand room         | Send a courier shopping from the Courier website, with no Claude setup                                                                |
| Asking first        | Built, but off by default: a courier can buy anything inside its budget at its shop. Set `INTENT_CHECK=on` to bring the question back |
| Pay without asking  | Save PayPal once on your account, and purchases inside a budget just go through                                                       |
| Pay by link         | Without a saved PayPal, the courier sends a link and you approve the payment                                                          |
| Receipts            | Every purchase comes with a page showing what was bought, what it cost and who bought it                                              |
| Refundable bond     | A $5 hold on your PayPal, returned unless the shop reports abuse. Built, but no longer offered on the ticket                          |
| Call back           | Ends an errand within seconds                                                                                                         |
| Errand history      | Shows every step a courier took and what it spent                                                                                     |

**For the shop**

| Feature            | What it does                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| Demo shops         | Amazoo, Floor Dash, Lord Knight, Mike and Juniper Records, pretend shops shown as a grid of logos               |
| What the shop sees | Who's shopping, their orders, signed proof of what each was allowed to do, and a button to report a bad courier |
| Release the bots   | Eight attacks on the shop, like fake IDs and overspending, that you can watch get stopped live                  |

**How much is proven on real PayPal**

Real Claude and the PayPal test environment have run sign-in, a ticket, a payment link and Pay without asking. The new
connect-first flow, receipts and the bond have only run on the pretend PayPal so far. No real money is involved at any
point.

## What's next

We're on a tight timeline, so the near-term list is short.

**Next**

- **Group buying (Courier Runs).** Several people's couriers chip in and buy one thing together, like a family splitting
  a $120 gift. The landing page already advertises this, so we either build it or take that section down. The first
  version is estimated at 3–4 days.
- **Wait and ping.** Some chat apps can't show a yes-or-no question, so today the courier stops and sends a link.
  Instead, it would wait and ping you, then carry on once you answer.

**Final polish**

- **Final copy.** Get rid of any wording that reads as low effort or AI-generated.
- **Final branding.** Settle the look of the whole product.
- **Optimized UX.** Smooth out the full flow, from end to end.
- **Final positioning.** Settle how we describe Courier and who it's for.

**Later**

- **Real shops.** Courier knows five pretend shops today, listed in code. Real shops would need a way to sign up, and PayPal would
  need to approve us to charge on their behalf.
- **Getting ready for real use.** This includes a login on the shop's dashboard and a database built for more than one
  server.
- **Working with other agent standards.** These are newer protocols for AI agents to prove what they're allowed to do
  and to hand tasks to each other.

**Still to decide:** does group buying ship in the first release?

## Ways to try it

PayPal sandbox is PayPal's test environment. It works like the real thing, but no real money moves.

| What you want to do                                                      | Where                                                            | Keys needed | Tunnel needed |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------- | ----------- | ------------- |
| Try the full flow with your Claude and PayPal sandbox                    | [The hosted site](#use-the-hosted-site)                          | No          | No            |
| Look around with a pretend PayPal                                        | Your machine, [`npm run demo`](README.md#try-it)                 | No          | No            |
| Test code changes in Claude Code with a pretend PayPal                   | Your machine, `npm run demo`                                     | No          | No            |
| Test code changes with PayPal sandbox, or in claude.ai or Claude Desktop | Your machine, [steps below](#run-it-locally-with-paypal-sandbox) | Yes         | Yes           |

### Use the hosted site

1. Get a **Personal** PayPal sandbox account ([step 1 of the PayPal setup](#3-set-up-paypal-sandbox)).
2. Open <https://courier.167-99-248-134.sslip.io/start> and sign in with that account.
3. To use your own Claude, add `https://courier.167-99-248-134.sslip.io/mcp` as a custom connector.

## Run it locally with PayPal sandbox

Follow these steps only to test your own code changes with PayPal sandbox, or in claude.ai or Claude Desktop. Never commit
`.env` or share what's in it.

### 1. Create your settings file

```bash
cp .env.example .env
```

### 2. Fill in the secrets

| Setting                                    | Needed? | How to get it                                                                                                    |
| ------------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------- |
| `COURIER_SECRET`, `INTERNAL_SECRET`        | Yes     | Generate a different value for each with `openssl rand -hex 32`                                                  |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Yes     | Your PayPal sandbox app, see step 3                                                                              |
| `ANTHROPIC_API_KEY`                        | No      | [Anthropic Console](https://console.anthropic.com). Usage is billed                                              |
| `PAYPAL_WEBHOOK_ID`                        | No      | From your PayPal app, only to confirm payment updates came from PayPal. Send them to `STORE_URL/webhooks/paypal` |
| `JEV_API_KEY`, `JEV_BASE_URL`              | No      | Jev is in early access. Otherwise, leave these empty                                                             |
| `COURIER_SIGNING_KEY`                      | No      | Leave it empty. Courier creates one the first time it runs                                                       |

Without an Anthropic key, the errand room on Courier's website follows a fixed script. Your own Claude still works without
one.

### 3. Set up PayPal sandbox

Sign in at [developer.paypal.com](https://developer.paypal.com), then:

1. Go to **Testing Tools** > **Sandbox Accounts** and make sure you have a **Personal** account (the buyer) and a
   **Business** account (the shop). **Create account** adds one. To see an account's login, open its menu in the
   **Settings** column and choose **View/Edit account**.
2. Go to **Apps & Credentials**, stay on **Sandbox**, and choose **Create App**. Copy its client ID and secret into
   `.env`.
3. In the app, enable **Log in with PayPal** and share only "Account verification status" and "PayPal account ID (payer
   ID)".
4. To use **Pay without asking**, go to App Feature Options > Accept payments > Advanced options and tick **Vault**.
   Without it, Courier sends a PayPal link for each purchase instead.

### 4. Start it with a tunnel

A tunnel gives your machine a temporary public address, so claude.ai and Claude Desktop can reach it. We also use it for
PayPal sign-in, because PayPal may not accept a `localhost` address and we've only tested this setup through the tunnel.
You don't need an account, only [`cloudflared`](https://github.com/cloudflare/cloudflared), which you can install with
`brew install cloudflared`.

```bash
./scripts/tunnel.sh
```

Leave it running. It saves the new addresses in `.env` and starts both apps. In your PayPal app, set the return URL to
`COURIER_URL/auth/paypal/callback`. The addresses change every time you run the script, so update the return URL each
time.

Then check your setup from a second terminal:

```bash
npm run preflight -- --paypal
```

When every line shows ✓, sign in with your **Personal** sandbox account. To connect Claude and check that the money
reached your **Business** account, follow the [live test](docs/live-test.md).

## Changelog

### November 1, 2026

- **Moved to DigitalOcean.** Courier and the demo shops now run at <https://courier.167-99-248-134.sslip.io> and
  <https://shop.167-99-248-134.sslip.io>. You no longer need a tunnel to use them.
- **One connector for every shop.** You add Courier to Claude once, and it reaches every shop and courier.
- **Budgets in the chat.** You can set an errand's budget inside the chat.
- **New landing page.** It now tells one story from start to finish, addressed to you, with a new header and cards that
  arrive one at a time.
- **App redesign.** The app now has one budget and fewer screens.
- **Delete your account.** You can now delete your account and start again.
- **Connecting and receipts.** You can connect Claude before writing a ticket, and every purchase comes with a receipt.
