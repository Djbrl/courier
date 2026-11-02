// The errand room: one running chat with your courier, and as many errands as you ask for. Each errand has its own budget,
// shown above the chat, where you can change it. Payments open PayPal (or the simulator) in a popup, and the shop's return
// page hands control back here.
(() => {
  const boot = JSON.parse(document.getElementById("boot").textContent);
  const C = boot.courier;
  const $ = (s, el = document) => el.querySelector(s);
  const log = $("#log");
  const input = $("#say");
  const sugs = $("#sugs");
  const tickets = $("#tickets");
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  const usd = (cents) => `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
  const AMOUNTS = ["$15", "$25", "$50", "$100"];

  let busy = false;
  let state = boot.state;
  const polls = new Map();
  /** Errands the chat has already announced. */
  const known = new Set();

  /* ---------------- api ---------------- */

  const url = (path) => `/errand/api/${path}${path.includes("?") ? "&" : "?"}c=${encodeURIComponent(C.id)}`;

  async function api(path, body) {
    const res = await fetch(url(path), {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Something went wrong (${res.status})`);
    return json;
  }

  /** Reads an answer line by line: steps as they happen, then the reply. */
  async function stream(path, body, onStep) {
    const res = await fetch(url(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error || `Something went wrong (${res.status})`);
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let held = "";
    let last = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      held += value;
      const lines = held.split("\n");
      held = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.step) onStep(msg.step);
        else last = msg;
      }
    }
    if (!last) throw new Error("The answer got cut off. Try again?");
    return last;
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

  // The chat survives moving around the app, and a full-page trip to PayPal when popups are blocked.
  const KEY = `courier:room:${C.id}`;
  function remember() {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ log: log.innerHTML, known: [...known] }));
    } catch {}
  }
  function recall() {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) || "null");
    } catch {
      return null;
    }
  }

  /** Links only to Courier and the shops: this text comes from a model that reads what shops say. */
  function rich(text) {
    const safe = (href) => {
      try {
        return boot.origins.includes(new URL(href).origin);
      } catch {
        return false;
      }
    };
    const link = (href, label) =>
      safe(href) ? `<a class="link" href="${href}" target="_blank" rel="noopener">${label}</a>` : label;
    return esc(text)
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/\*([^*\n]+)\*/g, "<i>$1</i>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_, label, href) => link(href, label))
      .replace(/(^|[\s(])(https?:\/\/[^\s)<]+)/g, (_, lead, href) => `${lead}${link(href, href)}`);
  }
  const say = (text) => add(rich(text), "bub");
  const me = (text) => add(esc(text), "bub me");
  const dim = (html) => add(html, "bub dim");

  function typing() {
    const el = add(`<i></i><i></i><i></i><span class="typing-t"></span>`, "typing");
    return {
      note: (text) => {
        $(".typing-t", el).textContent = text;
        scroll();
      },
      stop: () => el.remove(),
    };
  }

  const nameOf = (step) => step.data?.shop_name || step.args?.shop || "the shop";
  const NOTES = {
    search_shop: (s) => `Looking at ${nameOf(s)}…`,
    buy: (s) => `Checking out at ${nameOf(s)}…`,
    start_errand: () => "Writing the errand…",
  };

  /* ---------------- budgets ---------------- */

  function renderTickets(force = false) {
    // A budget being typed stays put when the courier answers in the meantime.
    if (!force && $(".tk-edit", tickets)) return;
    const rows = state.errands.map(
      (e) =>
        `<button type="button" class="tk" data-errand="${esc(e.id)}" aria-label="Change the budget for ${esc(e.what)}">
          <b>${esc(e.what)}</b><span>${e.spentCents ? `${usd(e.spentCents)} of ` : "up to "}${usd(e.limitCents)}</span><i aria-hidden="true">✎</i></button>`,
    );
    if (state.pendingBudgetCents)
      rows.push(
        `<button type="button" class="tk next" data-next="1" aria-label="Change your budget">
          <b>Budget</b><span>${usd(state.pendingBudgetCents)}</span><i aria-hidden="true">✎</i></button>`,
      );
    tickets.innerHTML = rows.join("");
    tickets.hidden = !rows.length;
  }

  function setState(next) {
    if (!next) return;
    state = next;
    for (const e of state.errands) {
      if (known.has(e.id)) continue;
      known.add(e.id);
      add(
        `<span class="tk-line"><b>New errand</b> ${esc(e.what)} · up to ${usd(e.limitCents)}</span>`,
        "tk-mark card-in",
      );
    }
    renderTickets();
  }

  tickets.addEventListener("click", (e) => {
    const chip = e.target.closest(".tk");
    if (!chip) return;
    const errand = chip.dataset.errand;
    const current = errand ? state.errands.find((x) => x.id === errand)?.limitCents : state.pendingBudgetCents;
    const form = document.createElement("form");
    form.className = "tk-edit";
    form.innerHTML = `<label>$<input type="number" min="1" max="500" step="1" required value="${Math.round(current / 100)}" aria-label="Budget in dollars"></label>
      <button class="btn sm" type="submit">Set</button>
      ${errand ? `<button class="link fine" type="button" data-call-back>Call back</button>` : ""}
      <button class="link fine" type="button" data-close>Cancel</button>
      <small class="tk-err" hidden></small>`;
    chip.replaceWith(form);
    const field = $("input", form);
    field.focus();
    field.select();
    form.addEventListener("click", async (ev) => {
      if (ev.target.closest("[data-close]")) renderTickets(true);
      if (ev.target.closest("[data-call-back]")) {
        form.remove();
        setState((await api("end", { errand })).state);
        say("I’m back. Nothing more can be spent on that errand.");
      }
    });
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      try {
        const { state: next } = await api("budget", { dollars: field.value, ...(errand ? { errand } : {}) });
        form.remove();
        setState(next);
      } catch (err) {
        const box = $(".tk-err", form);
        box.textContent = err.message;
        box.hidden = false;
      }
    });
  });

  /* ---------------- suggestions ---------------- */

  function showIdeas() {
    sugs.innerHTML = boot.ideas.map((i) => `<button type="button" data-say="${esc(i)}">${esc(i)}</button>`).join("");
    sugs.hidden = false;
  }
  function showAmounts() {
    sugs.innerHTML = AMOUNTS.map((a) => `<button type="button" class="amt" data-say="${a}">${a}</button>`).join("");
    sugs.hidden = false;
  }
  const hideSugs = () => {
    sugs.hidden = true;
  };

  /* ---------------- reading the courier's turn ---------------- */

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

  function handle(out) {
    if (out.error) dim(esc(out.error));
    setState(out.state);
    const steps = out.steps || [];
    const buy = [...steps].reverse().find((s) => s.tool === "buy");
    if (out.reply) say(clean(out.reply));
    if (buy) showBuy(buy);
    else if (out.needsBudget) return showAmounts();
    else {
      const found = [...steps].reverse().find((s) => s.tool === "search_shop" && s.data?.results?.length);
      if (found) itemCards(found);
    }
    if (!buy?.data?.approve_url) showIdeas();
  }

  function showBuy(step) {
    const d = step.data || {};
    if (d.approve_url) return payCard(d);
    if (d.status === "paid") return receipt(d);
    if (d.decision === "ask_human") return askCard(d, step);
    if (d.decision === "deny")
      return add(
        `<b>That’s over your budget.</b>${esc(d.reason || "It's outside your limits.")} Tap the budget above to change it. It’s checked in code, so no one can talk me past it.`,
        "nocard card-in",
      );
  }

  /* ---------------- cards ---------------- */

  const lines = (d) =>
    (d.items || [])
      .map((i) => `<div class="li"><span>${esc(i.title)}</span><span>$${esc(i.price)}</span></div>`)
      .join("");

  function itemCards(step) {
    const shop = step.data.shop_name;
    add(
      `<div class="items">${step.data.results
        .slice(0, 4)
        .map(
          (r) =>
            `<article class="item-c"><div><b>${esc(r.title)}</b><small>${esc(shop)}${r.artist && r.artist !== shop ? ` · ${esc(r.artist)}` : ""}</small></div>
            <span class="pr">$${esc(r.price)}</span>
            <button type="button" class="btn sm" data-say="Get ${esc(r.title)} from ${esc(shop)}">Get this</button></article>`,
        )
        .join("")}</div>`,
      "card-in",
    );
  }

  function payCard(d) {
    add(
      `<div class="paycard" data-order="${esc(d.order_id)}" data-shop="${esc(d.shop_slug)}">
        ${lines(d)}
        <div class="tot"><span>${esc(d.shop_name)}</span><b>$${esc(d.total)}</b></div>
        <div class="slot"><button type="button" class="btn-pp" data-pay="${esc(d.approve_url)}">Pay with ${boot.receiptParts.pp}</button></div>
        <p class="fine" style="margin-top:10px;text-align:center">${boot.paypal === "sandbox" ? "PayPal sandbox: log in with a sandbox buyer account." : "Simulated PayPal: no real money."}</p>
      </div>`,
      "card-in",
    );
  }

  log.addEventListener("click", (e) => {
    const pay = e.target.closest("[data-pay]");
    if (pay) {
      const card = pay.closest(".paycard");
      const target = pay.dataset.pay;
      const w = window.open(target, "courier-pay", "popup,width=520,height=780");
      $(".slot", card).innerHTML =
        `<div class="wait"><i></i>Waiting for PayPal…</div><p class="fine" style="text-align:center"><a class="link" href="${esc(target)}" target="courier-pay">Reopen the payment window</a></p>`;
      remember();
      if (!w)
        location.href = target; // popups blocked: pay in this tab; the shop sends you back here afterwards
      else watchOrder(card);
      return;
    }
    const answer = e.target.closest("[data-approval]");
    if (answer) {
      if (busy) return;
      const ok = answer.classList.contains("ap");
      answer.closest(".notif").dataset.v = ok ? "ok" : "no";
      answer.textContent = ok ? "Approved ✓" : "Denied";
      answer.parentElement.querySelectorAll("button").forEach((b) => (b.disabled = true));
      remember();
      turn(() => "approve", { approvalId: answer.dataset.approval, decision: ok ? "approved" : "denied" });
      return;
    }
    const pick = e.target.closest("[data-say]");
    if (pick) send(pick.dataset.say);
  });

  function askCard(d, step) {
    const items = (step.args.item_ids || []).join(", ");
    add(
      `<div class="notif cc" style="${C.vars}">
        <div class="nh">${boot.receiptParts.logo}</div>
        <div class="nwho">${boot.portrait}${esc(C.name)} asks</div>
        <div class="nq">${esc(items)}?</div>
        <div class="ns">${esc(d.reason || "It isn’t quite what you asked for.")}</div>
        <div class="acts"><button type="button" class="ap" data-approval="${esc(d.approval_id)}">Approve</button><button type="button" class="dn" data-approval="${esc(d.approval_id)}">Deny</button></div>
      </div>`,
      "card-in",
    );
  }

  function watchOrder(card) {
    const orderId = card.dataset.order;
    if (polls.has(orderId)) return;
    const started = Date.now();
    const check = async () => {
      try {
        const s = await api(`order/${encodeURIComponent(orderId)}?shop=${encodeURIComponent(card.dataset.shop)}`);
        setState(s.state);
        if (s.status === "paid") return settled(s);
        if (s.status === "cancelled") return settled(null);
      } catch {}
      if (Date.now() - started > 15 * 60 * 1000) stop();
    };
    const timer = setInterval(check, 2500);
    polls.set(orderId, { check });
    function stop() {
      clearInterval(timer);
      polls.delete(orderId);
    }
    function settled(order) {
      stop();
      if (!order) {
        $(".slot", card).innerHTML =
          `<p class="fine" style="text-align:center;font-weight:700">Cancelled. Nothing was charged.</p>`;
        remember();
        say("No problem, I’ve put it back. Your budget is untouched.");
        showIdeas();
        return;
      }
      $(".slot", card).innerHTML =
        `<p class="fine" style="text-align:center;font-weight:700;color:var(--green)">Paid ✓</p>`;
      remember();
      receipt(order);
      showIdeas();
    }
    return check;
  }

  window.addEventListener("message", (e) => {
    if (!boot.origins.includes(e.origin)) return;
    if (e.data?.type === "courier:payment") polls.get(e.data.orderId)?.check();
  });

  function receipt(d) {
    const P = boot.receiptParts;
    add(
      `<div class="lift"><div class="rcpt zz" role="group" aria-label="${esc(d.shop || "Shop")} receipt">
        <div class="rh"><b>${esc(d.shop)}</b><span class="mono">#${esc(String(d.order_id).slice(-6).toUpperCase())}</span></div>
        <div class="ritem">${esc((d.items || []).map((i) => i.title).join(", "))}</div>
        <div class="ramt"><b>$${esc(d.total)}</b><span>paid</span></div>
        <div class="ragent">${boot.portrait}<div><b>${esc(C.name)}</b><span class="mono">${esc(C.idNo)}</span></div></div>
        <div class="rwho">${P.avatar}<div><b>Sent by ${esc(boot.human)}</b><br>${P.verified}</div></div>
      </div></div>
      <div class="after">${d.receipt_url ? `<a class="btn sm" href="${esc(d.receipt_url)}" target="_blank" rel="noopener">Open the receipt ↗</a>` : ""}
        <a class="btn ghost sm" href="/app/errands">See your errands</a></div>`,
      "card-in",
    );
    say("All done. What’s next? Each new ask is its own errand, with its own budget.");
  }

  /* ---------------- turns ---------------- */

  async function turn(path, body) {
    busy = true;
    input.disabled = true;
    hideSugs();
    const dots = typing();
    try {
      const out = await stream(path(), body, (step) => {
        const note = NOTES[step.tool]?.(step);
        if (note) dots.note(note);
      });
      dots.stop();
      handle(out);
    } catch (e) {
      dots.stop();
      dim(`Hmm, that didn’t work: ${esc(e.message)}`);
      showIdeas();
    } finally {
      busy = false;
      input.disabled = false;
      input.focus();
    }
  }

  function send(text) {
    if (busy || !text.trim()) return;
    me(text);
    turn(() => "chat", { message: text });
  }

  $("#compose").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value;
    input.value = "";
    send(text);
  });
  document.querySelector(".rm-shops").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-say]");
    if (b) send(b.dataset.say);
  });
  sugs.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-say]");
    if (b) send(b.dataset.say);
  });
  $("#new-chat").addEventListener("click", async () => {
    if (busy) return;
    await api("reset", {}).catch(() => {});
    try {
      sessionStorage.removeItem(KEY);
    } catch {}
    location.reload();
  });

  /* ---------------- hello (or welcome back) ---------------- */

  const saved = recall();
  const returning = new URLSearchParams(location.search).get("order");
  if (saved?.log) {
    log.innerHTML = saved.log;
    for (const id of saved.known || []) known.add(id);
    // A card still waiting on PayPal keeps waiting, wherever the person went in between.
    log.querySelectorAll(".paycard[data-order]").forEach((card) => {
      if ($(".wait", card)) watchOrder(card);
    });
    scroll();
  } else {
    say(`Hey ${boot.human}! I’m ${C.name}, your courier. What can I get for you?`);
    for (const e of state.errands) known.add(e.id);
  }
  setState(state);
  if (state.awaiting) showAmounts();
  else showIdeas();
  if (returning) {
    history.replaceState(null, "", `${location.pathname}?c=${encodeURIComponent(C.id)}`);
    const card = log.querySelector(`.paycard[data-order="${CSS.escape(returning)}"]`);
    if (card) watchOrder(card)?.();
  }
  input.focus();
})();
