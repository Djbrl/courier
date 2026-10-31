import assert from "node:assert/strict";
import { test } from "node:test";
import { isCourierName } from "../../packages/shared/src/courier.ts";
import { html, money, raw } from "../../packages/shared/src/html.ts";

test("courier names work like usernames", () => {
  for (const name of ["Juno", "otto-2", "Rémy"]) assert.equal(isCourierName(name), true, name);
  for (const name of ["J", "2fast", "-juno", "has space", "muchtoolongname"]) {
    assert.equal(isCourierName(name), false, name);
  }
});

test("html escapes interpolated values unless they are marked raw", () => {
  const payload = `<script>alert("x")</script>`;
  assert.equal(html`<p>${payload}</p>`.value, "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>");
  assert.equal(html`<p>${raw("<b>ok</b>")}</p>`.value, "<p><b>ok</b></p>");
});

test("money formats cents as dollars", () => {
  assert.equal(money(2900), "$29.00");
});
