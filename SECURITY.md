# Security

Courier is a prototype. It handles sandbox and simulated money only, and it should not be used with live PayPal
credentials.

## Reporting a problem

Please don't open a public issue. Use GitHub's
[private vulnerability reporting](https://github.com/Djbrl/courier/security/advisories/new), and include the steps to
reproduce it and what an attacker could do.

## What the design protects

| Guarantee                                         | Where it's enforced                                                                                   |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Spending limits can't be talked around by a model | Plain code in `/internal/spend/check`, before any intent check                                        |
| A token works at one shop only                    | RFC 8707 audience, checked on every request                                                           |
| A call-back takes effect within seconds           | The shop checks live status as well as the token                                                      |
| Tokens and MCP calls never identify the person    | Tokens carry a per-shop pseudonym and a verified flag                                                 |
| Saved PayPal never reaches the shop or agent      | Payment tokens stay in Courier, and are deleted when the person removes them or deletes their account |
| Agent text can't issue commands                   | Notes reach the intent check as untrusted data, and the model never sets amounts                      |

`npm test` fires eight attacks at the real MCP endpoint on every run, covering forged, expired, revoked and
wrong-audience tokens, overspending and prompt injection.

## Known gaps

- Set long random values for `COURIER_SECRET` and `INTERNAL_SECRET` in production. The server warns only if the built-in
  development defaults are still in use.
- A PayPal payment shows the buyer to the shop's PayPal account, as any PayPal payment does.
- `/merchant` and its Report button have no login, because they're a demo view. A real shop would put them behind one.
- The shop's `/internal/*` calls share one secret, with no per-shop scoping, and the shops are a fixed list in code.
- A saved PayPal lasts until the person removes it, so a bug in the limits could reach it after an errand has ended. Only
  an active errand can charge it, and only within that errand's budget.
- **Under the person's cap, Claude starts errands with no click, and the amount comes from the model.** With saved PayPal,
  a hijacked model can spend up to the cap: per errand and per rolling 24 hours, both set by the person and enforced in
  `withinCap` in `apps/courier/src/visas.ts`. Above the cap, or with no cap set, the person confirms. Putting 0 turns this off.
- A budget set in a chat dialog or the chat card reaches Courier through the shop, which Courier trusts over the shared
  internal secret. A real shop shouldn't be trusted to relay this.
- The card's budget tool is hidden from the model and needs a one-time pass sent only in the result's `_meta`. Both rely on
  the chat app keeping those from the model. An app that doesn't could let a hijacked model set its own budget, up to
  $500, on an account with saved PayPal.
- Purchases aren't checked against the errand's purpose unless `INTENT_CHECK=on`. A hijacked courier can buy anything at
  any shop inside the budget, so the budget is the real limit.
- Deleting an account doesn't cancel a PayPal link the person already has open. If they pay it afterwards, the shop
  records the order and issues a receipt, and Courier has no account to add it to.
- Deleting an account erases Courier's live records, not any backups the operator keeps.
- Rate limiting is per process and in memory.
- SQLite storage is meant for one instance and is not encrypted at rest.
