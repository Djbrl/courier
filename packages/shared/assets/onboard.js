// Onboarding: the ID card preview follows what you type and pick.
(() => {
  const form = document.getElementById("setup");
  const preview = document.getElementById("preview");
  if (!form || !preview) return;
  const vars = JSON.parse(preview.dataset.vars);
  const pts = JSON.parse(preview.dataset.pts);
  const card = preview.querySelector(".idc");
  const letter = (name) => ([...name.trim()][0] || "C").toUpperCase();
  const input = form.elements.name;
  const hint = document.getElementById("name-hint");
  function update() {
    // Usernames, not sentences: drop anything that isn't a letter, digit or hyphen as it's typed.
    const clean = input.value.replace(/[^\p{L}\p{N}-]/gu, "").slice(0, 12);
    if (clean !== input.value) input.value = clean;
    hint?.classList.toggle("bad", clean.length > 0 && !input.checkValidity());
    const name = clean || "Name";
    const human = form.elements.human.value.trim() || "you";
    const color = form.querySelector('input[name="color"]:checked')?.value || "cobalt";
    card.setAttribute("style", vars[color]);
    card.querySelector('[data-f="name"]').textContent = name;
    card.querySelector('[data-f="human"]').textContent = human;
    const pt = card.querySelector(".bd .pt");
    pt.outerHTML = pts[color].replace("<b>?</b>", `<b>${letter(name).replace(/[<&>]/g, "")}</b>`);
    window.fitText?.(preview);
  }
  form.addEventListener("input", update);
  update();
})();
