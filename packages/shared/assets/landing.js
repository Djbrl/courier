// Courier landing page: a story told in sticky screens. This first part is the dotted globe and its little IDs.
(() => {
  const D = document.documentElement;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  D.classList.add("js");
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  const $ = (s) => document.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const opt = { cards: "own" };

  /* ---------- parts for the globe's little IDs ---------- */
  const PP = '<span class="pp"><span class="a">Pay</span><span class="b">Pal</span></span>';
  const LOGO = '<span class="logo"><svg><use href="#mk"/></svg>Courier</span>';
  const CK =
    '<span class="ck"><svg viewBox="0 0 12 12"><path d="M2.5 6.2 5 8.6l4.6-5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
  /* each courier's own colour: ac band, at text on band, as slash, ad deep (lines/dots), al light tint */
  const COL = {
    cobalt: { ac: "#3D3AF5", at: "#FFFFFF", as: "#D6FF2E", ad: "#3D3AF5", al: "#DEDDFF" },
    tang: { ac: "#FF6B2C", at: "#141414", as: "#FFFFFF", ad: "#E85A1C", al: "#FFE2D2" },
    ink: { ac: "#141414", at: "#FFFFFF", as: "#D6FF2E", ad: "#141414", al: "#E8E6E1" },
    hivis: { ac: "#D6FF2E", at: "#141414", as: "#141414", ad: "#7FA300", al: "#EFFFC0" },
    cab: { ac: "#FFC629", at: "#141414", as: "#FFFFFF", ad: "#D69C00", al: "#FFF1C4" },
  };
  const colourVars = (k) => {
    const c = COL[k];
    return `--ac:${c.ac};--at:${c.at};--as:${c.as};--ad:${c.ad};--al:${c.al}`;
  };
  const AV = "split profile specs bun cap eye beard afro smile bob hood shades ponytail phones curl beanie".split(" ");
  const pt = (a) => {
    let h = 0;
    for (const ch of a.n) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `<span class="pt" aria-hidden="true"><img src="/assets/avatars/${AV[h % AV.length]}.svg" alt=""></span>`;
  };
  const mini = (a) =>
    `<span class="gci"><span class="mini cc" style="${colourVars(a.c)}"><span class="mb">${LOGO}</span><span class="mr">${pt(a)}<span><span class="mn">${a.n}</span><span class="mv">${CK}${PP}</span></span></span></span></span>`;

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
    let known = false;
    function setKnown(on) {
      if (on === known) return;
      known = on;
      for (const c of chips) c.el.classList.toggle("known", on);
      redraw();
    }
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
        /* Both faces are there from the start, so a chip can turn into a courier and back. */
        el.innerHTML = mini({ n, L: n[0], c: ck, pc, lc, sh: SH[ni % SH.length] }).replace(
          '<span class="gci">',
          '<span class="gci"><span class="s-anon"><i>?</i>Unknown agent</span>',
        );
        el.classList.toggle("known", known);
        el.style.setProperty("--d", `${(chips.length * 0.12).toFixed(2)}s`);
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
        const col = known ? pingCol(c.ck) : "#a8a59c";
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
    return { start, stop, still, redraw, setKnown };
  })();

  window.courierGlobe = { globe, halftone, mini };
})();

/* The story: each screen moves through its steps as you scroll, and goes back on the way up. */
(() => {
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const { globe, halftone, mini } = window.courierGlobe;
  /* The same shops the app has, sent with the page. */
  const SHOPS = JSON.parse(document.getElementById("shops-data").textContent);
  const CK =
    '<span class="ck"><svg viewBox="0 0 12 12"><path d="M2.5 6.2 5 8.6l4.6-5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
  const PP = '<span class="pp"><span class="a">Pay</span><span class="b">Pal</span></span>';

  $$("[data-tex]").forEach((t) => (t.innerHTML = halftone(false)));
  $$("[data-ver]").forEach((e) => (e.innerHTML = `${CK}Verified by ${PP}`));
  $$("[data-tick]").forEach((e) => (e.innerHTML = CK));
  /* The earlier small card, the same one the globe shows. */
  const SHAPE = { cobalt: ["#141414", "#fff", '<circle cx="68" cy="34" r="24" fill="#fff" opacity=".5"/>'] };
  $$("[data-mini]").forEach((e) => {
    const [n, c] = e.dataset.mini.split("|");
    const [pc, lc, sh] = SHAPE[c];
    e.innerHTML = mini({ n, L: n[0], c, pc, lc, sh }).replace('class="gci"', 'style="display:block"');
  });
  /* Square courier pictures for the group chat. */
  const SHP = [
    '<circle cx="68" cy="34" r="24" fill="#fff" opacity=".35"/>',
    '<path d="M90 10 90 56 48 10z" fill="#141414" opacity=".2"/>',
    '<rect x="48" y="12" width="40" height="20" rx="10" fill="#fff" opacity=".3"/>',
  ];
  const pic = ([l, bg, fg, sh]) =>
    `<span class="s-pt" style="background:${bg};color:${fg}" aria-hidden="true"><svg viewBox="0 0 100 100">${SHP[sh]}</svg><b>${l}</b></span>`;
  $$("[data-pt]").forEach((e) => (e.outerHTML = pic(e.dataset.pt.split("|"))));
  const PICS = { Juno: "J|#3D3AF5|#fff|0", Otto: "O|#D6FF2E|#141414|1", Mika: "M|#141414|#fff|2" };
  $$("#group .s-them > b").forEach((b) => b.insertAdjacentHTML("afterbegin", pic(PICS[b.textContent].split("|"))));

  /* An uneven cluster: lopsided outline, nudged positions, mixed sizes, and shops popping up at random. The seed keeps it the same on every load. */
  let seed = 11;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const cells = [];
  for (let row = -4; row <= 4; row++)
    for (let col = -5; col <= 5; col++) {
      const x = (col + (row & 1) / 2) * 1.3,
        y = row * 1.12,
        a = Math.atan2(y, x);
      cells.push({ x, y, score: Math.hypot(x, y * 1.25) * (1 + 0.14 * Math.sin(a * 3 + 0.8) + 0.3 * rnd()) });
    }
  cells.sort((a, b) => a.score - b.score);
  const spots = cells.slice(0, SHOPS.length).map((c, i) => ({
    x: i ? c.x + (rnd() - 0.5) * 0.14 : 0,
    y: i ? c.y + (rnd() - 0.5) * 0.14 : 0,
    z: i ? 0.76 + rnd() * 0.3 : 1.08,
    order: rnd(),
  }));
  const queue = [...spots].sort((a, b) => a.order - b.order);
  queue.forEach((c, i) => (c.at = 0.07 + (i / (queue.length - 1)) * 0.68 + (i ? (rnd() - 0.5) * 0.025 : 0)));
  const reach = (k) => (2 * Math.max(...spots.map((c) => Math.abs(c[k]) + c.z / 2))).toFixed(3);
  const apps = document.getElementById("apps");
  apps.style.setProperty("--fx", reach("x"));
  apps.style.setProperty("--fy", reach("y"));
  apps.innerHTML = SHOPS.map((s, i) => {
    const c = spots[i];
    return `<div class="s-app${i ? "" : " pick"}" title="${s.name}" style="--t:${s.tile};--x:${c.x.toFixed(3)};--y:${c.y.toFixed(3)};--z:${c.z.toFixed(3)}"><svg viewBox="0 0 64 64" aria-hidden="true">${s.mark}</svg>${i ? "" : `<span>${s.name}</span>`}</div>`;
  }).join("");
  const lit = $$(".s-app", apps).map((n, i) => [n, spots[i].at]);

  const hang = document.getElementById("hang");
  const nav = document.getElementById("nav");
  /* Back to the top in one go, rather than scrolling back through every screen. */
  nav.querySelector(".logo").addEventListener("click", (e) => {
    e.preventDefault();
    scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  });
  let lastY = scrollY,
    angle = 0,
    speed = 0;

  const tracks = $$("[data-track]").map((el) => ({
    el,
    ats: $$("[data-at]", el).map((n) => [n, +n.dataset.at]),
    untils: $$("[data-until]", el).map((n) => [n, +n.dataset.until]),
    types: $$("[data-type]", el),
    meters: $$("[data-meter]", el).map((n) => [n, n.dataset.meter.split(",").map((s) => s.split(":").map(Number))]),
    counts: $$("[data-count]", el),
  }));
  const screens = $$("main > section");
  const why = document.getElementById("why");
  const open = document.getElementById("open");
  const flip = document.getElementById("flip");
  let globeOn = false;

  function frame() {
    /* Screens hand over to each other: the next one rises into place as it arrives, the last one fades as it goes. */
    for (const el of screens) {
      const r = el.getBoundingClientRect();
      const e = reduce ? 1 : Math.max(0, Math.min(1, 1 - r.top / innerHeight));
      const x = reduce ? 0 : Math.max(0, Math.min(1, 1 - r.bottom / innerHeight));
      el.style.setProperty("--e", e.toFixed(3));
      el.style.setProperty("--x", x.toFixed(3));
    }
    for (const t of tracks) {
      const r = t.el.getBoundingClientRect();
      const span = r.height - innerHeight;
      const p = reduce ? 1 : Math.max(0, Math.min(1, -r.top / span));
      for (const [n, at] of t.ats) n.classList.toggle("is", p >= at);
      for (const [n, u] of t.untils) n.classList.toggle("gone", p >= u);
      for (const n of t.types) {
        const from = +n.dataset.from,
          to = +n.dataset.to,
          clear = +n.dataset.clear,
          text = n.dataset.type;
        const count = Math.round(Math.max(0, Math.min(1, (p - from) / (to - from))) * text.length);
        const show = p >= clear ? "" : text.slice(0, count);
        if (n.textContent !== show) n.textContent = show;
      }
      for (const [n, stops] of t.meters) n.style.setProperty("--w", `${stops.find(([at]) => p >= at)[1]}%`);
      /* The number runs up as soon as the screen settles, easing into its last few. */
      const run = Math.min(1, p / 0.09);
      for (const n of t.counts) n.textContent = Math.round((1 - (1 - run) ** 3) * +n.dataset.count);
      if (t.el.id === "why") {
        globe.setKnown(p >= 0.52);
        t.el.classList.toggle("wait", p < 0.52);
      }
      if (t.el.id === "shops") {
        for (const [n, at] of lit) n.classList.toggle("lit", p >= at);
        apps.classList.toggle("focus", p >= 0.86);
      }
    }
    const moved = Math.max(-90, Math.min(90, scrollY - lastY));
    nav.classList.toggle("solid", scrollY > 24);
    if (moved > 4 && scrollY > innerHeight * 0.6) nav.classList.add("away");
    else if (moved < -4 || scrollY < innerHeight * 0.6) nav.classList.remove("away");
    /* The badge hangs still until the page moves, then swings on how fast it moved. */
    lastY = scrollY;
    if (!reduce) {
      speed = (speed + moved * 0.0045 - angle * 0.04) * 0.93;
      angle += speed;
      hang.style.transform = `rotate(${angle.toFixed(2)}deg)`;
    }
    /* Turns over in the middle of the hero, then holds on its back before the next screen. */
    const or = open.getBoundingClientRect();
    const op = Math.max(0, Math.min(1, -or.top / (or.height - innerHeight)));
    const ft = reduce ? +(op > 0.45) : Math.max(0, Math.min(1, (op - 0.12) / 0.48));
    const eased = ft * ft * (3 - 2 * ft);
    flip.style.transform = `perspective(2400px) rotateY(${(eased * 180).toFixed(1)}deg)`;
    const wr = why.getBoundingClientRect();
    const onOpen = wr.bottom > 0 && wr.top < innerHeight;
    if (onOpen !== globeOn) {
      globeOn = onOpen;
      if (reduce) onOpen && globe.still();
      else onOpen ? globe.start() : globe.stop();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
