// Small progressive enhancements shared by both apps.

// Soft auto-refresh for live sections (errand steps, merchant stats), paused while the tab is hidden.
document.querySelectorAll("[data-autorefresh]").forEach((el) => {
  const every = Number(el.getAttribute("data-autorefresh")) || 8000;
  setInterval(() => {
    if (document.hidden) return;
    if (document.activeElement?.closest("form, details")) return;
    if (document.querySelector("details[open], .tour-box")) return;
    location.reload();
  }, every);
});

// Click-to-copy for code snippets marked .copy
document.querySelectorAll("code.copy").forEach((el) => {
  el.style.cursor = "copy";
  el.title = "Click to copy";
  el.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(el.textContent.trim());
      const before = el.textContent;
      el.textContent = "Copied ✓";
      setTimeout(() => (el.textContent = before), 1200);
    } catch {}
  });
});

// Buttons that copy a link, including ones drawn later (the errand room draws its own).
document.addEventListener("click", async (e) => {
  const button = e.target.closest?.("[data-copy]");
  if (!button) return;
  try {
    await navigator.clipboard.writeText(button.dataset.copy);
    const before = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => (button.textContent = before), 1500);
  } catch {
    window.prompt("Copy the link:", button.dataset.copy);
  }
});

// A subtle ink-roughness filter for stamps.
if (document.querySelector(".stamp")) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  svg.innerHTML =
    '<filter id="rough"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n"/>' +
    '<feDisplacementMap in="SourceGraphic" in2="n" scale="1.6"/></filter>';
  document.body.appendChild(svg);
}

// Shrink one-line names ([data-fit]) until they fit their box, so long courier names never spill off a card.
function fitText(root = document) {
  root.querySelectorAll("[data-fit]").forEach((el) => {
    el.style.fontSize = "";
    const box = el.parentElement.clientWidth;
    const need = el.scrollWidth;
    if (box && need > box) el.style.fontSize = `${(parseFloat(getComputedStyle(el).fontSize) * box) / need}px`;
  });
}
window.fitText = fitText;
fitText();
document.fonts?.ready.then(() => fitText());
addEventListener("resize", () => fitText());

// Asks before something that can't be undone, in a dialog that holds the focus. Keeping things as they are is the default.
window.courierConfirm = ({ title, body, yes }) =>
  new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "sure";
    dialog.innerHTML = `<form method="dialog"><h2></h2><p></p><div class="sure-acts"><button class="btn ghost sm" value="no" autofocus>Cancel</button><button class="btn sm" value="yes"></button></div></form>`;
    dialog.querySelector("h2").textContent = title;
    dialog.querySelector("p").textContent = body;
    dialog.querySelector('[value="yes"]').textContent = yes;
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => {
      resolve(dialog.returnValue === "yes");
      dialog.remove();
    });
    document.body.append(dialog);
    dialog.showModal();
  });

document.addEventListener("click", async (e) => {
  const link = e.target.closest("a[data-sure]");
  if (!link) return;
  e.preventDefault();
  const { sure: title, sureBody: body, sureYes: yes } = link.dataset;
  if (await window.courierConfirm({ title, body, yes })) location.href = link.href;
});

// On a phone the sidebar folds into a menu under the top bar.
{
  const rail = document.querySelector(".rail");
  const button = rail?.querySelector(".rail-menu");
  if (button) {
    const set = (open) => {
      rail.classList.toggle("open", open);
      button.setAttribute("aria-expanded", String(open));
    };
    button.addEventListener("click", () => set(!rail.classList.contains("open")));
    document.addEventListener("keydown", (e) => e.key === "Escape" && set(false));
    document.addEventListener("click", (e) => {
      if (rail.classList.contains("open") && !rail.contains(e.target)) set(false);
    });
  }
}
