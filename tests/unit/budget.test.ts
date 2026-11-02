import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBudget } from "../../packages/shared/src/budget.ts";

test("a message that's only a budget", () => {
  for (const [said, dollars] of [
    ["$20", 20],
    ["20 dollars", 20],
    ["my budget is $40", 40],
    ["make it 35", 35],
    ["about $15.", 15],
    ["$12.50", 13],
  ] as const)
    assert.deepEqual(parseBudget(said), { dollars, only: true }, said);
});

test("a bare number only counts when the courier just asked", () => {
  assert.equal(parseBudget("20"), null);
  assert.deepEqual(parseBudget("20", true), { dollars: 20, only: true });
});

test("a budget inside a request", () => {
  for (const [said, dollars] of [
    ["Get me a burger, I have about $15", 15],
    ["jazz records under $40", 40],
    ["socks, budget 25", 25],
    ["flowers, $30 max", 30],
    ["a kettle for less than 50 dollars", 50],
  ] as const)
    assert.deepEqual(parseBudget(said), { dollars, only: false }, said);
});

test("a price or a count isn't a budget", () => {
  for (const said of ["Buy the $149 turntable", "about 3 records", "I have 2 cats", "a burger"])
    assert.equal(parseBudget(said), null, said);
});
