// Starts Courier and the demo store together with prefixed logs.
// Usage: npm run dev            (watch mode)
//        npm start              (no watch)
import { spawn } from "node:child_process";

const watch = !process.argv.includes("--no-watch");
const apps = [
  { name: "courier ", color: "\x1b[33m", entry: "apps/courier/src/server.ts" },
  { name: "store   ", color: "\x1b[32m", entry: "apps/store/src/server.ts" },
];

const children = apps.map(({ name, color, entry }) => {
  const args = watch ? ["tsx", "watch", entry] : ["tsx", entry];
  const child = spawn("npx", args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --disable-warning=ExperimentalWarning`.trim(),
    },
  });
  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, out) =>
    stream.on("data", (chunk) => {
      for (const line of chunk.toString().split("\n")) if (line.trim()) out.write(`${prefix + line}\n`);
    });
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => {
    console.log(`${prefix}exited with code ${code}`);
    if (!watch) process.exit(code ?? 1);
  });
  return child;
});

const stop = () => {
  for (const c of children) c.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
