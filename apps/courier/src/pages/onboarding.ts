import {
  ARROW,
  COURIER_COLORS,
  COURIER_NAME_HINT,
  COURIER_NAME_MAX,
  COURIER_NAME_PATTERN,
  COURIER_RESOURCE,
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
} from "@courier/shared";
import { type Courier, type Human, listCouriers } from "../db.ts";
import { courierLook, cpage, dots, firstName, hasClaude, OK, progress, tryDemo } from "./shared.ts";

/* ---------------- onboarding ---------------- */

function blankCard(): RawHtml {
  return raw(
    idCard({ ...courierLook(null), name: "Name", idNo: "CR-····-··" }, null).value.replace(
      'class="idc cc"',
      'class="idc cc blank"',
    ),
  );
}

/** Every onboarding step shares this: one card, one counter, the same size throughout. */
function wizardTop(step: number): RawHtml {
  return html`${progress(step)}<p class="wiz-n">Step ${step} of 4</p>`;
}

export function startPage(): string {
  return cpage(
    "Get started",
    null,
    html`<main class="wiz-page"><div class="wiz">
      ${wizardTop(1)}
      <div class="wiz-body">
        <h1 class="big">Let’s get you a&nbsp;courier.</h1>
        <p class="lead">PayPal checks you’re real. Shops never learn who you are.</p>
        <div class="wiz-id">${blankCard()}</div>
        <p class="fine">${paypal.mode === "sandbox" ? "PayPal sandbox. Use a sandbox buyer account, no real money." : "Simulated PayPal sandbox. No real money."}</p>
      </div>
      <div class="wiz-foot">${paypalButton("/auth/paypal/start?next=/start/courier")}${tryDemo({ next: "/start/courier" })}</div>
    </div></main>`,
    { bodyClass: "onb" },
  );
}

const COLORS = Object.keys(COURIER_COLORS) as CourierColor[];

/** Name, colour and your name. Also used to edit a courier or add another one. */
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
  const backTo = courier ? `/app/couriers?c=${courier.id}` : "/app/couriers";
  return cpage(
    courier ? `Edit ${courier.name}` : "Meet your courier",
    human,
    html`<main class="wiz-page"><form class="wiz" method="post" action="/start/courier" id="setup">
      ${firstRun && !opts.reqId ? wizardTop(2) : ""}
      <div class="wiz-body">
        <h1 class="big">${courier ? html`Edit <span class="hfit" data-fit>${courier.name}.</span>` : opts.adding ? "Add a courier." : "Meet your courier."}</h1>
        ${opts.error ? html`<p class="err">${opts.error}</p>` : ""}
        ${opts.reqId ? html`<input type="hidden" name="req" value="${opts.reqId}">` : ""}
        ${courier ? html`<input type="hidden" name="c" value="${courier.id}">` : opts.adding ? html`<input type="hidden" name="new" value="1">` : ""}
        <div class="wiz-id" id="preview"
          data-vars="${JSON.stringify(Object.fromEntries(COLORS.map((c) => [c, courierVars(c)])))}"
          data-pts="${JSON.stringify(Object.fromEntries(COLORS.map((c) => [c, portrait({ name: "?", color: c }).value])))}">${idCard({ ...look, name: look.name || "Name" }, you)}</div>
        <div class="wiz-fields">
          <label class="fld"><span>Courier name</span><input class="inp" name="name" value="${look.name}" placeholder="e.g. Otto" minlength="2" maxlength="${COURIER_NAME_MAX}" pattern="${COURIER_NAME_PATTERN}" title="${COURIER_NAME_HINT}" required autocomplete="off" autocapitalize="words" spellcheck="false" data-live="name"></label>
          <label class="fld"><span>Your first name</span><input class="inp" name="human" value="${you ?? ""}" maxlength="24" required autocomplete="given-name" data-live="human"></label>
        </div>
        <small class="hint" id="name-hint">${COURIER_NAME_HINT}</small>
        <div class="fld wiz-sw"><span>Its colour</span><div class="sw">${swatch("cobalt", "Cobalt")}${swatch("tang", "Orange")}${swatch("ink", "Ink")}${swatch("hivis", "Hi-vis")}</div></div>
      </div>
      <div class="wiz-foot">
        ${firstRun || opts.reqId ? "" : html`<a class="btn ghost" href="${backTo}">Back</a>`}
        <button class="btn" type="submit">${courier ? "Save" : "Next"}</button>
      </div>
    </form></main>`,
    { bodyClass: "onb", scripts: ["/assets/onboard.js"] },
  );
}

/** The connector walkthrough: add it, then connect. Only the last step waits for Claude. */
export function claudeSetupPage(human: Human, courier: Courier, opts: { onboarding: boolean; step: number }): string {
  const local = /localhost|127\.0\.0\.1/.test(config.courier.url);
  const cmd = `claude mcp add --transport http courier ${COURIER_RESOURCE}`;
  const connected = hasClaude(human);
  const done = `/app?c=${courier.id}${opts.onboarding ? "&welcome=1" : ""}`;
  const step = Math.min(2, Math.max(1, opts.step));
  const stepUrl = (n: number) => `/start/claude?c=${courier.id}&step=${n}${opts.onboarding ? "&first=1" : ""}`;
  const leave = opts.onboarding ? done : "/app/settings";
  const body =
    step === 1
      ? html`<h1 class="big">Add Courier to Claude.</h1>
        <ol class="wiz-list">
          <li>Open <a class="link" href="https://claude.ai/settings/connectors" target="_blank" rel="noopener">Claude’s connector settings ↗</a></li>
          <li>Choose <b>Add custom connector</b>.</li>
          <li>Name it <b>Courier</b> and paste this:</li>
        </ol>
        <code class="copy inp code sm">${COURIER_RESOURCE}</code>
        <p class="fine">One connector reaches every shop and every courier.</p>
        ${local ? html`<p class="warn"><b>Running on localhost.</b> Claude on the web can’t reach it. Start the tunnel first.</p>` : ""}
        <details class="wiz-alt"><summary>Using Claude Code?</summary>
          <p class="fine">Run this in your terminal instead.</p>
          <code class="copy inp code sm">${cmd}</code>
        </details>`
      : html`<h1 class="big">Connect it.</h1>
        <p class="lead">In Claude, click <b>Connect</b> and approve it. Nothing is bought or charged.</p>
        <p class="fine">In Claude Code, run <code>/mcp</code> in an interactive session, choose <b>courier</b> and sign in.</p>
        <div class="live ${connected ? "on" : ""}" id="live" data-courier="${courier.id}" aria-live="polite">
          <span class="dot" aria-hidden="true"></span>
          <span class="txt">${connected ? html`<b>Connected.</b> Claude can send ${courier.name} now.` : html`<b>Waiting for Claude…</b>`}</span>
        </div>`;
  const foot =
    step < 2
      ? html`<a class="btn" href="${stepUrl(step + 1)}">Next</a>`
      : html`<a class="${connected ? "btn" : "btn ghost"}" id="next" href="${connected ? done : leave}">${connected ? "Continue" : opts.onboarding ? "Skip for now" : "Done"}</a>`;
  return cpage(
    `Add ${courier.name} to Claude`,
    human,
    html`<main class="wiz-page"><div class="wiz">
      ${opts.onboarding ? wizardTop(step + 2) : html`<p class="wiz-n">Step ${step} of 2</p>`}
      <div class="wiz-body">${body}</div>
      <div class="wiz-foot">
        ${step > 1 ? html`<a class="btn ghost" href="${stepUrl(step - 1)}">Back</a>` : opts.onboarding ? html`<a class="link fine" href="/errand/new?c=${courier.id}">Try the demo instead</a>` : html`<a class="btn ghost" href="/app/settings">Back</a>`}
        ${foot}
      </div>
    </div></main>
    ${
      step === 2
        ? raw(
            `<script>(()=>{const el=document.getElementById("live");if(el.classList.contains("on"))return;const t=setInterval(async()=>{if(document.hidden)return;try{const s=await (await fetch("/app/api/status")).json();const c=(s.couriers||[]).find(c=>c.id===el.dataset.courier);if(c&&c.claude){clearInterval(t);el.classList.add("on");el.querySelector(".txt").innerHTML="<b>Connected.</b> Claude can send "+c.name.replace(/[<&>]/g,"")+" now.";const n=document.getElementById("next");n.className="btn";n.textContent="Continue";n.href=${JSON.stringify(done)};setTimeout(()=>{location.href=n.href},2500);}}catch{}},2500)})()</script>`,
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
          <li style="--d:.2s">${OK}${human.simulated ? html`Demo: simulated&nbsp;${PP}` : html`Verified by&nbsp;${PP}`}</li>
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
