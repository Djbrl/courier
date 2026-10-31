// Courier landing page: hero deck, dotted globe, section reveals.
(() => {
  const D = document.documentElement;
  const qs = new URLSearchParams(location.search);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  D.classList.add("js");
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  const $ = (s) => document.querySelector(s),
    $$ = (s) => [...document.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const opt = { cards: "own" };

  /* ---------- parts ---------- */
  const PP = '<span class="pp"><span class="a">Pay</span><span class="b">Pal</span></span>';
  const LOGO = '<span class="logo"><svg><use href="#mk"/></svg>Courier</span>';
  const CK =
    '<span class="ck"><svg viewBox="0 0 12 12"><path d="M2.5 6.2 5 8.6l4.6-5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
  const MAYA =
    '<span class="av" aria-hidden="true"><svg viewBox="0 0 20 20"><rect width="20" height="20" fill="#FFC629"/><circle cx="10" cy="8" r="3.6" fill="#141414"/><path d="M3.2 20c.6-4.4 3.3-6.6 6.8-6.6s6.2 2.2 6.8 6.6z" fill="#141414"/></svg></span>';
  const VT = `<span class="vt">${CK}Verified by ${PP}</span>`;
  /* each courier's own colour: ac band, at text on band, as slash, ad deep (lines/dots), al light tint */
  const COL = {
    green: { ac: "#0A7A4A", at: "#FFFFFF", as: "#D6FF2E", ad: "#0A7A4A", al: "#D5EEDF" },
    cobalt: { ac: "#3D3AF5", at: "#FFFFFF", as: "#D6FF2E", ad: "#3D3AF5", al: "#DEDDFF" },
    lilac: { ac: "#B7A3FF", at: "#141414", as: "#FFFFFF", ad: "#6A4FE0", al: "#ECE6FF" },
    tang: { ac: "#FF6B2C", at: "#141414", as: "#FFFFFF", ad: "#E85A1C", al: "#FFE2D2" },
    ink: { ac: "#141414", at: "#FFFFFF", as: "#D6FF2E", ad: "#141414", al: "#E8E6E1" },
    hivis: { ac: "#D6FF2E", at: "#141414", as: "#141414", ad: "#7FA300", al: "#EFFFC0" },
    cab: { ac: "#FFC629", at: "#141414", as: "#FFFFFF", ad: "#D69C00", al: "#FFF1C4" },
  };
  const cv = (k) => {
    const c = COL[k];
    return `--ac:${c.ac};--at:${c.at};--as:${c.as};--ad:${c.ad};--al:${c.al}`;
  };
  const AG = {
    juno: {
      n: "Juno",
      L: "J",
      c: "cobalt",
      id: "CR-7Q3F-JR",
      on: "runs on <b>Claude</b>",
      pc: "#141414",
      lc: "#FFFFFF",
      sh: '<circle cx="68" cy="34" r="24" fill="#D6FF2E"/>',
    },
    otto: {
      n: "Otto",
      L: "O",
      c: "tang",
      id: "CR-2M8K-OT",
      on: "runs on <b>ChatGPT</b>",
      pc: "#FFC629",
      lc: "#141414",
      sh: '<rect x="48" y="12" width="40" height="20" rx="10" fill="#141414"/><rect x="48" y="38" width="40" height="20" rx="10" fill="#141414"/>',
    },
    mika: {
      n: "Mika",
      L: "M",
      c: "ink",
      id: "CR-9X4D-MK",
      on: "runs on <b>Llama</b>",
      pc: "#3D3AF5",
      lc: "#F2EFE9",
      sh: '<path d="M90 10 90 56 48 10z" fill="#D6FF2E"/>',
    },
    remy: {
      n: "Rémy",
      L: "R",
      c: "hivis",
      id: "CR-5H1V-RM",
      on: "runs on <b>Mistral</b>",
      pc: "#E8352A",
      lc: "#141414",
      sh: '<path d="M46 12a22 22 0 0 0 44 0z" fill="#FFFFFF"/><circle cx="82" cy="58" r="7" fill="#FFC629"/>',
    },
  };
  const HELP = [
    { n: "Price Scout", id: "JR/1", can: "Compares prices", cant: "can’t buy" },
    { n: "Stock Checker", id: "JR/2", can: "Checks stock", cant: "can’t buy" },
  ];
  const pt = (a) =>
    `<span class="pt" style="--pc:${a.pc};--lc:${a.lc}" aria-hidden="true"><svg viewBox="0 0 100 100">${a.sh}</svg><b>${a.L}</b></span>`;
  function card(a) {
    return `<div class="idc cc" style="${cv(a.c)}" role="img" aria-label="Courier ID: ${a.n}, ${a.on.replace(/<[^>]+>/g, "")}, ${a.id}, sent by Maya Chen, verified by PayPal">
      <div class="band">${LOGO}</div>
      <div class="bd">${pt(a)}<div class="dt"><div class="nm">${a.n}</div><div class="on">${a.on}</div><div class="idn">${a.id}</div></div></div>
      <div class="ft"><span class="chip">${MAYA}Sent by <b>Maya Chen</b></span>${VT}</div>
    </div>`;
  }
  /* Juno + two helper tags, tethered. Units: 1em = 10 svg units. */
  const RVP = '<span class="rvp"><i></i>Revoked</span>';
  function fam(revoke) {
    const helper = (
      h,
      i,
    ) => `<div class="hlp h${i + 1}" role="img" aria-label="Juno's helper: ${h.n}, ${h.can.toLowerCase()}, ${h.cant}">
        <div class="hb">${pt(AG.juno)}Juno’s helper</div>
        <b class="hn">${h.n}</b>
        <div class="hs"><span><b>${h.can}</b> · <s>${h.cant}</s></span><span class="mono">${h.id}</span></div>
        ${revoke ? RVP : ""}
      </div>`;
    return `<div class="fam cc" style="${cv(AG.juno.c)}">
      <svg class="tether" viewBox="0 0 620 270" aria-hidden="true">
        <path pathLength="1" d="M272 133 C 322 133 322 64 372 64"/>
        <path pathLength="1" d="M272 133 C 322 133 322 208 372 208"/>
        <rect class="clip" x="263" y="121" width="16" height="24" rx="6"/>
      </svg>
      <div class="pj">${card(AG.juno)}${revoke ? RVP : ""}</div>
      ${HELP.map(helper).join("")}
    </div>`;
  }
  const mini = (a) =>
    `<span class="gci"><span class="mini cc" style="${cv(a.c)}"><span class="mb">${LOGO}</span><span class="mr">${pt(a)}<span><span class="mn">${a.n}</span><span class="mv">${CK}${PP}</span></span></span></span></span>`;

  /* ---------- halftone (from v4) ---------- */
  function halftone(flip) {
    let s = '<svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice"><g fill="currentColor">';
    const sp = 22,
      R = 760,
      mx = 9.2;
    for (let y = 0, row = 0; y <= 1010; y += sp * 0.866, row++)
      for (let x = ((row % 2) * sp) / 2; x <= 1610; x += sp) {
        const X = flip ? 1600 - x : x;
        const d1 = Math.hypot(X - 1600, y - 1000),
          d2 = Math.hypot(X, y);
        const f = Math.max(0, 1 - d1 / R, (1 - d2 / (R * 0.8)) * 0.85);
        const rr = mx * f * f;
        if (rr > 0.6) s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rr.toFixed(2)}"/>`;
      }
    return `${s}</g></svg>`;
  }
  $$(".tex").forEach((t, i) => (t.innerHTML = halftone(i === 1)));
  // light dot field inside panels (corner fade)
  {
    let s = '<svg viewBox="0 0 400 500" preserveAspectRatio="xMaxYMin slice"><g fill="currentColor">';
    for (let y = 0; y <= 500; y += 16)
      for (let x = 0; x <= 400; x += 16) {
        const f = Math.max(0, 1 - Math.hypot(400 - x, y) / 330);
        const r = 3.6 * f * f;
        if (r > 0.4) s += `<circle cx="${x}" cy="${y}" r="${r.toFixed(2)}"/>`;
      }
    s += "</g></svg>";
    $$(".dots").forEach((d) => (d.innerHTML = s));
  }

  /* ---------- build ---------- */
  const DECK = ["juno", "otto", "mika", "remy"];
  $("#deck").innerHTML =
    `<span class="disc" aria-hidden="true"></span>${DECK.map((k) => `<div class="dc">${card(AG[k])}</div>`).join("")}`;

  $("#note").innerHTML =
    `<div class="note" role="img" aria-label="Errand for Juno: Juniper Records, jazz records for my dad, 60 dollars max, back by tomorrow, Continue with PayPal">
    <span class="tape"></span>
    <div class="nhd">${pt(AG.juno)}Errand for Juno</div>
    <div class="nshop">Juniper Records</div>
    <div class="nask">Jazz records for my dad</div>
    <div class="nrow"><div class="nchip"><small>Max</small><b>$60</b></div><div class="nchip"><small>Back by</small><b>Tomorrow</b></div></div>
    <div class="ppb" aria-hidden="true">Continue with ${PP}</div>
  </div>`;

  $("#phone").innerHTML = `<div class="phone" role="group" aria-label="Approval text from Courier">
    <div class="scr"><span class="island"></span>
      <div class="sbar"><span>16:19</span><span class="ic"><i style="height:.45em"></i><i style="height:.65em"></i><i style="height:.85em"></i><i style="height:1.05em"></i></span></div>
      <div class="clk">16:19</div><div class="dte">Sunday, 25 October</div>
      <div class="notif">
        <div class="nh">${LOGO}</div>
        <div class="nwho">${pt(AG.juno)}Juno asks</div>
        <div class="nq">Studio headphones, $89?</div>
        <div class="ns">Over your $60.</div>
        <div class="acts"><button type="button" class="ap">Approve</button><button type="button" class="dn">Deny</button></div>
      </div>
    </div></div>`;

  $("#rcpt").innerHTML = `<div class="lift"><div class="rcpt zz" role="group" aria-label="Juniper Records receipt">
    <div class="rh"><b>Juniper Records</b><span class="mono">#4471</span></div>
    <div class="ramt"><b>$28.00</b><span>paid</span></div>
    <div class="ragent">${pt(AG.juno)}<div><b>Juno</b><span class="mono">${AG.juno.id}</span></div></div>
    <div class="rwho">${MAYA}<div><b>Sent by Maya Chen</b><br>${VT}</div></div>
  </div></div>`;

  $("#crew").innerHTML = fam(false);
  $("#rvk").innerHTML = `<div class="tog" aria-hidden="true">${pt(AG.juno)}<span>Juno</span><i></i></div>${fam(true)}`;

  /* ---------- buy it together (slides 4–6) + still in charge (7) ---------- */
  {
    const LEO = MAYA.replace("#FFC629", "#D6FF2E");
    const OK =
      '<span class="okc" aria-hidden="true"><svg viewBox="0 0 12 12"><path d="M2.5 6.2 5 8.6l4.6-5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
    const J = AG.juno,
      O = AG.otto;

    /* 4 · the gift, two couriers joining it */
    const gid = (
      a,
      who,
    ) => `<div class="gid cc" style="${cv(a.c)}" role="img" aria-label="Courier ID: ${a.n}, for ${who}, ${a.id}, verified by PayPal">
        <div class="mb">${LOGO}</div>
        <div class="mr">${pt(a)}<div class="mt"><b>${a.n}</b><span>for <b>${who}</b></span></div></div>
        <div class="mf"><span class="mono">${a.id}</span><span class="vt">${CK}${PP}</span></div>
      </div>`;
    /* box set art: two sleeves behind, one record sliding out */
    const ART = `<svg viewBox="0 0 360 150" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <rect x="114" y="10" width="112" height="112" rx="5" fill="#FF6B2C"/>
        <rect x="104" y="18" width="112" height="112" rx="5" fill="#3D3AF5"/>
        <g transform="rotate(-18 238 74)"><circle cx="238" cy="74" r="54" fill="#141414"/>
          <circle cx="238" cy="74" r="40" fill="none" stroke="#2E2E2E" stroke-width="1.4"/>
          <circle cx="238" cy="74" r="17" fill="#FFC629"/><circle cx="238" cy="74" r="2.6" fill="#F2EFE9"/></g>
        <rect x="94" y="26" width="112" height="112" rx="5" fill="#141414"/>
        <circle cx="150" cy="82" r="32" fill="#D6FF2E"/>
        <rect x="106" y="118" width="44" height="7" rx="3.5" fill="#F2EFE9"/>
      </svg>`;
    $("#gbuy").innerHTML = `<div class="duo">
        <div class="prod" role="group" aria-label="Late Night Jazz, 5-LP box set from Juniper Records, 120 dollars, a gift for Dad">
          <div class="art">${ART}</div>
          <div class="ph"><div><b>Late Night Jazz</b><span>5-LP box set · Juniper Records</span></div><span class="pr">$120</span></div>
          <span class="gtag"><span>For Dad</span></span>
        </div>
        <div class="pair">${gid(J, "Maya")}${gid(O, "Leo")}</div>
      </div>`;

    /* 5 · the Run chat, then Maya's approval */
    const msg = (a, t) =>
      `<div class="msg cc" style="${cv(a.c)}">${pt(a)}<div><small>${a.n}</small><p>${t}</p></div></div>`;
    $("#grun").innerHTML = `<div class="run">
        <div class="thr" role="group" aria-label="Couriers' chat for Dad's gift">
          <div class="thd">Dad’s gift</div>
          ${msg(O, "Leo is $10 short.")}
          ${msg(J, "Asking Maya.")}
        </div>
        <div class="gnote" role="group" aria-label="Approval request on Maya's phone">
          <div class="nh">${LOGO}</div>
          <div class="nwho">${pt(J)}Juno asks</div>
          <div class="nq">Cover $10 more for Dad’s gift?</div>
          <div class="nsub">Still within your $70.</div>
          <div class="acts"><button type="button" class="ap">Approve</button><button type="button" class="dn">Deny</button></div>
        </div>
      </div>`;

    /* 6 · one receipt, two people */
    const row = (av, who, amt, d) =>
      `<div class="rrow" style="--d:${d}s">${av}<div><b>${who}</b><span class="vt">${CK}Paid with ${PP}</span></div><span class="amt">${amt}</span></div>`;
    $("#grcpt").innerHTML =
      `<div class="lift"><div class="rcpt zz" role="group" aria-label="Juniper Records receipt: Late Night Jazz box set, 120 dollars paid; Maya 70 dollars and Leo 50 dollars, both paid with PayPal; 1 order, 2 verified people">
        <div class="rh"><b>Juniper Records</b><span class="mono">#4502</span></div>
        <div class="ritem">Late Night Jazz box set</div>
        <div class="ramt"><b>$120.00</b><span>paid</span></div>
        ${row(MAYA, "Maya", "$70", 0.7)}
        ${row(LEO, "Leo", "$50", 1)}
        <div class="rfoot">${OK}<span><b>1 order</b> · 2 verified people</span></div>
      </div></div>`;

    /* 7 · rules */
    const IC = {
      lock: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
      hold: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7M14 8.5v7"/>',
      out: '<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="M14 8l4 4-4 4M18 12H9"/>',
      yes: '<rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M9 12.2l2.2 2.2L15 10.5"/>',
    };
    const R = [
      ["lock", "Your limit stays yours.", "Couriers only say if it fits."],
      ["hold", "Only charged if it’s covered.", "Your share is held until the whole thing is paid&nbsp;for."],
      ["out", "Back out anytime.", "Leave before it’s bought and your hold is&nbsp;released."],
      ["yes", "Nobody pays more without your&nbsp;yes.", "Covering someone’s share always asks you&nbsp;first."],
    ];
    $("#rules").innerHTML = R.map(
      ([k, h, p], i) =>
        `<div class="rule pcol" style="--i:${i}"><span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true">${IC[k]}</svg></span><h3>${h}</h3><p>${p}</p></div>`,
    ).join("");
  }

  {
    const F = [
      ["otto", "6%", "16%", "-8deg", "0s"],
      ["mika", "80%", "13%", "7deg", "-1.5s"],
      ["remy", "10%", "58%", "6deg", "-3s"],
      ["juno", "78%", "56%", "-6deg", "-2.2s"],
    ];
    $("#floaters").innerHTML = F.map(
      ([k, x, y, r, ad]) => `<span class="gc" style="left:${x};top:${y};rotate:${r};--ad:${ad}">${mini(AG[k])}</span>`,
    ).join("");
  }

  /* ---------- phone buttons ---------- */
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".acts button");
    if (!b) return;
    const v = b.classList.contains("ap") ? "ok" : "no",
      p = b.closest(".phone, .gnote");
    const same = p.dataset.v === v;
    if (same) delete p.dataset.v;
    else p.dataset.v = v;
    p.querySelector(".ap").textContent = !same && v === "ok" ? "Approved ✓" : "Approve";
    p.querySelector(".dn").textContent = !same && v === "no" ? "Denied" : "Deny";
  });

  /* ---------- hero deck shuffle ---------- */
  const deck = (() => {
    const els = $$("#deck .dc");
    const POS = [
      { x: 0, y: 0, r: -4, s: 1, o: 1 },
      { x: 3.4, y: -3.4, r: 3, s: 0.95, o: 1 },
      { x: 6.6, y: -6.6, r: 9, s: 0.9, o: 1 },
      { x: 9.2, y: -9.4, r: 15, s: 0.85, o: 0 },
    ];
    const OUT = "translate(-1.2em,1.6em) rotate(-6deg) scale(.97)"; // fade out where it sits
    const tf = (p) => `translate(${p.x}em,${p.y}em) rotate(${p.r}deg) scale(${p.s})`;
    let order = els.map((_, i) => i),
      timer = null,
      hover = false,
      busy = false;
    function place() {
      order.forEach((ci, pos) => {
        const el = els[ci],
          p = POS[pos];
        el.style.zIndex = 10 - pos;
        el.style.transform = tf(p);
        el.style.opacity = p.o;
        el.classList.toggle("bk", pos > 0);
      });
    }
    function step() {
      if (hover || busy || document.hidden) return;
      busy = true;
      const front = order.shift(),
        el = els[front];
      el.classList.add("out");
      el.style.zIndex = 20;
      el.style.transform = OUT;
      el.style.opacity = 0;
      order.forEach((ci, pos) => {
        const e = els[ci],
          p = POS[pos];
        e.style.zIndex = 10 - pos;
        e.style.transform = tf(p);
        e.style.opacity = p.o;
        e.classList.toggle("bk", pos > 0);
      });
      setTimeout(() => {
        // jump, invisible, to the back slot; it fades in there on a later step
        order.push(front);
        el.classList.remove("out");
        el.classList.add("tuck", "bk");
        el.style.zIndex = 5;
        el.style.transform = tf(POS[3]);
        el.style.opacity = 0;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            el.classList.remove("tuck");
            busy = false;
          }),
        );
      }, 260);
    }
    const box = $("#deck");
    box.addEventListener("mouseenter", () => (hover = true));
    box.addEventListener("mouseleave", () => (hover = false));
    function set(mode) {
      clearTimeout(timer);
      clearInterval(timer);
      timer = null;
      if (mode === "shuffle" && !reduce) {
        timer = setTimeout(() => {
          step();
          timer = setInterval(step, 2200);
        }, 2000);
      } else {
        order = els.map((_, i) => i);
        place();
      }
    }
    place();
    return { set };
  })();

  /* ---------- dotted globe ---------- */
  const globe = (() => {
    const box = $("#globe"),
      cv = box.querySelector("canvas"),
      ctx = cv.getContext("2d"),
      layer = box.querySelector(".gchips");
    // continents as rough lon/lat ellipses
    const L = [
      [-102, 46, 30, 17],
      [-82, 60, 22, 12],
      [-115, 62, 20, 9],
      [-92, 18, 9, 8],
      [-42, 72, 13, 8],
      [-60, -12, 16, 20],
      [-67, -38, 7, 13],
      [-75, 4, 8, 7],
      [12, 50, 17, 9],
      [25, 60, 14, 8],
      [10, 12, 24, 12],
      [24, -10, 14, 20],
      [46, 25, 11, 9],
      [88, 52, 46, 15],
      [100, 28, 22, 12],
      [78, 20, 8, 10],
      [106, 10, 7, 9],
      [116, -2, 15, 5],
      [135, -25, 17, 10],
      [138, 37, 4, 7],
      [47, -19, 3, 6],
      [172, -42, 3, 6],
      [-3, 54, 3, 4],
      [150, 62, 20, 8],
    ];
    let s0 = 9;
    const rnd = () => {
      s0 = (s0 * 16807) % 2147483647;
      return s0 / 2147483647;
    };
    const land = (la, lo) => {
      for (const [x, y, rx, ry] of L) {
        let dl = lo - x;
        if (dl > 180) dl -= 360;
        if (dl < -180) dl += 360;
        const n =
          0.32 * Math.sin(la * 0.21 + lo * 0.13) * Math.cos(lo * 0.17 - la * 0.09) +
          0.14 * Math.sin(la * 0.6 + lo * 0.5);
        if ((dl / rx) ** 2 + ((la - y) / ry) ** 2 < 1 + n) return true;
      }
      return false;
    };
    const P = [];
    for (let la = -84; la <= 84; la += 2.1) {
      const lat = (la * Math.PI) / 180,
        n = Math.max(6, Math.round(171 * Math.cos(lat)));
      for (let k = 0; k < n; k++) {
        const lo = -180 + (360 * k) / n,
          isL = land(la, lo) && rnd() > 0.03;
        if (isL || rnd() < 0.38)
          P.push({ lat, lon: (lo * Math.PI) / 180, l: isL, cl: Math.cos(lat), sl: Math.sin(lat) });
      }
    }
    const LAND = P.filter((p) => p.l);
    const T = 0.36,
      cT = Math.cos(T),
      sT = Math.sin(T);
    let W = 0,
      R = 0,
      C = 0,
      rot = 0,
      last = 0,
      running = false;
    const NAMES = [
      ["Otto", "tang", "#FFC629", "#141414"],
      ["Mika", "ink", "#3D3AF5", "#F2EFE9"],
      ["Rémy", "hivis", "#E8352A", "#141414"],
      ["Pip", "cab", "#141414", "#fff"],
      ["Lou", "hivis", "#141414", "#fff"],
      ["Ivy", "ink", "#FFC629", "#141414"],
      ["Bo", "tang", "#141414", "#fff"],
      ["Kit", "cobalt", "#D6FF2E", "#141414"],
      ["Nell", "cab", "#E8352A", "#141414"],
      ["Ari", "hivis", "#FFC629", "#141414"],
      ["Zed", "cobalt", "#141414", "#fff"],
      ["Juno", "cobalt", "#141414", "#fff"],
    ];
    const SH = [
      '<circle cx="68" cy="34" r="24" fill="#fff" opacity=".5"/>',
      '<path d="M90 10 90 56 48 10z" fill="#fff" opacity=".45"/>',
      '<rect x="48" y="12" width="40" height="20" rx="10" fill="#141414" opacity=".5"/>',
    ];
    let ni = 0,
      chips = [],
      lastSpawn = 0;
    const pingCol = (k) => (opt.cards === "orange" ? "#FF5A1F" : opt.cards === "ink" ? "#141414" : COL[k].ad);
    function proj(p) {
      const l = p.lon + rot,
        x = p.cl * Math.sin(l),
        y = p.sl,
        z = p.cl * Math.cos(l);
      const y2 = y * cT - z * sT,
        z2 = y * sT + z * cT;
      return [C + R * x, C - R * y2, z2];
    }
    function layout() {
      const r = box.getBoundingClientRect();
      if (!r.width) return false;
      W = r.width;
      const dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(W * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      C = W / 2;
      R = W * 0.43;
      return true;
    }
    function spawn(now, age = 0) {
      if (!W) return;
      const busy = chips.map((c) => proj(c.p));
      for (let tries = 0; tries < 60; tries++) {
        const p = LAND[Math.floor(Math.random() * LAND.length)],
          [x, y, z] = proj(p);
        if (z < 0.45 || x > C + R * 0.25 || y < C - R * 0.75 || y > C + R * 0.9 || x < W * 0.12) continue;
        if (busy.some(([bx, by]) => Math.hypot(bx - x, by - y) < 150)) continue;
        const [n, ck, pc, lc] = NAMES[ni++ % NAMES.length];
        const el = document.createElement("span");
        el.className = "gc";
        el.innerHTML = mini({ n, L: n[0], c: ck, pc, lc, sh: SH[ni % SH.length] });
        layer.appendChild(el);
        const c = { p, el, ck, born: now - age, life: 4200 };
        chips.push(c);
        place(c);
        requestAnimationFrame(() => el.classList.add("on"));
        return;
      }
    }
    function place(c) {
      const [x, y, z] = proj(c.p);
      c.x = x;
      c.y = y;
      c.z = z;
      const w = c.el.offsetWidth || 136,
        h = c.el.offsetHeight || 64;
      c.el.style.transform = `translate(${(x - w / 2).toFixed(1)}px,${(y - h - 14).toFixed(1)}px)`;
    }
    function draw(now) {
      ctx.clearRect(0, 0, W, W);
      // faint disc
      ctx.fillStyle = "rgba(20,20,20,.025)";
      ctx.beginPath();
      ctx.arc(C, C, R + 2, 0, 7);
      ctx.fill();
      for (const p of P) {
        const [x, y, z] = proj(p);
        if (z < 0) continue;
        if (p.l) {
          ctx.fillStyle = `rgba(20,20,20,${(0.12 + 0.42 * z).toFixed(3)})`;
          const s = ((0.85 + 0.95 * z) * W) / 640;
          ctx.beginPath();
          ctx.arc(x, y, s, 0, 7);
          ctx.fill();
        } else {
          ctx.fillStyle = `rgba(20,20,20,${(0.06 + 0.07 * z).toFixed(3)})`;
          ctx.fillRect(x - 0.65, y - 0.65, 1.3, 1.3);
        }
      }
      for (const c of chips) {
        place(c);
        const k = clamp((now - c.born) / 900, 0, 1);
        const col = pingCol(c.ck);
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 4.2, 0, 7);
        ctx.fill();
        if (!reduce) {
          const ph = ((now - c.born) / 1300) % 1;
          ctx.globalAlpha = 0.7 * (1 - ph) * k;
          ctx.strokeStyle = col;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(c.x, c.y, 6 + ph * 18, 0, 7);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }
    function tick(now) {
      chips = chips.filter((c) => {
        const age = now - c.born;
        if ((age > c.life - 500 || c.z < 0.12) && !c.el.classList.contains("off")) c.el.classList.add("off");
        if (age > c.life || (c.el.classList.contains("off") && age > c.life - 500 + 600) || c.z < -0.05) {
          c.el.remove();
          return false;
        }
        return true;
      });
      if (
        chips.filter((c) => !c.el.classList.contains("off")).length < 2 ||
        (now - lastSpawn > 1050 && chips.length < 4)
      ) {
        spawn(now);
        lastSpawn = now;
      }
    }
    function frame(t) {
      if (!running) return;
      const dt = last ? Math.min(50, t - last) : 0;
      last = t;
      rot += dt * 0.00011;
      tick(t);
      draw(t);
      requestAnimationFrame(frame);
    }
    function seed() {
      const now = performance.now();
      spawn(now, 2400);
      spawn(now, 1300);
      spawn(now, 300);
      lastSpawn = now;
    }
    function start() {
      if (running) return;
      if (!W && !layout()) return;
      if (!chips.length) seed();
      running = true;
      last = 0;
      requestAnimationFrame(frame);
    }
    function stop() {
      running = false;
    }
    function still() {
      if (!W && !layout()) return;
      rot = 0.4;
      if (!chips.length) {
        const n = performance.now();
        spawn(n);
        spawn(n);
        spawn(n);
        chips.forEach((c) => c.el.classList.add("on"));
      }
      draw(performance.now());
    }
    if ("ResizeObserver" in window)
      new ResizeObserver(() => {
        if (layout()) draw(performance.now());
      }).observe(box);
    function redraw() {
      if (W && !running) draw(performance.now());
    }
    return { start, stop, still, redraw };
  })();

  /* ---------- play sections on view ---------- */
  const secs = $$(".sec");
  function play(sec) {
    if (!sec.classList.contains("play")) sec.classList.add("play");
  }
  if (reduce || !("IntersectionObserver" in window)) secs.forEach(play);
  else {
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting) {
            play(e.target);
            io.unobserve(e.target);
          }
        }),
      { rootMargin: "0px 0px -18% 0px", threshold: 0 },
    );
    secs.forEach((s) => io.observe(s));
  }
  if (reduce) globe.still();
  else if ("IntersectionObserver" in window) {
    new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting ? globe.start() : globe.stop())), {
      threshold: 0.02,
    }).observe(secs[1]);
  } else globe.start();

  /* ---------- boot ---------- */
  /* ?beat=N renders the page starting at section N (earlier ones hidden) for headless screenshots.
     The first wheel/touch/key restores the full page there. */
  const forced = qs.has("beat") ? clamp(parseInt(qs.get("beat"), 10) || 0, 0, secs.length - 1) : 0;
  let pinned = forced > 0;
  function unpin() {
    if (!pinned) return;
    pinned = false;
    ["wheel", "touchstart", "keydown"].forEach((t) => removeEventListener(t, unpin, true));
    secs.forEach((s) => s.classList.remove("pin-hide"));
    scrollTo({ top: secs[forced].getBoundingClientRect().top + scrollY, behavior: "auto" });
  }
  if (pinned) {
    secs.forEach((s, k) => s.classList.toggle("pin-hide", k < forced));
    ["wheel", "touchstart", "keydown"].forEach((t) => addEventListener(t, unpin, { capture: true, passive: true }));
  }
  deck.set("shuffle");
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      play(secs[forced]);
      if (!pinned) play(secs[0]);
    }),
  );
})();
