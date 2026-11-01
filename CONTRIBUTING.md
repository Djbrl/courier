# Contributing

## Set up

You need Node 24 or newer, because Courier stores data with the built-in `node:sqlite`.

```bash
npm install
npm run demo
```

No keys are required. Demo mode uses the built-in PayPal simulator and keeps its data in `data/demo`.

New here? [docs/walkthrough.md](docs/walkthrough.md) follows one purchase through the code in about 15 minutes.

## Make a change

1. Branch from `main`.
2. Make the change, and add a test if it changes behaviour.
3. Run `npm run check`.
4. Open a pull request saying what changed and why. Include screenshots for UI changes, at phone width too.

Keep each pull request to one change. Commit messages are short and imperative, like `Release holds when a visa expires`.

## Commands

| Command             | What it does                                                       |
| ------------------- | ------------------------------------------------------------------ |
| `npm run demo`      | Runs both apps with simulated PayPal                               |
| `npm run dev`       | Runs both apps with your `.env`, restarting on changes             |
| `npm run check`     | Lint, types and all tests; CI runs the same steps                  |
| `npm test`          | Unit tests, then the e2e and MCP client check on throwaway servers |
| `npm run test:unit` | Unit tests only                                                    |
| `npm run format`    | Applies formatting and safe lint fixes                             |
| `npm run preflight` | Checks your setup before a live test                               |
| `npm run keys`      | Prints a signing key, for hosts that lose their files on restart   |

## Where things go

| You're changing                | Look in                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| A page                         | `apps/courier/src/pages/` and `packages/shared/assets/courier.css`                            |
| A signed-in route              | `apps/courier/src/routes/app.ts`                                                              |
| OAuth or tokens                | `apps/courier/src/auth/`                                                                      |
| Limits, approvals or spending  | `apps/courier/src/visas.ts`                                                                   |
| What agents can do at the shop | `apps/store/src/mcp.ts`                                                                       |
| PayPal calls                   | `packages/shared/src/paypal.ts`, plus the simulator in `apps/courier/src/paypal-simulator.ts` |

A new PayPal call goes in the `PayPalGateway` interface and needs both implementations, so the demo and tests keep
working without credentials.

## Tests

- **Unit tests** in `tests/unit/` cover logic that doesn't need a server.
- **The e2e** in `tests/e2e.ts` acts as an MCP client and a person in a browser. New user-facing flows get a step here.
- **The MCP client check** in `tests/mcp-client.ts` connects with the official SDK, to prove we follow the spec.

`npm test` starts its own servers on ports 4300 and 4400 with data in `data/test-run`, so your demo data is safe.

Testing against the real PayPal sandbox is a manual run: see [docs/live-test.md](docs/live-test.md).

## Ground rules

- Sandbox and simulated money only.
- Never commit secrets. Add new settings to `.env.example` with a comment.
- Limits stay in code. A model can judge whether a purchase fits the purpose, but it never decides an amount.
- Courier never gives shops a person's name, email or PayPal ID.
- Write "PayPal" as a text lockup only. Don't draw the PayPal logo mark.

Security problems go through [SECURITY.md](SECURITY.md), not public issues.
