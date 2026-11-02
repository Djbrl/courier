import assert from "node:assert/strict";
import { test } from "node:test";
import { budgetFromCourier, itemNamedIn, parseBudget } from "../../packages/shared/src/budget.ts";

test("a message that's only a budget", () => {
  for (const [said, dollars] of [
    ["$20", 20],
    ["20 dollars", 20],
    ["my budget is $40", 40],
    ["make it 35", 35],
    ["about $15.", 15],
    ["$12.50", 13],
    ["500$", 500],
    ["50 $", 50],
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
    ["socks under 20$", 20],
    ["flowers, $30 max", 30],
    ["a kettle for less than 50 dollars", 50],
  ] as const)
    assert.deepEqual(parseBudget(said), { dollars, only: false }, said);
});

test("a price or a count isn't a budget", () => {
  for (const said of ["Buy the $149 turntable", "about 3 records", "I have 2 cats", "a burger"])
    assert.equal(parseBudget(said), null, said);
});

test("a budget the courier proposes counts only if the person wrote that amount", () => {
  for (const [proposed, said] of [
    [500, "five hundred"],
    [45, "forty-five, I guess"],
    [250, "two hundred and fifty should do"],
    [100, "a hundred is fine"],
    [40, "let's go with 40 then"],
    [1200, "1,200"],
    [13, "12.50 tops"],
  ] as const)
    assert.equal(budgetFromCourier(proposed, said), proposed, said);
  for (const [proposed, said] of [
    [500, "a good novel"],
    [500, "fifty"],
    [50, "five hundred"],
    [20, "whatever you think is best"],
    ["40", "40"],
    [-40, "40"],
    [Number.NaN, "40"],
    [undefined, "40"],
  ] as const)
    assert.equal(budgetFromCourier(proposed, said), null, `${proposed} from ${said}`);
});

test("an item counts as named by any telling word of its title", () => {
  for (const [title, said] of [
    ["Skin-on Fries", "grab me fries and a crispy"],
    ["Crispy Chicken Burger", "grab me fries and a crispy"],
    ["The Lighthouse Ledger", "the lighthouse ledger for my mom"],
    ["Double Smash Burger", "Get Double Smash Burger from Floor Dash"],
  ])
    assert.equal(itemNamedIn(title as string, said as string), true, `${title} in ${said}`);
  for (const [title, said] of [
    ["Trail Runner Shoes", "grab me fries and a crispy"],
    ["Turntable", "yes"],
    ["The Lighthouse Ledger", "the one with the blue cover"],
  ])
    assert.equal(itemNamedIn(title as string, said as string), false, `${title} in ${said}`);
});
