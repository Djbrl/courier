// The errand room: chat with your courier on the left, the shop front on the right.
// Every action goes through the real flow: the courier's chat turn calls the shop's MCP tools with its visa token,
// payments open PayPal (or the simulator) in a popup, and the shop's return page hands control back here.
(() => {
  const boot = JSON.parse(document.getElementById("boot").textContent);
  const C = boot.courier;
  const $ = (s, el = document) => el.querySelector(s);
  const log = $("#log");
  const shelf = $("#shelf");
  const input = $("#say");
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  const usd = (cents) => `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
  const usd2 = (cents) => `$${(cents / 100).toFixed(2)}`;
  const firstIntent = boot.visa.intent;

  let catalog = [];
  let busy = false;
  const polls = new Map();

  /* ---------------- api ---------------- */

  async function api(path, body) {
    const sep = path.includes("?") ? "&" : "?";
    const res = await fetch(`/errand/api/${path}${sep}c=${encodeURIComponent(C.id)}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok)
      throw Object.assign(new Error(json.error || `Something went wrong (${res.status})`), { ended: json.ended });
    return json;
  }

  /* ---------------- chat log ---------------- */

  function scroll() {
    requestAnimationFrame(() => (log.scrollTop = log.scrollHeight));
  }
  function add(html, cls = "") {
    const el = document.createElement("div");
    if (cls) el.className = cls;
    el.innerHTML = html;
    log.appendChild(el);
    scroll();
    remember();
    return el;
  }

  // The transcript survives a full-page trip to PayPal (when popups are blocked) for this errand, in this tab.
  const KEY = `courier:errand:${boot.visa.id}`;
  function remember() {
    try {
      sessionStorage.setItem(
        KEY,
        JSON.stringify({ log: log.innerHTML, marks: [...marks].map(([id, c]) => [id, [...c]]) }),
      );
    } catch {}
  }
  function recall() {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) || "null");
    } catch {
      return null;
    }
  }
  const say = (text) => add(esc(text), "bub");
  const me = (text) => add(esc(text), "bub me");
  const dim = (html) => add(html, "bub dim");
  function typing() {
    const el = add("<i></i><i></i><i></i>", "typing");
    return () => el.remove();
  }
  function trace(steps) {
    const tools = steps.filter((s) => s.kind === "tool");
    if (!tools.length) return;
    add(
      tools
        .map(
          (s) =>
            `<span class="${s.ok ? "" : "bad"}" title="${esc(s.detail)}"><i></i>${esc(s.title.split("(")[0])} · ${s.ms}ms</span>`,
        )
        .join(""),
      "trace",
    );
  }
  function setSpent(visa) {
    if (visa) $("#spent").textContent = usd(visa.spentCents);
  }

  /* ---------------- reading the courier's steps ---------------- */

  function parse(step) {
    const name = step.title.split("(")[0];
    let args = {};
    try {
      args = JSON.parse(step.title.slice(name.length + 1, -1) || "{}");
    } catch {}
    return { name, args, data: step.data || {}, ok: step.ok, detail: step.detail || "" };
  }
  const itemById = (id) => catalog.find((i) => i.id === id);
  const _titleOf = (id) => itemById(id)?.title ?? id;

  function handle(out) {
    trace(out.steps || []);
    setSpent(out.visa);
    const calls = (out.steps || []).filter((s) => s.kind === "tool").map(parse);
    for (const c of calls) {
      if (c.name === "search_catalog") (c.data.results || []).forEach((r) => mark(r.id, "seen"));
      if (c.name === "get_item" && c.data.id) mark(c.data.id, "seen");
    }
    const checkout = [...calls].reverse().find((c) => c.name === "request_purchase");
    const who = calls.find((c) => c.name === "whoami");
    if (checkout) return showCheckout(checkout);
    if (who) return showWhoami(who.data);
    const search = calls.find((c) => c.name === "search_catalog");
    if (search && !(search.data.results || []).length)
      return say(`I couldn’t find that at ${boot.storeName}. Try something else?`);
    say(clean(out.reply));
  }

  /** The tools speak to the agent; strip the links and instructions meant for it. */
  function clean(text) {
    return String(text || "")
      .replace(
        /\s*(Approve the payment here|Send the user this link to approve or decline|Ask the user to approve the payment here):?\s*https?:\/\/\S+/gi,
        "",
      )
      .replace(/\s*After they decide[^\n]*/g, "")
      .replace(/\s*Then call order_status[^\n]*/g, "")
      .trim();
  }

  function showCheckout(c) {
    const ids = c.args.item_ids || [];
    const items = ids.map(itemById).filter(Boolean);
    const list = items.map((i) => i.title).join(" and ") || "that";
    const d = c.data;
    if (d.approve_url) {
      ids.forEach((id) => mark(id, "bag"));
      const total = Math.round(Number(d.total) * 100);
      say(
        c.args.approval_id
          ? `You said yes, so: ${list}, ${usd(total)}. Ready when you are.`
          : `Found it: ${list}, ${usd(total)}. It fits “${firstIntent || "your errand"}”, so it just needs your OK to pay.`,
      );
      payCard(d.order_id, d.approve_url, items, total);
      return;
    }
    if (d.decision === "ask_human") {
      ids.forEach((id) => mark(id, "bag"));
      say(`${list} isn’t quite what you asked for, so I’m checking with you first.`);
      askCard(d.approval_id, items, friendly(d.reason));
      return;
    }
    if (d.decision === "deny") {
      add(
        `<b>I can’t buy ${esc(list)}.</b>${esc(d.reason || "It's outside your limits.")} Your limits are checked in code, so no one can talk me past them.`,
        "nocard card-in",
      );
      return;
    }
    say(clean(c.detail) || "That didn’t work.");
  }

  /** The intent check explains itself to the merchant; say it the way a courier would. */
  function friendly(reason) {
    if (/obviously matches|Some items match/.test(reason || ""))
      return firstIntent ? `Not on your list: “${firstIntent}”.` : "Not on your list.";
    if (/remaining budget/i.test(reason || "")) return "Uses most of what’s left.";
    return reason;
  }

  function showWhoami(v) {
    const visa = v.visa || {};
    const scopes = (v.scopes || []).map(
      (s) => ({ "store:browse": "browse", "store:reserve": "reserve", "store:buy": "buy" })[s] || s,
    );
    const until = visa.expires_at
      ? new Date(visa.expires_at).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })
      : "later";
    say(
      `At ${boot.storeName} I can ${scopes.join(", ").replace(/, ([^,]*)$/, " and $1")}. Up to $${Number(visa.spend_limit?.value || 0).toFixed(0)} in total and $${Number(visa.per_purchase_limit?.value || 0).toFixed(0)} per item, until ${until}.` +
        (visa.intent ? ` For: “${visa.intent}”.` : "") +
        `\nThe shop sees a verified person (${String(v.sent_by?.pseudonym || "").slice(0, 10)}…), never your name.`,
    );
  }

  /* ---------------- cards ---------------- */

  function payCard(orderId, url, items, totalCents) {
    const el = add(
      `<div class="paycard" data-order="${esc(orderId)}" data-items="${esc(JSON.stringify(items.map((i) => i.id)))}" data-total="${totalCents}">
        ${items.map((i) => `<div class="li"><span>${esc(i.title)}</span><span>${usd2(i.priceCents)}</span></div>`).join("")}
        <div class="tot"><span>${esc(boot.storeName)}</span><b>${usd2(totalCents)}</b></div>
        <div class="slot"><button type="button" class="btn-pp">Pay with ${boot.receiptParts.pp}</button></div>
        <p class="fine" style="margin-top:10px;text-align:center">${boot.paypal === "sandbox" ? "PayPal sandbox: log in with a sandbox buyer account." : "Simulated PayPal: no real money."}</p>
      </div>`,
      "card-in",
    );
    const slot = $(".slot", el);
    slot.querySelector("button").addEventListener("click", () => {
      const w = window.open(url, "courier-pay", "popup,width=520,height=780");
      slot.innerHTML = `<div class="wait"><i></i>Waiting for PayPal…</div><p class="fine" style="text-align:center"><a class="link" href="${esc(url)}" target="courier-pay">Reopen the payment window</a></p>`;
      remember();
      if (!w) {
        location.href = url; // popups blocked: pay in this tab; the shop sends you back here afterwards
        return;
      }
      watchOrder(orderId, el, items, totalCents);
    });
  }

  function askCard(approvalId, items, reason) {
    const what = items.map((i) => i.title).join(", ");
    const total = items.reduce((s, i) => s + i.priceCents, 0);
    const el = add(
      `<div class="notif cc" style="${C.vars}">
        <div class="nh">${boot.receiptParts.logo}</div>
        <div class="nwho">${boot.portrait}${esc(C.name)} asks</div>
        <div class="nq">${esc(what)}, ${usd(total)}?</div>
        <div class="ns">${esc(reason || "Not on your list.")}</div>
        <div class="acts"><button type="button" class="ap">Approve</button><button type="button" class="dn">Deny</button></div>
      </div>`,
      "card-in",
    );
    const box = $(".notif", el);
    el.querySelectorAll(".acts button").forEach((b) =>
      b.addEventListener("click", async () => {
        if (busy) return;
        const ok = b.classList.contains("ap");
        box.dataset.v = ok ? "ok" : "no";
        b.textContent = ok ? "Approved ✓" : "Denied";
        el.querySelectorAll(".acts button").forEach((x) => (x.disabled = true));
        if (!ok) items.forEach((i) => unmark(i.id, "bag"));
        await turn(() => api("approve", { approvalId, decision: ok ? "approved" : "denied" }));
      }),
    );
  }

  function watchOrder(orderId, el, items, totalCents) {
    if (polls.has(orderId)) return;
    const started = Date.now();
    const check = async () => {
      try {
        const s = await api(`order/${encodeURIComponent(orderId)}`);
        setSpent(s.visa);
        if (s.status === "paid") return done(true);
        if (s.status === "cancelled") return done(false);
      } catch {}
      if (Date.now() - started > 15 * 60 * 1000) return stop();
    };
    const timer = setInterval(check, 2500);
    polls.set(orderId, { check, timer });
    function stop() {
      clearInterval(timer);
      polls.delete(orderId);
    }
    function done(paid) {
      stop();
      if (!paid) {
        $(".slot", el).innerHTML =
          `<p class="fine" style="text-align:center;font-weight:700">Cancelled. Nothing was charged.</p>`;
        remember();
        say("No problem, I’ve put it back. Your budget is untouched.");
        items.forEach((i) => unmark(i.id, "bag"));
        return;
      }
      $(".slot", el).innerHTML =
        `<p class="fine" style="text-align:center;font-weight:700;color:var(--green)">Paid ✓</p>`;
      remember();
      items.forEach((i) => {
        unmark(i.id, "bag");
        mark(i.id, "sold");
      });
      say(`Done! ${items.map((i) => i.title).join(" and ")} is paid. Here’s the receipt the shop got:`);
      receipt(orderId, items, totalCents);
    }
  }

  window.addEventListener("message", (e) => {
    if (e.origin !== new URL(boot.storeUrl).origin) return;
    if (e.data?.type === "courier:payment") polls.get(e.data.orderId)?.check();
  });

  function receipt(orderId, items, totalCents) {
    const P = boot.receiptParts;
    add(
      `<div class="lift"><div class="rcpt zz" role="group" aria-label="${esc(boot.storeName)} receipt">
        <div class="rh"><b>${esc(boot.storeName)}</b><span class="mono">#${esc(orderId.slice(-6).toUpperCase())}</span></div>
        <div class="ritem" style="margin-top:1.2em;font-size:1.6em;font-weight:600;color:var(--soft)">${esc(items.map((i) => i.title).join(", "))}</div>
        <div class="ramt" style="margin-top:.6em"><b>${usd2(totalCents)}</b><span>paid</span></div>
        <div class="ragent">${boot.portrait}<div><b>${esc(C.name)}</b><span class="mono">${esc(C.idNo)}</span></div></div>
        <div class="rwho">${P.avatar}<div><b>Sent by ${esc(boot.human)}</b><br>${P.verified}</div></div>
      </div></div>
      <div class="after"><a class="btn sm" href="/app/errands?e=${esc(boot.visa.id)}">See it in Courier<span class="go"><svg><use href="#arr"/></svg></span></a>
        <a class="btn ghost sm" href="${esc(boot.storeUrl)}/merchant" target="_blank" rel="noopener">What the shop sees ↗</a></div>`,
      "card-in",
    );
  }

  /* ---------------- turns ---------------- */

  async function turn(run) {
    busy = true;
    input.disabled = true;
    const stop = typing();
    try {
      const out = await run();
      stop();
      handle(out);
    } catch (e) {
      stop();
      if (e.ended) {
        dim(`${esc(e.message)} <a class="link" href="/app">Courier home</a>`);
        $("#compose").remove();
        $("#sugs").remove();
      } else dim(`Hmm, that didn’t work: ${esc(e.message)}`);
    } finally {
      busy = false;
      if (document.body.contains(input)) {
        input.disabled = false;
        input.focus();
      }
    }
  }

  function send(text, visible = text) {
    if (busy || !text.trim()) return;
    me(visible);
    turn(() => api("chat", { message: text }));
  }

  $("#compose").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value;
    input.value = "";
    send(text);
  });
  $("#sugs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-say]");
    if (b) send(b.dataset.say);
  });

  /* ---------------- the shop front ---------------- */

  function cover(i) {
    const kind = i.category;
    const disc =
      kind === "vinyl" || kind === "turntable"
        ? `<circle cx="66" cy="50" r="30" fill="#141414"/><circle cx="66" cy="50" r="22" fill="none" stroke="#2E2E2E" stroke-width="1"/><circle cx="66" cy="50" r="9" fill="hsl(${i.hue} 90% 70%)"/><circle cx="66" cy="50" r="1.6" fill="#F2EFE9"/>`
        : kind === "cassette"
          ? `<rect x="22" y="30" width="56" height="38" rx="5" fill="#141414"/><circle cx="38" cy="49" r="6" fill="#F2EFE9"/><circle cx="62" cy="49" r="6" fill="#F2EFE9"/>`
          : kind === "cd"
            ? `<circle cx="50" cy="50" r="28" fill="#E8E6E1"/><circle cx="50" cy="50" r="8" fill="hsl(${i.hue} 55% 46%)"/>`
            : `<rect x="28" y="28" width="44" height="44" rx="12" fill="#141414" opacity=".85"/><circle cx="50" cy="50" r="10" fill="hsl(${i.hue} 90% 70%)"/>`;
    const sleeve =
      kind === "vinyl"
        ? `<rect x="10" y="20" width="60" height="60" rx="3" fill="hsl(${i.hue} 60% 38%)"/><circle cx="40" cy="50" r="14" fill="hsl(${(i.hue + 40) % 360} 90% 72%)" opacity=".9"/>`
        : "";
    return `<svg viewBox="0 0 100 100" aria-hidden="true">${kind === "vinyl" ? disc + sleeve : disc}</svg>`;
  }

  const FILTERS = ["all", "vinyl", "cassette", "cd", "accessory", "turntable", "merch"];
  let filter = "all";
  function renderShelf() {
    const items = catalog.filter((i) => filter === "all" || i.category === filter);
    shelf.innerHTML = items
      .map(
        (i) => `<article class="itm" data-id="${esc(i.id)}" style="--h:${i.hue}">
          <span class="flag">${boot.portrait}<span class="ft">${esc(C.name)} looked</span></span>
          <div class="cv">${cover(i)}</div>
          <h4>${esc(i.title)}</h4><p>${esc(i.artist)}</p>
          <div class="row2"><span class="pr">${usd2(i.priceCents)}</span><button type="button" class="askj" data-id="${esc(i.id)}">Ask ${esc(C.name)}</button></div>
        </article>`,
      )
      .join("");
    for (const [id, cls] of marks) for (const c of cls) mark(id, c, true);
  }
  $("#filters").innerHTML = FILTERS.map(
    (f) =>
      `<button type="button" data-f="${f}" aria-pressed="${f === filter}">${{ all: "Everything", cd: "CDs", accessory: "Accessories", merch: "Merch" }[f] ?? `${f}s`}</button>`,
  ).join("");
  $("#filters").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-f]");
    if (!b) return;
    filter = b.dataset.f;
    $("#filters")
      .querySelectorAll("button")
      .forEach((x) => x.setAttribute("aria-pressed", x === b));
    renderShelf();
  });
  shelf.addEventListener("click", (e) => {
    const b = e.target.closest(".askj");
    if (!b) return;
    const i = itemById(b.dataset.id);
    send(`Get ${i.title} (${i.id})`, `Get me ${i.title}`);
  });

  const marks = new Map();
  function mark(id, cls, quiet) {
    if (!quiet) {
      marks.set(id, new Set([...(marks.get(id) || []), cls]));
      remember();
    }
    const el = shelf.querySelector(`.itm[data-id="${CSS.escape(id)}"]`);
    if (!el) return;
    el.classList.add(cls);
    const ft = el.querySelector(".flag .ft");
    if (ft)
      ft.textContent = el.classList.contains("sold")
        ? "Bought"
        : el.classList.contains("bag")
          ? `In ${C.name}’s bag`
          : `${C.name} looked`;
    if (cls === "bag" && !quiet) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function unmark(id, cls) {
    marks.get(id)?.delete(cls);
    remember();
    shelf.querySelector(`.itm[data-id="${CSS.escape(id)}"]`)?.classList.remove(cls);
  }

  const catalogReady = fetch(`${boot.storeUrl}/catalog.json`)
    .then((r) => r.json())
    .then((j) => {
      catalog = j.items;
      renderShelf();
    })
    .catch(
      () =>
        (shelf.innerHTML = `<p class="fine">The shop front didn’t load. ${esc(C.name)} can still shop through the fast lane.</p>`),
    );

  /* ---------------- hello (or welcome back) ---------------- */

  const saved = recall();
  const returning = new URLSearchParams(location.search).get("order");
  if (saved?.log) {
    log.innerHTML = saved.log;
    // Earlier cards are history now; only a payment we're coming back from stays live.
    log.querySelectorAll("button").forEach((b) => (b.disabled = true));
    for (const [id, cls] of saved.marks || []) marks.set(id, new Set(cls));
    scroll();
  } else {
    say(
      `Hi ${boot.human}! I’m ${C.name}, out on your errand at ${boot.storeName}` +
        (firstIntent ? `: “${firstIntent}”.` : ".") +
        ` Up to ${usd(boot.visa.spendLimitCents)} in total and ${usd(boot.visa.perPurchaseLimitCents)} per item. What should I get?`,
    );
    dim(`Pick a suggestion, type anything, or tap <b>Ask ${esc(C.name)}</b> on something in the shop.`);
  }
  if (returning) {
    history.replaceState(null, "", location.pathname);
    const card = log.querySelector(`.paycard[data-order="${CSS.escape(returning)}"]`)?.parentElement;
    if (card) {
      const ids = JSON.parse(card.querySelector(".paycard").dataset.items || "[]");
      const total = Number(card.querySelector(".paycard").dataset.total);
      const items = () => ids.map((id) => itemById(id) || { id, title: id, priceCents: 0 });
      catalogReady.then(() => watchOrder(returning, card, items(), total)).then(() => polls.get(returning)?.check());
    }
  }
  api("state")
    .then((s) => setSpent(s.visa))
    .catch(() => {});
  input.focus();
})();
