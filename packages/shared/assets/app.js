// Small progressive enhancements shared by both apps.

// Soft auto-refresh for live sections (errand steps, merchant stats), paused while the tab is hidden.
document.querySelectorAll("[data-autorefresh]").forEach((el) => {
  const every = Number(el.getAttribute("data-autorefresh")) || 8000;
  setInterval(() => {
    if (document.hidden) return;
    if (document.activeElement?.closest("form, details")) return;
    if (document.querySelector("details[open]")) return;
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
