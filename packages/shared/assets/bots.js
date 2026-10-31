// Release the bots: fire the attack suite at the shop's courier lane and show each verdict as it lands.
(() => {
  const button = document.getElementById("run-bots");
  const list = document.getElementById("bot-results");
  if (!button || !list) return;
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  const WORD = { blocked: "Blocked", flagged: "Asked first", allowed: "Got through" };
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Attacking…";
    list.innerHTML = "";
    try {
      const res = await fetch("/bots/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      json.results.forEach((r, i) =>
        setTimeout(() => {
          const li = document.createElement("li");
          li.className = `bot ${r.outcome}`;
          li.innerHTML = `<span class="verdict">${esc(WORD[r.outcome] ?? r.outcome)}</span><b>${esc(r.name)}</b><p>${esc(r.story)}</p><small>${esc(r.detail)}</small><span class="ms">${esc(r.status)} · ${esc(r.ms)}ms</span>`;
          list.appendChild(li);
        }, i * 220),
      );
    } catch (e) {
      list.innerHTML = `<li class="bot-empty">${esc(e.message)}</li>`;
    } finally {
      setTimeout(() => {
        button.disabled = false;
        button.textContent = "Run again";
      }, 2000);
    }
  });
})();
