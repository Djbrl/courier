import {
  ARROW,
  COURIER_COLORS,
  COURIER_NAME_HINT,
  COURIER_NAME_MAX,
  COURIER_NAME_PATTERN,
  type CourierColor,
  config,
  courierVars,
  html,
  idCard,
  PP,
  paypal,
  paypalButton,
  portrait,
  type RawHtml,
  raw,
  STORE_RESOURCE,
} from "@courier/shared";
import { type Courier, type Human, listCouriers } from "../db.ts";
import { courierLook, cpage, dots, firstName, OK, progress } from "./shared.ts";

/* ---------------- onboarding ---------------- */

function blankCard(): RawHtml {
  return raw(
    idCard({ ...courierLook(null), name: "Name", idNo: "CR-····-··" }, null).value.replace(
      'class="idc cc"',
      'class="idc cc blank"',
    ),
  );
}

export function startPage(): string {
  return cpage(
    "Get started",
    null,
    html`<main class="ob">
      <div class="ob-txt">
        ${progress(1)}
        <h1 class="big">Let’s get you a&nbsp;courier.</h1>
        <p class="lead">PayPal checks you’re real. Shops never learn who you are.</p>
        <div class="acts-row">${paypalButton("/auth/paypal/start?next=/start/courier")}</div>
        <p class="fine" style="margin-top:18px">${paypal.mode === "sandbox" ? "PayPal sandbox. Use a sandbox buyer account, no real money." : "Simulated PayPal sandbox. No real money."}</p>
      </div>
      <div class="stage c">${dots()}<div class="card-wrap">${blankCard()}</div></div>
    </main>`,
    { bodyClass: "onb" },
  );
}

const COLORS = Object.keys(COURIER_COLORS) as CourierColor[];

/** Step 2: name, colour and your name. Also used to edit a courier or add another one. */
export function courierSetupPage(
  human: Human,
  courier: Courier | undefined,
  opts: { error?: string; adding?: boolean; name?: string; reqId?: string } = {},
): string {
  const firstRun = !courier && !opts.adding;
  const used = new Set(listCouriers(human.id).map((c) => c.color));
  const look = courier
    ? courierLook(human, courier)
    : {
        ...courierLook(human),
        name: opts.adding ? "" : "Juno",
        color: (opts.adding ? COLORS.find((c) => !used.has(c)) : undefined) ?? "cobalt",
      };
  if (opts.name !== undefined) look.name = opts.name;
  const you = firstName(human);
  const swatch = (c: CourierColor, label: string) =>
    html`<label title="${label}"><input type="radio" name="color" value="${c}" ${look.color === c ? raw("checked") : ""} aria-label="${label}"><span style="--c:${COURIER_COLORS[c].ac}"></span></label>`;
  return cpage(
    courier ? `Edit ${courier.name}` : "Meet your courier",
    human,
    html`<main class="ob">
      <form class="ob-txt" method="post" action="/start/courier" id="setup">
        ${opts.reqId ? "" : firstRun ? progress(2) : html`<a class="back fine" href="${courier ? `/app/couriers?c=${courier.id}` : "/app/couriers"}">← Couriers</a>`}
        <h1 class="big">${courier ? html`Edit <span class="hfit" data-fit>${courier.name}.</span>` : opts.adding ? "Add a courier." : "Meet your courier."}</h1>
        <p class="lead">${opts.adding ? "One courier per Claude." : "Shops see its name, never yours."}</p>
        ${opts.error ? html`<p class="err">${opts.error}</p>` : ""}
        ${opts.reqId ? html`<input type="hidden" name="req" value="${opts.reqId}">` : ""}
        ${courier ? html`<input type="hidden" name="c" value="${courier.id}">` : opts.adding ? html`<input type="hidden" name="new" value="1">` : ""}
        <div class="form">
          <label class="fld"><span>Courier name</span><input class="inp big" name="name" value="${look.name}" placeholder="e.g. Otto" minlength="2" maxlength="${COURIER_NAME_MAX}" pattern="${COURIER_NAME_PATTERN}" title="${COURIER_NAME_HINT}" required autocomplete="off" autocapitalize="words" spellcheck="false" data-live="name"><small class="hint" id="name-hint">${COURIER_NAME_HINT}</small></label>
          <div class="fld"><span>Its colour</span><div class="sw">${swatch("cobalt", "Cobalt")}${swatch("tang", "Orange")}${swatch("ink", "Ink")}${swatch("hivis", "Hi-vis")}</div></div>
          <label class="fld"><span>Your first name</span><input class="inp" name="human" value="${you ?? ""}" maxlength="24" required autocomplete="given-name" data-live="human"></label>
        </div>
        <div class="acts-row"><button class="btn" type="submit">${courier ? "Save" : "Next"}${ARROW}</button></div>
      </form>
      <div class="stage li">${dots()}<div class="card-wrap" id="preview"
        data-vars="${JSON.stringify(Object.fromEntries(COLORS.map((c) => [c, courierVars(c)])))}"
        data-pts="${JSON.stringify(Object.fromEntries(COLORS.map((c) => [c, portrait({ name: "?", color: c }).value])))}">${idCard({ ...look, name: look.name || "Name" }, you)}</div></div>
    </main>`,
    { bodyClass: "onb", scripts: ["/assets/onboard.js"] },
  );
}

/** Step 3: the connector walkthrough, one thing at a time. Only its last step waits for Claude. */
export function claudeSetupPage(human: Human, courier: Courier, opts: { onboarding: boolean; step: number }): string {
  const local = /localhost|127\.0\.0\.1/.test(config.store.url);
  const cmd = `claude mcp add --transport http courier ${STORE_RESOURCE}`;
  const done = `/app?c=${courier.id}${opts.onboarding ? "&welcome=1" : ""}`;
  const step = Math.min(3, Math.max(1, opts.step));
  const stepUrl = (n: number) => `/start/claude?c=${courier.id}&step=${n}${opts.onboarding ? "&first=1" : ""}`;
  const leave = opts.onboarding ? done : "/app/settings";
  const body =
    step === 1
      ? html`<h1 class="big">Copy this address.</h1>
        <p class="lead">It’s how Claude finds ${courier.name}.</p>
        <code class="copy inp code">${STORE_RESOURCE}</code>
        ${local ? html`<p class="warn"><b>Running on localhost.</b> Claude on the web can’t reach it. Start the tunnel first.</p>` : ""}
        <details class="wiz-alt"><summary>Using Claude Code?</summary>
          <p class="fine">Run this in your terminal instead, then skip to the last step.</p>
          <code class="copy inp code sm">${cmd}</code>
        </details>`
      : step === 2
        ? html`<h1 class="big">Add it to Claude.</h1>
          <ol class="wiz-list">
            <li>Open Claude’s connector settings.</li>
            <li>Choose <b>Add custom connector</b>.</li>
            <li>Name it <b>Courier</b> and paste the address.</li>
          </ol>
          <a class="btn ghost" href="https://claude.ai/settings/connectors" target="_blank" rel="noopener">Open connector settings ↗</a>
          <code class="copy inp code sm">${STORE_RESOURCE}</code>`
        : html`<h1 class="big">Connect it.</h1>
          <p class="lead">In Claude, click <b>Connect</b> and approve ${courier.name}. Nothing is bought or charged.</p>
          <p class="fine">In Claude Code, run <code>/mcp</code> in an interactive session, choose <b>courier</b> and sign in.</p>
          <div class="live ${courier.clientId ? "on" : ""}" id="live" data-courier="${courier.id}" aria-live="polite">
            <span class="dot" aria-hidden="true"></span>
            <span class="txt">${courier.clientId ? html`<b>Connected.</b> ${courier.clientName ?? "Claude"} is ${courier.name} now.` : html`<b>Waiting for Claude…</b>`}</span>
          </div>`;
  const foot =
    step < 3
      ? html`<a class="btn" href="${stepUrl(step + 1)}">Next</a>`
      : html`<a class="${courier.clientId ? "btn" : "btn ghost"}" id="next" href="${courier.clientId ? done : leave}">${courier.clientId ? "Continue" : opts.onboarding ? "Skip for now" : "Done"}</a>`;
  return cpage(
    `Add ${courier.name} to Claude`,
    human,
    html`<main class="wiz-page"><div class="wiz">
      ${opts.onboarding ? progress(3) : ""}
      <p class="wiz-n">Step ${step} of 3</p>
      <div class="wiz-body">${body}</div>
      <div class="wiz-foot">
        ${step > 1 ? html`<a class="btn ghost" href="${stepUrl(step - 1)}">Back</a>` : opts.onboarding ? html`<a class="link fine" href="/errand/new?c=${courier.id}">Try it on this website instead</a>` : html`<a class="btn ghost" href="/app/settings">Back</a>`}
        ${foot}
      </div>
    </div></main>
    ${
      step === 3
        ? raw(
            `<script>(()=>{const el=document.getElementById("live");if(el.classList.contains("on"))return;const t=setInterval(async()=>{if(document.hidden)return;try{const s=await (await fetch("/app/api/status")).json();const c=(s.couriers||[]).find(c=>c.id===el.dataset.courier);if(c&&c.claude){clearInterval(t);el.classList.add("on");el.querySelector(".txt").innerHTML="<b>Connected.</b> "+(c.clientName||"Claude").replace(/[<&>]/g,"")+" is "+c.name.replace(/[<&>]/g,"")+" now.";const n=document.getElementById("next");n.className="btn";n.textContent="Continue";n.href=${JSON.stringify(done)};setTimeout(()=>{location.href=n.href},2500);}}catch{}},2500)})()</script>`,
          )
        : ""
    }`,
    { bodyClass: "onb" },
  );
}

export function connectingPage(human: Human, courier: Courier): string {
  const look = courierLook(human, courier);
  return cpage(
    "Setting up",
    human,
    html`<main class="ob">
      <div class="ob-txt">
        ${progress(3)}
        <h1 class="big">Opening <span class="hfit" data-fit>${courier.name}’s</span> errand&nbsp;room.</h1>
        <ul class="chk">
          <li style="--d:.2s">${OK}Verified by&nbsp;${PP}</li>
          <li style="--d:.9s">${OK}${courier.name} got its ID</li>
          <li style="--d:1.6s">${OK}${config.anthropicConfigured ? `Runs on Claude` : "Runs on a demo stand-in for Claude"}</li>
        </ul>
        <div class="acts-row" style="margin-top:40px"><a class="btn" href="/app?welcome=1&c=${courier.id}">Continue${ARROW}</a></div>
      </div>
      <div class="stage c">${dots()}<div class="card-wrap">${idCard(look, firstName(human))}</div></div>
    </main>
    ${raw(`<script>setTimeout(()=>{location.href="/app?welcome=1&c=${encodeURIComponent(courier.id)}"},3000)</script>`)}`,
    { bodyClass: "onb" },
  );
}
