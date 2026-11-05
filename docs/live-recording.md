# Recording one real payment

The published demo runs on the PayPal simulator and the PayPal sandbox, and stays that way. This page is for one
recorded payment with real money, on your own machine, that you refund afterwards.

## What keeps it contained

- Live mode only starts with `PAYPAL_LIVE=real-money`. Live keys or live PayPal addresses alone never turn it on:
  without the switch, Courier refuses to start if the PayPal addresses aren't the sandbox's.
- It only starts on localhost, with its own data folder (a name containing `live`), and never on a server.
- One payment can be at most $5, refused in code before anything reaches PayPal (`PAYPAL_LIVE_CAP_CENTS` can lower
  it, or raise it to $20 at most).
- Every page shows a red "Live PayPal: real money" bar, and receipts and the shop dashboard say real money moved.

## Before you record (you, in PayPal)

1. In the PayPal developer dashboard, switch to **Live** and create an app on your business account. The shop
   is paid into that account.
2. In the app's settings, turn on **Log in with PayPal** and add this return URL:
   `http://localhost:4000/auth/paypal/callback`. If PayPal won't accept a localhost URL for a live app, stop
   there: the way around it is a public tunnel, which is your call.
3. Saving PayPal (paying without a PayPal page) needs the Vault feature on the live app. Without it, Courier
   falls back to the PayPal page, which is fine for the recording.
4. Put the live keys in `.env.live` at the repo root. It is gitignored. Never commit or share it.

   ```
   PAYPAL_CLIENT_ID=…
   PAYPAL_CLIENT_SECRET=…
   ```

5. Have a second PayPal account to pay with (your personal one). PayPal doesn't let an account pay itself.

## Recording

1. Stop anything on ports 4000 and 4100, then run `npm run live-recording`. The script sets the switch,
   localhost and `data/live` itself, so `.env.live` only adds the keys.
2. Check the red bar is on every page and `http://localhost:4000/healthz` says `"paypal":"live"`.
3. Sign in with your personal PayPal account and make a courier.
4. Ask for something under $5, e.g. "A flat white from Beanbucks" ($4.20).
5. Pay on PayPal's page with your personal account, then show the receipt, and the payment arriving in the
   business account's activity.

## Afterwards

1. Refund the payment from the business account's activity. PayPal may keep its fixed fee.
2. Delete `.env.live` and the `data/live` folder.
3. Turn off or delete the live app in the developer dashboard if you won't use it again.
