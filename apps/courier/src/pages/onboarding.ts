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
import { ticket } from "./app.ts";
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
        <div class="acts-row">${paypalButton("/auth/paypal/start?next=/start/how")}</div>
        <p class="fine" style="margin-top:18px">${paypal.mode === "sandbox" ? "PayPal sandbox. Use a sandbox buyer account, no real money." : "Simulated PayPal sandbox. No real money."}</p>
      </div>
      <div class="stage c">${dots()}<div class="card-wrap">${blankCard()}</div></div>
    </main>`,
    { bodyClass: "onb" },
  );
}

/** Step 2: the two things to know. A courier is an ID card; an errand is a ticket. */
export function howPage(human: Human): string {
  const look = courierLook(human);
  return cpage(
    "How Courier works",
    human,
    html`<main class="ob">
      <div class="ob-txt">
        ${progress(2)}
        <h1 class="big">How it works.</h1>
        <ol class="how">
          <li><span class="n">1</span><b>Your courier is your Claude’s ID.</b></li>
          <li><span class="n">2</span><b>Each errand gets a ticket: one shop, a budget, a time.</b></li>
          <li><span class="n">3</span><b>Anything else, it asks you first.</b></li>
        </ol>
        <div class="acts-row"><a class="btn" href="/start/courier">Next${ARROW}</a></div>
      </div>
      <div class="stage li how-viz">${dots()}
        <div class="hv-card">${idCard(look, firstName(human))}</div>
        <div class="hv-note">${ticket(look)}</div>
      </div>
    </main>`,
    { bodyClass: "onb" },
  );
}

const COLORS = Object.keys(COURIER_COLORS) as CourierColor[];

/** Step 3: name, colour and your name. Also used to edit a courier or add another one. */
export function courierSetupPage(
  human: Human,
  courier: Courier | undefined,
  opts: { error?: string; adding?: boolean; name?: string } = {},
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
        ${firstRun ? progress(3) : html`<a class="back fine" href="${courier ? `/app/couriers?c=${courier.id}` : "/app/couriers"}">← Couriers</a>`}
        <h1 class="big">${courier ? html`Edit <span class="hfit" data-fit>${courier.name}.</span>` : opts.adding ? "Add a courier." : "Meet your courier."}</h1>
        <p class="lead">${opts.adding ? "One courier per Claude." : "Shops see its name, never yours."}</p>
        ${opts.error ? html`<p class="err">${opts.error}</p>` : ""}
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

/** Step 4: from Claude (recommended) or from the website. Both work; the courier is the same either way. */
export function summonPage(human: Human, courier: Courier): string {
  const look = courierLook(human, courier);
  return cpage(
    `Summon ${courier.name}`,
    human,
    html`<main class="ob">
      <div class="ob-txt">
        ${progress(4)}
        <h1 class="big">Where will you summon it?</h1>
        <div class="paths">
          <a class="path rec" href="/start/claude?c=${courier.id}&first=1">
            <span><b>From Claude</b><span>Just ask, in any chat.</span></span><span class="tag">Recommended</span>${ARROW}
          </a>
          <a class="path" href="/start/here?c=${courier.id}">
            <span><b>From this website</b><span>Chat in the errand room.</span></span>${ARROW}
          </a>
        </div>
        <p class="fine">You can use both. It’s the same ${courier.name}.</p>
      </div>
      <div class="stage c">${dots()}<div class="card-wrap">${idCard(look, firstName(human))}</div></div>
    </main>`,
    { bodyClass: "onb" },
  );
}

/** The connector walkthrough, with a live check that flips once Claude has connected as this courier. */
export function claudeSetupPage(human: Human, courier: Courier, opts: { onboarding: boolean }): string {
  const local = /localhost|127\.0\.0\.1/.test(config.store.url);
  const look = courierLook(human, courier);
  const cmd = `claude mcp add --transport http courier ${STORE_RESOURCE}`;
  return cpage(
    `Add ${courier.name} to Claude`,
    human,
    html`<main class="ob">
      <div class="ob-txt wide">
        ${opts.onboarding ? progress(4) : html`<a class="back fine" href="/app/connections">← Connections</a>`}
        <h1 class="big">Add <span class="hfit" data-fit>${courier.name}</span> to&nbsp;Claude.</h1>
        <ol class="steps">
          <li><b>Copy this URL.</b><code class="copy inp code">${STORE_RESOURCE}</code></li>
          <li><b>In Claude, add it as a custom connector.</b><span>Settings → Connectors</span></li>
          <li><b>Connect, then pick ${courier.name}.</b></li>
        </ol>
        <details class="cc-cli"><summary>Using Claude Code?</summary><code class="copy inp code sm">${cmd}</code></details>
        ${local ? html`<p class="warn"><b>Running on localhost.</b> Claude on the web can’t reach it. Start the tunnel first.</p>` : ""}
        <div class="live ${courier.clientId ? "on" : ""}" id="live" data-courier="${courier.id}" aria-live="polite">
          <span class="dot" aria-hidden="true"></span>
          <span class="txt">${courier.clientId ? html`<b>Connected.</b> ${courier.clientName ?? "Claude"} is ${courier.name} now.` : html`<b>Waiting for Claude…</b>`}</span>
        </div>
        <div class="acts-row">
          <a class="btn" href="/app?c=${courier.id}${opts.onboarding ? "&welcome=1" : ""}">${opts.onboarding ? "Go to Courier" : "Done"}${ARROW}</a>
          <a class="btn ghost" href="/errand/new?c=${courier.id}">Try it here first</a>
        </div>
      </div>
      <div class="stage pa cdlg-stage">${dots()}
        <div class="cdlg" aria-hidden="true">
          <div class="cdlg-crumb">Settings › Connectors</div>
          <div class="cdlg-h">Add custom connector</div>
          <div class="cdlg-row"><label>Name</label><div class="cdlg-f">Courier</div></div>
          <div class="cdlg-row hl"><span class="cdlg-n">1</span><label>URL</label><div class="cdlg-f mono">${STORE_RESOURCE.replace(/^https?:\/\//, "")}</div></div>
          <div class="cdlg-a"><span>Cancel</span><span class="add"><span class="cdlg-n">2</span>Add</span></div>
        </div>
        <div class="cdlg-then"><span class="cdlg-n">3</span>${portrait(look)}<span>Claude is <b>${look.name}</b></span></div>
      </div>
    </main>
    ${raw(`<script>(()=>{const el=document.getElementById("live");if(el.classList.contains("on"))return;const t=setInterval(async()=>{if(document.hidden)return;try{const s=await (await fetch("/app/api/status")).json();const c=(s.couriers||[]).find(c=>c.id===el.dataset.courier);if(c&&c.claude){clearInterval(t);el.classList.add("on");el.querySelector(".txt").innerHTML="<b>Connected.</b> "+(c.clientName||"Claude").replace(/[<&>]/g,"")+" is "+c.name.replace(/[<&>]/g,"")+" now.";}}catch{}},2500)})()</script>`)}`,
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
        ${progress(4)}
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
