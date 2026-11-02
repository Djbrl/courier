// Courier landing page: one sticky stage. Scrolling moves the badges through the story; the globe runs on chapter 1.
(() => {
  const D = document.documentElement;
  const qs = new URLSearchParams(location.search);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  D.classList.add("js");
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  const $ = (s) => document.querySelector(s),
    $$ = (s) => [...document.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (t) => t * t * (3 - 2 * t);
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
  const pt = (a) =>
    `<span class="pt" style="--pc:${a.pc};--lc:${a.lc}" aria-hidden="true"><svg viewBox="0 0 100 100">${a.sh}</svg><b>${a.L}</b></span>`;
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

  /* ---------- the story ---------- */
  const narrow = () => innerWidth <= 760;
  /* Tracks are [progress, value] pairs. y: 0 hanging in frame, 1 above it. turn: degrees. x: % of stage width.
     Phones hold one extra stop, because two readable backs don't fit side by side there. */
  const WIDE = {
    stops: [0, 1, 2, 3, 4],
    juno: {
      y: [
        [0, 0],
        [0.7, 1],
        [1.2, 1],
        [1.7, 0],
        [2.2, 0],
        [2.7, 1],
      ],
      turn: [
        [1.65, 0],
        [2, 180],
      ],
      x: [[0, 69]],
      s: [[0, 1.4]],
    },
    "juno-gift": {
      y: [
        [2.3, 1],
        [3, 0],
      ],
      turn: [
        [3.45, 180],
        [3.95, 0],
      ],
      x: [[0, 57]],
      s: [
        [3.45, 1.2],
        [3.95, 1],
      ],
    },
    otto: {
      y: [
        [2.4, 1],
        [3, 0],
      ],
      turn: [
        [3.45, 180],
        [3.95, 0],
      ],
      x: [
        [3.45, 81],
        [3.95, 90],
      ],
      s: [
        [3.45, 1.2],
        [3.95, 1],
      ],
    },
    mika: {
      y: [
        [3.35, 1],
        [3.95, 0],
      ],
      turn: [[0, 0]],
      x: [[0, 73.5]],
      s: [[0, 1]],
    },
  };
  const NARROW = {
    stops: [0, 1, 2, 3, 3.5, 4],
    juno: {
      y: [
        [0, 0],
        [0.7, 1],
        [1.2, 1],
        [1.7, 0],
        [2.2, 0],
        [2.7, 1],
      ],
      turn: [
        [1.65, 0],
        [2, 180],
      ],
      x: [[0, 50]],
      s: [[0, 1.42]],
    },
    "juno-gift": {
      y: [
        [2.3, 1],
        [3, 0],
        [3.1, 0],
        [3.4, 1],
        [3.6, 1],
        [3.95, 0],
      ],
      turn: [
        [3.5, 180],
        [3.6, 0],
      ],
      x: [
        [3.5, 50],
        [3.6, 18],
      ],
      s: [
        [3.5, 1.42],
        [3.6, 0.74],
      ],
    },
    otto: {
      y: [
        [3.1, 1],
        [3.5, 0],
      ],
      turn: [
        [3.65, 180],
        [3.95, 0],
      ],
      x: [
        [3.65, 50],
        [3.95, 82],
      ],
      s: [
        [3.65, 1.42],
        [3.95, 0.74],
      ],
    },
    mika: {
      y: [
        [3.6, 1],
        [3.95, 0],
      ],
      turn: [[0, 0]],
      x: [[0, 50]],
      s: [[0, 0.74]],
    },
  };
  const track = (t, p) => {
    if (p <= t[0][0]) return t[0][1];
    for (let i = 1; i < t.length; i++)
      if (p <= t[i][0])
        return t[i - 1][1] + (t[i][1] - t[i - 1][1]) * smooth((p - t[i - 1][0]) / (t[i][0] - t[i - 1][0]));
    return t[t.length - 1][1];
  };

  const stage = $("#stage"),
    story = $("#story");
  const parts = $$(".tx, #globe").map((el) => ({ el, k: +el.dataset.k }));
  const bgs = $$(".bg").map((el) => ({ el, k: +el.dataset.k }));
  const hangs = $$(".hg").map((el, i) => ({
    el,
    key: el.dataset.b,
    turn: el.querySelector(".turn"),
    drops: el.dataset.b === "juno",
    lean: i % 2 ? 1 : -1,
    angle: 0,
    speed: 0,
    lastY: null,
  }));
  $$(".tex").forEach((t, i) => (t.innerHTML = halftone(i === 1)));

  /* Each chapter holds still for its first stretch of scrolling, then eases into the next, so the words can be read. */
  function progress(stops) {
    const max = story.offsetHeight - stage.offsetHeight;
    const x = clamp(max > 0 ? scrollY / max : 0, 0, 1) * (stops.length - 1);
    const i = Math.min(Math.floor(x), stops.length - 2);
    const t = Math.max(0, (x - i - 0.3) / 0.7);
    return stops[i] + (stops[i + 1] - stops[i]) * smooth(t);
  }

  const forced = qs.has("beat") ? clamp(parseInt(qs.get("beat"), 10) || 0, 0, 4) : 0;
  let born = reduce || forced ? -1e5 : performance.now(),
    lastScroll = scrollY,
    globeOn = false;

  function frame(now) {
    const plan = narrow() ? NARROW : WIDE;
    const p = progress(plan.stops);
    const H = stage.offsetHeight,
      W = stage.offsetWidth;
    const scrolled = clamp(scrollY - lastScroll, -90, 90);
    lastScroll = scrollY;

    for (const { el, k } of parts) {
      /* Narrow screens keep chapter 3 on through their extra stop. */
      const hi = k === 3 && narrow() ? 3.5 : k;
      const off = Math.max(0, k - p, p - hi);
      const o = clamp(1 - off * 3, 0, 1);
      el.style.opacity = o;
      el.style.visibility = o ? "visible" : "hidden";
      el.style.transform = `translateY(${((p < k ? 1 : p > hi ? -1 : 0) * off * H * 0.14).toFixed(1)}px)`;
    }
    for (const { el, k } of bgs) el.style.opacity = clamp((p - k + 1) * 2, 0, 1);

    for (const h of hangs) {
      const plan1 = plan[h.key];
      const t = (now - born) / 1000;
      /* The fall on load: a damped drop, so it lands with a little bounce. Only the first badge makes it. */
      const drop = !h.drops || t > 3 ? 0 : Math.exp(-4.5 * t) * Math.cos(7 * t);
      const y = clamp(track(plan1.y, p), 0, 1) + drop;
      const top = -y * H * 1.2;
      if (h.lastY === null) h.lastY = top;
      const fell = clamp(top - h.lastY, -120, 120);
      h.lastY = top;
      if (reduce) h.angle = 0;
      else {
        /* Swings on how fast it actually moved, then settles. */
        h.speed = (h.speed + (fell + scrolled * 0.5) * 0.006 * h.lean - h.angle * 0.04) * 0.93;
        h.angle += h.speed;
      }
      const turn = track(plan1.turn, p);
      const s = track(plan1.s, p);
      const x = (track(plan1.x, p) / 100) * W;
      h.el.style.visibility = y >= 0.99 ? "hidden" : "visible";
      h.el.style.transform = `translate3d(${x.toFixed(1)}px,${top.toFixed(1)}px,0) translateX(-50%) rotate(${h.angle.toFixed(2)}deg) scale(${s.toFixed(3)})`;
      h.turn.style.transform = `rotateY(${turn.toFixed(1)}deg)`;
      h.el.classList.toggle("on", turn > 150 && y < 0.1);
    }

    const showGlobe = p > 0.4 && p < 1.6;
    if (showGlobe !== globeOn) {
      globeOn = showGlobe;
      if (reduce) showGlobe && globe.still();
      else showGlobe ? globe.start() : globe.stop();
    }
    requestAnimationFrame(frame);
  }

  /* ?beat=N opens the page on chapter N, for screenshots. */
  if (forced) {
    const stops = (narrow() ? NARROW : WIDE).stops;
    const i = stops.indexOf(forced);
    scrollTo(0, (story.offsetHeight - stage.offsetHeight) * (i / (stops.length - 1)));
  }
  lastScroll = scrollY;
  requestAnimationFrame(frame);
})();
