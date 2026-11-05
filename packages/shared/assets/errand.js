// The errand room: a window onto chats that run on the server. Each chat holds an errand with its own budget. Several can run
// at once, so the page asks what's new and redraws, and nothing is lost by leaving. Payments open PayPal (or the simulator)
// in a popup, and the shop's return page hands control back here.
(() => {
  const boot = JSON.parse(document.getElementById("boot").textContent);
  const C = boot.courier;
  const $ = (s, el = document) => el.querySelector(s);
  const log = $("#log");
  const input = $("#say");
  const sugs = $("#sugs");
  const tabs = $("#tickets");
  const bar = $("#budget");
  const runBox = $("#run");
  const inviteBox = $("#invites");
  const runBody = $(".run-body", runBox);
  const room = $(".rm");
  const toast = $("#toast");
  /** On a phone the room is three tabs; on a wide screen everything is in view at once. */
  const narrow = matchMedia("(max-width: 900px)");
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  const usd = (cents) => `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;

  let chat = boot.chat;
  let list = boot.list;
  let invites = boot.invites || [];
  let left = boot.left;
  let drawn = -1;
  /** Orders with their PayPal window open, and the chat each belongs to. */
  const paying = new Map();

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

  /* ---------------- pictures ---------------- */

  // Mockups, one for each kind of thing. Nothing here is a real product photo.
  const SHAPES = {
    vinyl:
      '<circle cx="24" cy="24" r="15" fill="#141414"/><circle cx="24" cy="24" r="10" fill="none" stroke="#fff" stroke-opacity=".25"/><circle cx="24" cy="24" r="5" fill="#fff"/><circle cx="24" cy="24" r="1.4" fill="#141414"/>',
    cd: '<circle cx="24" cy="24" r="15" fill="#fff"/><path d="M24 9a15 15 0 0 1 13 7.500L24 24z" fill="#fff" fill-opacity=".5"/><circle cx="24" cy="24" r="4" fill="#141414"/>',
    cassette:
      '<rect x="9" y="14" width="30" height="20" rx="3" fill="#fff"/><circle cx="18" cy="24" r="3" fill="#141414"/><circle cx="30" cy="24" r="3" fill="#141414"/>',
    turntable:
      '<rect x="8" y="12" width="32" height="24" rx="3" fill="#fff"/><circle cx="21" cy="24" r="8" fill="#141414"/><path d="M35 15l-5 12" stroke="#141414" stroke-width="2" stroke-linecap="round"/>',
    accessory:
      '<rect x="12" y="12" width="24" height="24" rx="6" fill="#fff"/><circle cx="24" cy="24" r="5" fill="#141414"/>',
    merch: '<path d="M16 11l-8 6 4 6 3-2v16h18V21l3 2 4-6-8-6c-1 3-3 4-8 4s-7-1-8-4z" fill="#fff"/>',
    apparel: '<path d="M16 11l-8 6 4 6 3-2v16h18V21l3 2 4-6-8-6c-1 3-3 4-8 4s-7-1-8-4z" fill="#fff"/>',
    book: '<path d="M13 10h20a2 2 0 0 1 2 2v26H15a2 2 0 0 1-2-2z" fill="#fff"/><path d="M13 34a2 2 0 0 1 2-2h20" fill="none" stroke="#141414" stroke-width="1.6"/><path d="M19 16h10M19 21h7" stroke="#141414" stroke-width="2" stroke-linecap="round"/>',
    gadget:
      '<rect x="15" y="8" width="18" height="32" rx="4" fill="#fff"/><rect x="18" y="12" width="12" height="20" rx="1" fill="#141414"/><circle cx="24" cy="36" r="1.600" fill="#141414"/>',
    home: '<path d="M20 22h8l2 16H18z" fill="#fff"/><path d="M24 22V13M24 16c-5 0-7-3-7-6 4 0 7 2 7 6zM24 18c4 0 7-2 7-6-4 0-7 2-7 6z" stroke="#fff" stroke-width="1.600" fill="#fff"/>',
    food: '<path d="M10 22c0-7 6-11 14-11s14 4 14 11z" fill="#fff"/><rect x="9" y="24" width="30" height="4" rx="2" fill="#141414"/><path d="M10 30h28v2a5 5 0 0 1-5 5H15a5 5 0 0 1-5-5z" fill="#fff"/>',
    flowers:
      '<path d="M24 26v14" stroke="#fff" stroke-width="2.500" stroke-linecap="round"/><g fill="#fff"><circle cx="24" cy="12" r="5"/><circle cx="16" cy="19" r="5"/><circle cx="32" cy="19" r="5"/><circle cx="19" cy="27" r="5"/><circle cx="29" cy="27" r="5"/></g><circle cx="24" cy="20" r="4" fill="#141414"/>',
    shoes:
      '<path d="M7 28c0-3 1-8 3-10 3 3 7 3 10 1l7 7c3 2 8 2 11 3 2 1 3 3 3 5H7z" fill="#fff"/><path d="M7 34h34" stroke="#141414" stroke-width="2"/>',
    skin: '<rect x="17" y="17" width="14" height="22" rx="3" fill="#fff"/><rect x="20" y="9" width="8" height="8" rx="1" fill="#fff"/><circle cx="24" cy="28" r="3" fill="#141414"/>',
    pass: '<rect x="8" y="14" width="32" height="20" rx="4" fill="#fff"/><path d="M14 21h12M14 27h8" stroke="#141414" stroke-width="2" stroke-linecap="round"/>',
    currency:
      '<circle cx="24" cy="24" r="14" fill="#fff"/><circle cx="24" cy="24" r="9" fill="none" stroke="#141414" stroke-width="1.600"/>',
  };
  const BOX =
    '<path d="M24 9l14 7v16l-14 7-14-7V16z" fill="#fff"/><path d="M10 16l14 7 14-7M24 23v16" fill="none" stroke="#141414" stroke-width="1.600"/>';
  function thumb(item) {
    const hue = Number(item?.hue) || 0;
    return `<span class="thumb" style="--h:${hue}" aria-hidden="true"><svg viewBox="0 0 48 48">${SHAPES[item?.category] || BOX}</svg></span>`;
  }

  /* ---------------- drawing a chat ---------------- */

  /** Links only to Courier and the shops: this text comes from a model that reads what shops say. */
  function rich(text) {
    const safe = (href) => {
      try {
        return boot.origins.includes(new URL(href).origin);
      } catch {
        return false;
      }
    };
    const link = (href, label) => (safe(href) ? `<a class="link" href="${href}">${label}</a>` : label);
    return esc(text)
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/\*([^*\n]+)\*/g, "<i>$1</i>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_, label, href) => link(href, label))
      .replace(/(^|[\s(])(https?:\/\/[^\s)<]+)/g, (_, lead, href) => `${lead}${link(href, href)}`);
  }

  const lines = (items) =>
    (items || [])
      .map(
        (i) =>
          `<div class="li li-t">${thumb(i)}<span>${esc(i.title)}${i.artist ? `<small>${esc(i.artist)}</small>` : ""}</span><span>$${esc(i.price)}</span></div>`,
      )
      .join("");

  const clock = (until) => {
    const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  };

  function payCard(e) {
    // Once it's settled, the card has done its job: a paid one gives way to its ticket.
    if (e.status === "paid") return "";
    if (e.status !== "open")
      return `<div class="tick off"><span class="tick-b"><b>${esc(e.shop_name)}</b><small>${e.status === "called_back" ? "Called back" : "Cancelled"}. Nothing was charged.</small></span></div>`;
    const slot = paying.has(e.order_id)
      ? `<div class="wait"><i></i>Waiting for PayPal…</div><p class="fine" style="text-align:center"><a class="link" href="${esc(e.approve_url)}" target="courier-pay">Reopen the payment window</a></p>`
      : `<button type="button" class="btn-pp" data-pay="${esc(e.approve_url)}" data-order="${esc(e.order_id)}">Pay with ${boot.receiptParts.pp}</button>`;
    const canCallBack = e.callBackUntil > Date.now();
    return `<div class="paycard" data-card="${esc(e.order_id)}">
        ${lines(e.items)}
        <div class="tot"><span>${esc(e.shop_name)}</span><b>$${esc(e.total)}</b></div>
        <div class="slot">${slot}</div>
        ${`<p class="fine pay-foot">${canCallBack ? `<button type="button" class="link fine" data-callback="${esc(e.order_id)}" data-until="${e.callBackUntil}">Call back · <span>${clock(e.callBackUntil)}</span></button><br>` : ""}${boot.paypal === "live" ? "Live PayPal: real money." : boot.paypal === "sandbox" ? "PayPal sandbox: log in with a sandbox buyer account." : "Simulated PayPal: no real money."}</p>`}
      </div>`;
  }

  /** A paid purchase: small enough to stack, with the full receipt a click away. */
  function receipt(e) {
    const items = e.items || [];
    return `<div class="tick" role="group" aria-label="${esc(e.shop)} receipt, $${esc(e.total)} paid">
        <span class="tick-th">${items.slice(0, 3).map(thumb).join("")}</span>
        <span class="tick-b"><b>${esc(e.shop)}</b><small>${esc(items.map((i) => i.title).join(", "))}</small></span>
        <span class="tick-r"><b>$${esc(e.total)}</b>${e.receipt_url ? `<a class="link fine" href="${esc(e.receipt_url)}" target="_blank" rel="noopener">Receipt ↗</a>` : "<small>Paid</small>"}</span>
      </div>`;
  }

  /** One item, several people: who paid what, each with their own PayPal. */
  function groupTicket(e) {
    const all = e.payers.every((p) => p.paid);
    const who = e.payers
      .map(
        (p) =>
          `<span class="${p.paid ? "" : "no"}" title="${p.you ? "You" : `${esc(p.name)}, through ${esc(p.courier)}`}"><b>${esc(p.name)}</b> ${usd(p.cents)}</span>`,
      )
      .join("");
    return `<div class="tick grp" role="group" aria-label="${esc(e.shop)}, $${esc(e.total)} split between ${e.payers.length} people">
        <span class="tick-th">${thumb(e.item)}</span>
        <span class="tick-b"><b>${esc(e.shop)} · split ${e.payers.length} ways</b><small>${esc(e.item?.title)}</small><span class="tick-who">${who}</span></span>
        <span class="tick-r"><b>$${esc(e.total)}</b><small class="${all ? "" : "no"}">${all ? "All paid" : "Not complete"}</small></span>
      </div>`;
  }

  const DRAW = {
    me: (e) => `<div class="bub me">${esc(e.text)}</div>`,
    say: (e) => `<div class="bub">${rich(e.text)}</div>`,
    dim: (e) => `<div class="bub dim">${esc(e.text)}</div>`,
    new: (e) =>
      `<div class="tk-mark"><span class="tk-line"><b>New errand</b> ${esc(e.what)} · up to ${usd(e.limitCents)}</span></div>`,
    items: (e) =>
      `<div class="items">${e.results
        .map(
          (r) =>
            `<article class="item-c">${thumb(r)}<div><b>${esc(r.title)}</b><small>${esc(e.shop)}${r.artist && r.artist !== e.shop ? ` · ${esc(r.artist)}` : ""}</small></div>
            <span class="pr">$${esc(r.price)}</span>
            <button type="button" class="btn sm" data-say="Get ${esc(r.title)} from ${esc(e.shop)}">Get this</button></article>`,
        )
        .join("")}</div>`,
    pay: payCard,
    receipt,
    group: groupTicket,
    ask: (e) =>
      `<div class="notif cc" style="${C.vars}" ${e.answered ? `data-v="${esc(e.answered)}"` : ""}>
        <div class="nh">${boot.receiptParts.logo}</div>
        <div class="nwho">${boot.portrait}${esc(C.name)} asks</div>
        <div class="nq">${esc(e.items.join(", "))}?</div>
        <div class="ns">${esc(e.reason || "It isn’t quite what you asked for.")}</div>
        <div class="acts"><button type="button" class="ap" data-approval="${esc(e.approval_id)}" ${e.answered ? "disabled" : ""}>${e.answered === "ok" ? "Approved ✓" : "Approve"}</button><button type="button" class="dn" data-approval="${esc(e.approval_id)}" ${e.answered ? "disabled" : ""}>${e.answered === "no" ? "Denied" : "Deny"}</button></div>
      </div>`,
    invite: (e) =>
      `<div class="invite"><b>Invite link</b><small>${esc(e.what)}${e.shop && !e.what.includes(e.shop) ? ` · ${esc(e.shop)}` : ""}</small>
        <div class="invite-l"><code class="inp code sm">${esc(e.url)}</code><button type="button" class="btn sm" data-copy="${esc(e.url)}">Copy</button></div>
        <p class="fine">Send it to anyone. They sign in with their own PayPal, or as a demo person, and their courier joins this chat.</p></div>`,
    run: (e) => `<div class="tk-mark run-mark"><span class="tk-line">${esc(e.text)}</span></div>`,
    ended: (e) => `<div class="tk-mark end-mark"><span class="tk-line"><b>Ended</b> ${esc(e.text)}</span></div>`,
    // The amount comes from the courier; only the person's yes, here or in words, makes it the budget.
    offer: (e) =>
      `<div class="offer ${e.answered ? "done" : ""}"><span><b>${e.change ? "Change the budget to" : "Budget"} $${esc(e.dollars)}</b><small>${e.cents !== e.dollars * 100 ? `Covers ${usd(e.cents)}. ` : ""}${esc(e.what)}</small></span>${
        e.answered
          ? `<span class="st">${e.answered === "ok" ? "Set ✓" : "Not set"}</span>`
          : `<button type="button" class="btn sm" data-say="Yes, $${esc(e.dollars)}">Set $${esc(e.dollars)}</button>`
      }</div>`,
    no: (e) =>
      `<div class="nocard"><b>That’s over your budget.</b>${esc(e.reason)} Change the budget above, and I’ll try again. It’s checked in code, so no one can talk me past it.</div>`,
  };

  function typing() {
    return `<div class="typing"><i></i><i></i><i></i><span class="typing-t">${esc(chat.note)}</span></div>`;
  }

  function drawLog() {
    const hello = `<div class="bub">${rich(boot.welcome)}</div>`;
    const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
    const grew = drawn !== chat.id;
    log.innerHTML = hello + chat.events.map((e) => DRAW[e.t]?.(e) ?? "").join("") + (chat.working ? typing() : "");
    if (atEnd || grew) requestAnimationFrame(() => (log.scrollTop = log.scrollHeight));
    drawn = chat.id;
  }

  /* ---------------- the run: the couriers' own thread ---------------- */

  const who = (m) =>
    `<li class="${m.you ? "you" : ""} ${m.left ? "gone" : ""}"><b>${esc(m.you ? "You" : m.name)}</b><small>${esc(m.courier)}</small><span class="st st-${esc(m.state)}">${m.state === "paid" ? `Paid $${esc(m.total)}` : m.state === "ordered" ? `$${esc(m.total)} to pay` : m.left ? "Left" : "Choosing"}</span></li>`;

  function runLine(l) {
    const by = `<b>${esc(l.courier)}</b>`;
    if (l.t === "say")
      return `<li class="${l.you ? "you" : ""}"><span class="by">${by}<small>${l.you ? "your courier" : `${esc(l.name)}’s courier`}</small></span><span>${esc(l.text)}</span></li>`;
    if (l.t === "joined") return `<li class="sys">${esc(l.name)} joined, with ${esc(l.courier)}.</li>`;
    if (l.t === "order")
      return `<li class="sys">${esc(l.name)} ordered ${esc((l.items || []).join(", "))}, $${esc(l.total)}.</li>`;
    if (l.t === "paid") return `<li class="sys">${esc(l.name)} paid $${esc(l.total)}.</li>`;
    if (l.t === "left") return `<li class="sys">${esc(l.you ? "You" : l.name)} left the run.</li>`;
    return "";
  }

  /** A run line in a few words, for a notification. */
  function runNews(l) {
    if (l.t === "say") return `${l.courier}: ${l.text}`;
    if (l.t === "joined") return `${l.name} joined the run.`;
    if (l.t === "paid") return `${l.name} paid $${l.total}.`;
    if (l.t === "left") return `${l.name} left the run.`;
    return "";
  }

  /* ---------------- tabs on a phone, and what happened elsewhere ---------------- */

  function setView(view) {
    if (view === "run" && !chat.run) view = "chat";
    room.dataset.view = view;
    for (const b of $(".rm-tabs").children) {
      const on = b.dataset.view === view;
      b.toggleAttribute("aria-current", on);
      if (on) $(".dot", b).hidden = true;
    }
    if (view === "run") {
      const t = $(".run-t", runBox);
      if (t) t.scrollTop = t.scrollHeight;
    }
    if (view === "chat") requestAnimationFrame(() => (log.scrollTop = log.scrollHeight));
  }

  /** Whether that part of the room is on screen now. */
  const inView = (view) => !narrow.matches || room.dataset.view === view;

  let toastTimer = 0;
  let toastGo = null;
  /** A note about something the person isn't looking at. A tap takes them there. */
  function notify(text, view, go) {
    if (view) {
      const dot = $(`.rm-tabs [data-view="${view}"] .dot`);
      if (dot && !inView(view)) dot.hidden = false;
    }
    toast.innerHTML = `<button type="button">${esc(text.length > 110 ? `${text.slice(0, 108)}…` : text)}</button>`;
    toast.hidden = false;
    toastGo = go || (() => setView(view));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 6000);
  }
  toast.addEventListener("click", () => {
    toast.hidden = true;
    toastGo?.();
  });
  $(".rm-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]");
    if (b) setView(b.dataset.view);
  });

  /** Compares what came in with what's on screen, and says what changed out of sight. */
  function news(before, after, listBefore) {
    if (before && after && before.id === after.id) {
      const said = after.events.slice(before.events.length).filter((e) => e.t === "say");
      if (said.length && !inView("chat"))
        notify(`${C.name}: ${said.at(-1).text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")}`, "chat");
      const was = before.run && after.run && before.run.id === after.run.id ? before.run.lines.length : null;
      const fresh = was === null ? [] : after.run.lines.slice(was).filter((l) => !l.you);
      if (fresh.length && !inView("run")) notify(runNews(fresh.at(-1)), "run");
    }
    const old = new Map(listBefore.map((t) => [t.id, t]));
    for (const t of list) {
      const prev = old.get(t.id);
      // Other chats only say they're done: their courier finished a turn, or something new landed while idle.
      if (t.id === chat.id || !prev || t.working || (prev.rev === t.rev && !prev.working)) continue;
      notify(`${C.name} replied in “${t.title || "an errand"}”`, "list", () => open(t.id));
    }
  }

  /** A friend asked this person to their run. Joining is a page of its own, where they pick who goes. */
  function drawInvites() {
    inviteBox.hidden = !invites.length;
    if (invites.length && !inView("list")) $('.rm-tabs [data-view="list"] .dot').hidden = false;
    inviteBox.innerHTML = invites
      .map(
        (i) =>
          `<div class="inv"><span><b>${esc(i.from)} invited you</b> ${esc(i.what)}${i.shop && !i.what.includes(i.shop) ? ` · ${esc(i.shop)}` : ""}${i.note ? `<small>“${esc(i.note)}”</small>` : ""}</span><a class="btn sm" href="${esc(i.url)}">See it</a></div>`,
      )
      .join("");
  }

  let runDrawn = "";
  function drawRun() {
    const r = chat.run;
    runBox.hidden = !r;
    room.classList.toggle("has-run", Boolean(r));
    $('.rm-tabs [data-view="run"]').hidden = !r;
    if (!r) {
      runDrawn = "";
      if (room.dataset.view === "run") setView("chat");
      return;
    }
    const key = `${r.id}.${r.rev}`;
    if (key === runDrawn) return;
    runDrawn = key;
    const alone = r.members.length < 2;
    runBody.innerHTML = `<header><b>Run</b><span>${esc(r.what)}${r.shop && !r.what.includes(r.shop) ? ` · ${esc(r.shop)}` : ""}</span>
        ${r.open && !r.full && !chat.ended ? `<button type="button" class="link fine" data-copy="${esc(r.url)}">Copy invite link</button>` : ""}</header>
      <ul class="run-who">${r.members.map(who).join("")}${(r.invited || []).map((n) => `<li class="asked"><b>${esc(n)}</b><span class="st">Invited</span></li>`).join("")}</ul>
      <ol class="run-t" aria-live="polite">${
        alone
          ? `<li class="sys">Nobody has joined yet. Once someone does, the couriers talk here.</li>`
          : r.lines.map(runLine).join("") || `<li class="sys">The couriers talk here.</li>`
      }</ol>`;
    const t = $(".run-t", runBox);
    t.scrollTop = t.scrollHeight;
  }

  /* ---------------- the row of chats, and this chat's budget ---------------- */

  function tabLabel(t) {
    const e = t.errand;
    if (t.working) return `<span class="tk-busy"><i></i><i></i><i></i></span>`;
    const together = t.together ? "Together · " : "";
    if (t.ended) return `<span>${together}Ended</span>`;
    if (!e) return t.together ? `<span>Together</span>` : "";
    if (t.toPay) return `<span>${together}to pay</span>`;
    return `<span>${together}${e.spentCents ? `${usd(e.spentCents)} of ` : "up to "}${usd(e.limitCents)}${e.open ? "" : " ✓"}</span>`;
  }

  function drawTabs() {
    // A chat with nothing in it yet isn't in the list. It's still shown, so a new errand looks like its own place.
    const shown = list.some((t) => t.id === chat.id) ? list : [{ id: chat.id, title: "", fresh: true }, ...list];
    tabs.innerHTML = shown
      .map(
        (t) =>
          `<li class="tk ${t.id === chat.id ? "on" : ""} ${t.ended ? "over" : ""}"><button type="button" class="tk-go" data-chat="${esc(t.id)}" ${t.id === chat.id ? 'aria-current="true"' : ""}><b>${esc(t.title || "New errand")}</b>${t.fresh ? "<span>Empty</span>" : tabLabel(t)}</button>${t.fresh ? "" : `<button type="button" class="tk-x" data-delete="${esc(t.id)}" aria-label="Delete the chat ${esc(t.title)}">×</button>`}</li>`,
      )
      .join("");
  }

  function drawBudget() {
    if ($(".tk-edit", bar)) return;
    const e = chat.errand;
    const end =
      chat.events.length && !chat.ended
        ? `<button type="button" class="btn ghost sm rm-end-btn" data-end>${chat.run ? "Leave run" : "End errand"}</button>`
        : chat.ended
          ? `<span class="over-tag">Ended</span>`
          : "";
    let line = "";
    if (e) {
      line =
        e.open && !chat.ended
          ? `<b>${esc(e.what)}</b><span>${e.spentCents ? `${usd(e.spentCents)} of ` : "up to "}${usd(e.limitCents)}</span><button type="button" class="link fine" data-edit="${esc(e.id)}">Change budget</button><a class="link fine" href="/app/errands?e=${esc(e.id)}">Steps</a>`
          : `<b>${esc(e.what)}</b><span>${usd(e.spentCents)} of ${usd(e.limitCents)} · done</span><a class="link fine" href="/app/errands?e=${esc(e.id)}">Steps</a>`;
    } else if (chat.pendingBudgetCents) {
      line = `<b>Budget</b><span>${usd(chat.pendingBudgetCents)}</span><button type="button" class="link fine" data-edit="">Change budget</button>`;
    } else if (chat.events.length) line = `<b>${esc(chat.title || "Errand")}</b>`;
    bar.innerHTML = line ? `<div class="bar-l">${line}</div>${end}` : "";
    bar.hidden = !bar.innerHTML;
  }

  /** The free messages left. With none, the demo is over: what's here can still be read and paid for. */
  function drawFree() {
    const over = left <= 0;
    $("#left").textContent = over ? "" : `${left} of ${boot.free} free messages left.`;
    $("#demo-end").hidden = !over || chat.ended;
    $("#over").hidden = !chat.ended;
    $("#compose").hidden = over || chat.ended;
    $("#run-say").hidden = over || chat.ended;
    room.classList.toggle("ended", over);
    room.classList.toggle("chat-over", Boolean(chat.ended));
    room.classList.toggle("blank", !chat.events.length);
  }

  function drawSugs() {
    // Ideas are for an empty chat. After that the only suggestions are answers to what the courier just asked.
    const fresh = !chat.events.length;
    sugs.hidden = chat.working || left <= 0 || chat.ended || !(fresh || chat.confirm);
    if (sugs.hidden) return;
    sugs.innerHTML = chat.confirm
      ? `<button type="button" class="several" data-say="Go ahead">Go ahead</button><button type="button" data-say="No thanks">No thanks</button>`
      : boot.ideas.map((i) => `<button type="button" data-say="${esc(i)}">${esc(i)}</button>`).join("") +
        `<button type="button" class="several" data-say="${esc(boot.several.say)}">${esc(boot.several.label)}</button>`;
  }

  function draw() {
    drawInvites();
    drawRun();
    drawTabs();
    drawBudget();
    drawSugs();
    drawFree();
    drawLog();
  }

  function take(out) {
    const listBefore = list;
    if (out.list) list = out.list;
    if (out.left !== undefined) left = out.left;
    if (out.invites && JSON.stringify(out.invites) !== JSON.stringify(invites)) {
      const known = new Set(invites.map((i) => i.url));
      const fresh = out.invites.find((i) => !known.has(i.url));
      invites = out.invites;
      drawInvites();
      if (fresh) notify(`${fresh.from} invited you: ${fresh.what}`, "list", () => (location.href = fresh.url));
    }
    if (out.chat && out.chat.id === chat.id) {
      const before = chat;
      const changed = out.chat.rev !== chat.rev || out.chat.working !== chat.working;
      chat = out.chat;
      if (changed) {
        drawLog();
        drawRun();
        news(before, chat, listBefore);
      } else news(null, null, listBefore);
      drawSugs();
    } else news(null, null, listBefore);
    drawTabs();
    drawBudget();
    drawFree();
  }

  async function open(id) {
    const out = await api(`chats/${encodeURIComponent(id)}`);
    chat = out.chat;
    list = out.list;
    left = out.left;
    history.replaceState(null, "", `/errand?c=${encodeURIComponent(C.id)}&chat=${encodeURIComponent(id)}`);
    draw();
    setView("chat");
    checkCards();
    if (!narrow.matches) input.focus();
  }

  /* ---------------- keeping up ---------------- */

  let quiet = 0;
  async function tick() {
    try {
      take(await api(`chats/${encodeURIComponent(chat.id)}`));
    } catch {}
    // In a run, other people's couriers can speak at any moment, so the window keeps listening closely.
    const busy = chat.working || list.some((t) => t.working) || (chat.run?.open && chat.run.members.length > 1);
    quiet = busy ? 0 : quiet + 1;
    setTimeout(tick, busy ? 700 : Math.min(5000, 1500 + quiet * 500));
  }

  /* ---------------- paying ---------------- */

  async function check(orderId, chatId) {
    try {
      const out = await api(`order/${encodeURIComponent(orderId)}?chat=${encodeURIComponent(chatId)}`);
      if (out.status !== "open") paying.delete(orderId);
      take(out);
      if (out.chat?.id === chat.id) drawLog();
    } catch {}
  }
  setInterval(() => {
    for (const [orderId, chatId] of paying) check(orderId, chatId);
  }, 2500);
  addEventListener("message", (e) => {
    if (!boot.origins.includes(e.origin)) return;
    const chatId = paying.get(e.data?.orderId);
    if (e.data?.type === "courier:payment" && chatId) check(e.data.orderId, chatId);
  });
  /** Coming back to a chat, cards still open may have been paid in the meantime. */
  function checkCards() {
    for (const e of chat.events) if (e.t === "pay" && e.status === "open") check(e.order_id, chat.id);
  }

  // The time left to call back counts down on its own, and the option goes away with it.
  setInterval(() => {
    for (const b of log.querySelectorAll("[data-until]")) {
      const until = Number(b.dataset.until);
      if (until > Date.now()) $("span", b).textContent = clock(until);
      else drawLog();
    }
  }, 1000);

  /* ---------------- what the person does ---------------- */

  async function send(text) {
    if (!text.trim() || left <= 0) return;
    // Shown straight away: it runs in the background, and queues behind anything this chat is already doing.
    chat.events = [...chat.events, { t: "me", text }];
    chat.working = true;
    for (const e of chat.events) if (e.t === "pay") e.callBackUntil = 0;
    drawLog();
    drawSugs();
    requestAnimationFrame(() => (log.scrollTop = log.scrollHeight));
    try {
      take(await api("chat", { chat: chat.id, message: text }));
    } catch (e) {
      chat.working = false;
      chat.events = [...chat.events, { t: "dim", text: `Hmm, that didn’t work: ${e.message}` }];
      drawLog();
      drawSugs();
    }
  }

  log.addEventListener("click", async (e) => {
    const pay = e.target.closest("[data-pay]");
    if (pay) {
      const target = pay.dataset.pay;
      paying.set(pay.dataset.order, chat.id);
      const w = window.open(target, "courier-pay", "popup,width=520,height=780");
      if (!w) {
        location.href = target; // popups blocked: pay in this tab; the shop sends you back here afterwards
        return;
      }
      drawLog();
      return;
    }
    const back = e.target.closest("[data-callback]");
    if (back) {
      back.disabled = true;
      try {
        take(await api("callback", { chat: chat.id, order: back.dataset.callback }));
      } catch (err) {
        chat.events = [...chat.events, { t: "dim", text: err.message }];
      }
      drawLog();
      return;
    }
    const answer = e.target.closest("[data-approval]");
    if (answer) {
      take(
        await api("approve", {
          chat: chat.id,
          approvalId: answer.dataset.approval,
          decision: answer.classList.contains("ap") ? "approved" : "denied",
        }),
      );
      drawLog();
      return;
    }
    const pick = e.target.closest("[data-say]");
    if (pick) send(pick.dataset.say);
  });

  async function remove(id) {
    const yes = await window.courierConfirm({
      title: "Delete this chat?",
      body: "Anything unpaid in it is called back. The errand stays in your records.",
      yes: "Delete chat",
    });
    if (!yes) return;
    try {
      const out = await api("delete", { chat: id });
      list = out.list;
      if (id === chat.id) await open(out.next);
      else drawTabs();
    } catch (err) {
      chat.events = [...chat.events, { t: "dim", text: err.message }];
      draw();
    }
  }

  async function newChat() {
    const out = await api("chats", {});
    await open(out.chat.id);
  }

  tabs.addEventListener("click", async (e) => {
    const go = e.target.closest("[data-chat]");
    if (go) return go.dataset.chat === chat.id ? setView("chat") : open(go.dataset.chat);
    const del = e.target.closest("[data-delete]");
    if (del) remove(del.dataset.delete);
  });

  $("#over").addEventListener("click", (e) => {
    if (e.target.closest("[data-new]")) newChat();
    if (e.target.closest("[data-delete-this]")) remove(chat.id);
  });

  /** Ending is the person's own button. In a run, it's leaving: the others see they've gone. */
  async function end() {
    const yes = await window.courierConfirm({
      title: chat.run ? "Leave the run?" : "End this errand?",
      body: chat.run
        ? "The others see that you left. Anything you haven’t paid is called back, and this chat stays here to read."
        : "Anything unpaid is called back, and this chat stays here to read. Anything else is a new errand.",
      yes: chat.run ? "Leave run" : "End errand",
    });
    if (!yes) return;
    try {
      take(await api("end", { chat: chat.id }));
      drawBudget();
      drawFree();
    } catch (err) {
      chat.events = [...chat.events, { t: "dim", text: err.message }];
      drawLog();
    }
  }

  bar.addEventListener("click", (e) => {
    if (e.target.closest("[data-end]")) return end();
    const edit = e.target.closest("[data-edit]");
    if (edit) {
      const errand = edit.dataset.edit;
      const current = errand ? chat.errand.limitCents : chat.pendingBudgetCents;
      bar.innerHTML = `<form class="tk-edit"><label>$<input type="number" min="1" max="500" step="1" required value="${Math.round(current / 100)}" aria-label="Budget in dollars"></label>
        <button class="btn sm" type="submit">Set</button>
        <button class="link fine" type="button" data-close>Cancel</button>
        <small class="tk-err" hidden></small></form>`;
      const form = $("form", bar);
      const field = $("input", form);
      field.focus();
      field.select();
      form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        try {
          const out = await api("budget", { chat: chat.id, dollars: field.value, ...(errand ? { errand } : {}) });
          form.remove();
          take(out);
        } catch (err) {
          const box = $(".tk-err", form);
          box.innerHTML = rich(err.message);
          box.hidden = false;
        }
      });
    }
    if (e.target.closest("[data-close]")) {
      $("form", bar).remove();
      drawBudget();
    }
  });

  $("#compose").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value;
    input.value = "";
    send(text);
  });
  // From the run tab on a phone: it goes to their own courier, who answers in the chat and passes it on.
  $("#run-say").addEventListener("submit", (e) => {
    e.preventDefault();
    const field = $("input", e.currentTarget);
    const text = field.value;
    field.value = "";
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
  $("#new-chat").addEventListener("click", newChat);

  /* ---------------- hello ---------------- */

  history.replaceState(null, "", `/errand?c=${encodeURIComponent(C.id)}&chat=${encodeURIComponent(chat.id)}`);
  draw();
  checkCards();
  tick();
  // Sent here from the People page: the message is ready, for them to read and send.
  if (boot.draft && !chat.events.length) input.value = boot.draft;
  // On a phone, the keyboard would cover the chat before anyone asked for it.
  if (!narrow.matches) input.focus();
})();
