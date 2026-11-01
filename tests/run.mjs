// Runs the e2e and the MCP SDK client check against a throwaway server pair, so tests never touch your demo or
// sandbox data: simulated PayPal, deterministic intent rules, ports 4300/4400, data in data/test-run (wiped first).
//
//   npm test
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

const COURIER_URL = "http://localhost:4300";
const STORE_URL = "http://localhost:4400";
const env = {
  ...process.env,
  PAYPAL_MODE: "simulated",
  INTENT_CHECK: "on",
  INTENT_MODEL: "rules",
  COURIER_PORT: "4300",
  STORE_PORT: "4400",
  COURIER_URL,
  STORE_URL,
  DATA_DIR: "data/test-run",
};

async function up(url) {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not come up`);
}

for (const url of [COURIER_URL, STORE_URL]) {
  const busy = await fetch(url).then(
    () => true,
    () => false,
  );
  if (busy) {
    console.error(`${url} is already in use. Stop whatever runs there first.`);
    process.exit(1);
  }
}

rmSync("data/test-run", { recursive: true, force: true });
const servers = spawn(process.execPath, ["scripts/dev.mjs", "--no-watch"], {
  env,
  stdio: ["ignore", "ignore", "inherit"],
  detached: true,
});
const stop = () => {
  try {
    process.kill(-servers.pid, "SIGTERM");
  } catch {}
};
process.on("exit", stop);

const run = (script) =>
  new Promise((resolve) => {
    const child = spawn("npx", ["tsx", script], { env, stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
  });

let code = 1;
try {
  await up(`${COURIER_URL}/healthz`);
  await up(STORE_URL);
  code = await run("tests/e2e.ts");
  if (code === 0) code = await run("tests/mcp-client.ts");
} catch (error) {
  console.error(error.message);
} finally {
  stop();
}
process.exit(code);
