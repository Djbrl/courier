# Security

Courier is a prototype. It handles sandbox and simulated money only, and it should not be used with live PayPal
credentials.

## Reporting a problem

Please don't open a public issue. Use GitHub's
[private vulnerability reporting](https://github.com/Djbrl/courier/security/advisories/new), and include the steps to
reproduce it and what an attacker could do.

## What the design protects

| Guarantee                                         | Where it's enforced                                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Spending limits can't be talked around by a model | Plain code in `/internal/spend/check`, before any intent check                                     |
| A token works at one shop only                    | RFC 8707 audience, checked on every request                                                        |
| A call-back takes effect within seconds           | The shop checks live status as well as the token                                                   |
| Tokens and MCP calls never identify the person    | Tokens carry a per-shop pseudonym and a verified flag                                              |
| Saved PayPal never reaches the shop or agent      | Payment tokens stay in Courier, and are deleted when an errand is called back, reported or expires |
| Agent text can't issue commands                   | Notes reach the intent check as untrusted data, and the model never sets amounts                   |

`npm test` fires eight attacks at the real MCP endpoint on every run, covering forged, expired, revoked and
wrong-audience tokens, overspending and prompt injection.

## Known gaps

- Set long random values for `COURIER_SECRET` and `INTERNAL_SECRET` in production. The server warns only if the built-in
  development defaults are still in use.
- A PayPal payment shows the buyer to the shop's PayPal account, as any PayPal payment does.
- `/merchant` and its Report button have no login, because they're a demo view. A real shop would put them behind one.
- The shop's `/internal/*` calls share one secret, with no per-shop scoping, and Courier knows only the one demo shop.
- If PayPal fails to delete a saved payment token, the delete is logged but not retried.
- Deleting an account doesn't cancel a PayPal link the person already has open. If they pay it afterwards, the shop
  records the order and issues a receipt, and Courier has no account to add it to.
- Deleting an account erases Courier's live records, not any backups the operator keeps.
- Rate limiting is per process and in memory.
- SQLite storage is meant for one instance and is not encrypted at rest.
