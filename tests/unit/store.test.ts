import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Set before loading configuration: the store opens its database inside DATA_DIR.
const dataDir = mkdtempSync(path.join(tmpdir(), "courier-store-"));
process.env.DATA_DIR = dataDir;
const { DocStore } = await import("../../packages/shared/src/store.ts");

const db = new DocStore("unit");
after(() => rmSync(dataDir, { recursive: true, force: true }));

test("documents round-trip through put, get and delete", () => {
  db.put("things", "a", { n: 1 });
  assert.deepEqual(db.get("things", "a"), { n: 1 });
  db.delete("things", "a");
  assert.equal(db.get("things", "a"), undefined);
});

test("list applies its limit after its filter", () => {
  db.put<{ owner: string }>("humans", "older", { owner: "maya" });
  db.put<{ owner: string }>("humans", "newer", { owner: "leo" });
  const found = db.list<{ owner: string }>("humans", (doc) => doc.owner === "maya", 1);
  assert.deepEqual(found, [{ owner: "maya" }]);
});
