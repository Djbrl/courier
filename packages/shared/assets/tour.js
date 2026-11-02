// The first look around the dashboard: a spotlight and a card, one step at a time, ending on starting an errand.
(() => {
  const steps = JSON.parse(document.getElementById("tour").textContent);
  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const hole = document.createElement("div");
  hole.className = "tour-hole";
  const box = document.createElement("div");
  box.className = "tour-box";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-live", "polite");
  document.body.append(hole, box);
  let at = 0;

  const target = () => document.querySelector(`[data-tour="${steps[at].target}"]`);

  function place() {
    const el = target();
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 6;
    Object.assign(hole.style, {
      top: `${r.top - pad}px`,
      left: `${r.left - pad}px`,
      width: `${r.width + pad * 2}px`,
      height: `${r.height + pad * 2}px`,
    });
    if (innerWidth < 640) {
      box.removeAttribute("style");
      return;
    }
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const gap = 16;
    const edge = 16;
    const clampX = (x) => Math.min(innerWidth - w - edge, Math.max(edge, x));
    const clampY = (y) => Math.min(innerHeight - h - edge, Math.max(edge, y));
    let left;
    let top;
    if (r.right + gap + w + edge <= innerWidth) {
      left = r.right + gap;
      top = clampY(r.top);
    } else if (r.left - gap - w - edge >= 0) {
      left = r.left - gap - w;
      top = clampY(r.top);
    } else if (r.bottom + gap + h + edge <= innerHeight) {
      left = clampX(r.left);
      top = r.bottom + gap;
    } else {
      left = clampX(r.left);
      top = clampY(r.top - gap - h);
    }
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
  }

  function show() {
    const step = steps[at];
    const last = at === steps.length - 1;
    box.setAttribute("aria-label", step.title);
    box.innerHTML = `<h2>${esc(step.title)}</h2><p>${esc(step.body)}</p>
      <div class="tour-foot"><span class="tour-dots" aria-label="Step ${at + 1} of ${steps.length}">${steps.map((_, i) => `<i class="${i === at ? "on" : ""}"></i>`).join("")}</span>
        <button type="button" class="link fine" data-do="skip">${last ? "Not now" : "Skip"}</button>
        ${last ? `<a class="btn" href="${esc(step.cta.href)}">${esc(step.cta.label)}</a>` : `<button type="button" class="btn" data-do="next">Next</button>`}</div>`;
    target()?.scrollIntoView({ block: "center", inline: "nearest" });
    place();
    box.querySelector(".btn").focus();
  }

  function end() {
    hole.remove();
    box.remove();
    removeEventListener("resize", place);
    removeEventListener("scroll", place, true);
    document.removeEventListener("keydown", key);
    document.getElementById("start-errand")?.focus();
  }

  function key(e) {
    if (e.key === "Escape") end();
  }

  box.addEventListener("click", (e) => {
    const action = e.target.closest("[data-do]")?.dataset.do;
    if (action === "skip") end();
    if (action === "next") {
      at++;
      show();
    }
  });
  addEventListener("resize", place);
  addEventListener("scroll", place, true);
  document.addEventListener("keydown", key);
  // Fonts change the layout under the spotlight, so wait for them.
  (document.fonts?.ready ?? Promise.resolve()).then(show);
})();
