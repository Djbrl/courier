import assert from "node:assert/strict";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { trimmed } from "../../apps/courier/src/agent.ts";

test("a shortened conversation keeps no thinking, and a short one stays exactly as it was", () => {
  const turn = (i: number): Anthropic.Beta.BetaMessageParam[] => [
    { role: "user", content: `message ${i}` },
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: `reply ${i}` },
      ],
    },
    { role: "assistant", content: [{ type: "redacted_thinking", data: "x" }] },
  ];
  const short = Array.from({ length: 5 }, (_, i) => turn(i)).flat();
  assert.equal(trimmed(short), short);

  const long = trimmed(Array.from({ length: 40 }, (_, i) => turn(i)).flat());
  assert.ok(long.length <= 60);
  assert.equal(typeof long[0].content, "string");
  const blocks = long.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
  assert.ok(blocks.length);
  assert.ok(blocks.every((b) => b.type === "text"));
  assert.ok(long.every((m) => m.content?.length));
});
