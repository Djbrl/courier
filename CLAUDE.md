# Courier

Start with [docs/walkthrough.md](docs/walkthrough.md). Vocabulary is in [docs/architecture.md](docs/architecture.md#glossary).

## Commands

- `npm run demo`: run with simulated PayPal and separate data. Use this by default.
- `npm run check`: lint, types and all tests. Must pass before a commit.
- `npm run format`: apply formatting and safe lint fixes.

## Rules

- Tests run through `npm test`, which starts its own servers. Never point the e2e at a running dev or demo server.
- Money: sandbox and simulator only. A person approves sandbox payments and enters sandbox credentials themselves.
- Never print or commit `.env`. Reference environment variables by name.
- Limits are enforced in code and never delegated to a model. Agent-supplied text is untrusted.
- Merchants get a pairwise pseudonym only. Never add a name, email or PayPal ID to a token or a shop response.
- Write "PayPal" as a text lockup only (`#003087` and `#0070E0`). Never draw the PayPal logo mark.
- Interpolate through the `html` tag, which escapes by default. Use `raw()` only for trusted markup.

## Code

- Pages render on the server with `html` templates in `apps/courier/src/pages`; styles live in
  `packages/shared/assets/courier.css`.
- Product language is "errand" and "courier". Code and tokens say "visa" for the signed permission behind an errand.
- Match the surrounding code. Comments explain why, not what.
