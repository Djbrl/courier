import {
  COURIER_NAME_HINT,
  COURIER_NAME_MAX,
  COURIER_NAME_PATTERN,
  html,
  idCard,
  MONEY,
  paypal,
  paypalButton,
  raw,
} from "@courier/shared";
import { type Courier, db, findCourier, type Human, listCouriers } from "../db.ts";
import { type Run, runShop } from "../runs.ts";
import { courierLook, cpage, dots, firstName, signOut } from "./shared.ts";

/**
 * What someone sees when they open a run's link: who asked, for what, who's in, and one way in. Signed out, that's
 * PayPal or a demo person; signed in, it's which of their couriers joins. Everything shown came from the person who
 * started it or their courier, so it goes through `html` like any other text.
 */
export function runInvitePage(run: Run, viewer: Human | null, couriers: Courier[], error?: string): string {
  const host = run.members.find((m) => m.host) ?? run.members[0]!;
  const hostCourier = findCourier(host.humanId, host.courierId);
  const shop = runShop(run);
  const here = `/run/${run.token}`;
  const you = viewer ? firstName(viewer) : null;

  const join = !viewer
    ? html`${paypalButton(`/auth/paypal/start?next=${here}`, "Join with")}
        <form method="post" action="/auth/demo" class="try-demo">
          <input type="hidden" name="next" value="${here}">
          <button class="link fine" type="submit">Join as a demo person instead</button>
        </form>`
    : couriers.length
      ? html`<form method="post" action="${here}/join" class="run-join">
          ${
            couriers.length > 1
              ? html`<div class="fld"><span>Send</span><div class="run-pick">${couriers.map(
                  (c, i) =>
                    html`<label><input type="radio" name="c" value="${c.id}" ${i === 0 ? raw("checked") : ""}> ${c.name}</label>`,
                )}</div></div>`
              : html`<input type="hidden" name="c" value="${couriers[0]!.id}">`
          }
          <button class="btn" type="submit">Join${couriers.length === 1 ? ` with ${couriers[0]!.name}` : ""}</button>
        </form>`
      : html`<form method="post" action="${here}/join" class="run-join">
          <label class="fld"><span>Your first name</span><input class="inp" name="human" value="${you ?? ""}" maxlength="24" required autocomplete="given-name"></label>
          <label class="fld"><span>Name your courier</span><input class="inp" name="name" value="Nova" minlength="2" maxlength="${COURIER_NAME_MAX}" pattern="${COURIER_NAME_PATTERN}" title="${COURIER_NAME_HINT}" required autocomplete="off" autocapitalize="words" spellcheck="false"></label>
          <button class="btn" type="submit">Join</button>
        </form>`;

  const left = html`<p class="wiz-n">An invitation</p>
    <div class="wiz-body">
      <h1 class="big">${host.name} invited you.</h1>
      <p class="lead">${run.what}${shop && !run.what.includes(shop.name) ? ` at ${shop.name}` : ""}.</p>
      ${run.note ? html`<blockquote class="run-note">“${run.note}”<small>${host.name}, through ${host.courierName}</small></blockquote>` : ""}
      ${error ? html`<p class="err">${error}</p>` : ""}
      <ul class="run-in" aria-label="Who’s in">
        ${run.members.map((m) => html`<li><b>${m.name}</b> <small>with ${m.courierName}</small></li>`)}
      </ul>
      <p class="fine">Your courier talks to ${host.courierName} for you. You choose your own things and pay for them with your own PayPal. Nobody else sees your PayPal, and the shop never learns your name.</p>
    </div>
    <div class="wiz-foot run-foot">${join}</div>
    <p class="fine">${viewer ? html`Signed in as ${you ?? "a demo person"}. <a class="link" ${signOut(viewer)}>Sign out</a>` : paypal.mode === "sandbox" ? "PayPal sandbox: sign in with a sandbox buyer account, no real money." : MONEY[paypal.mode].note}</p>`;

  return cpage(
    `${host.name} invited you`,
    viewer,
    html`<main class="wiz-page"><div class="wiz wiz2">
      <div class="wiz2-l">${left}</div>
      <div class="wiz2-r cstage">${dots()}<div class="wiz-id">${hostCourier ? idCard(courierLook(db.get<Human>("humans", host.humanId) ?? null, hostCourier), host.name) : ""}</div></div>
    </div></main>`,
    { bodyClass: "onb" },
  );
}

/** Someone's own link: whoever opens it can add them, and they become each other's people on Courier. */
export function friendPage(owner: Human, viewer: Human | null, already: boolean): string {
  const name = firstName(owner) ?? "Someone";
  const courier = listCouriers(owner.id).find((c) => !c.revokedAt);
  const here = `/friend/${owner.friendToken}`;
  const foot = !viewer
    ? html`${paypalButton(`/auth/paypal/start?next=${here}`, "Sign in with")}
        <form method="post" action="/auth/demo" class="try-demo">
          <input type="hidden" name="next" value="${here}">
          <button class="link fine" type="submit">Use a demo person instead</button>
        </form>`
    : already
      ? html`<a class="btn" href="/app/people">See your people</a>`
      : html`<form method="post" action="${here}"><button class="btn" type="submit">Add ${name}</button></form>`;
  return cpage(
    `Add ${name}`,
    viewer,
    html`<main class="wiz-page"><div class="wiz wiz2">
      <div class="wiz2-l friend-l">
        <p class="wiz-n">${name} sent you their link</p>
        <h1 class="big">${already ? `You and ${name} are connected.` : `Add ${name} to your people.`}</h1>
        <ul class="perks">
          <li><b>Ask each other by name.</b> “Ask ${name} if they want a coffee” lands in ${name}’s own Courier${courier ? `, with ${courier.name}` : ""}.</li>
          <li><b>Each pays their own.</b> Your own PayPal, your own receipt.</li>
          <li><b>Only first names are shared,</b> and each other’s courier. Never your PayPal or your limits.</li>
        </ul>
        <div class="friend-act">${foot}</div>
      </div>
      <div class="wiz2-r cstage">${dots()}<div class="wiz-id">${courier ? idCard(courierLook(owner, courier), name) : ""}</div></div>
    </div></main>`,
    { bodyClass: "onb" },
  );
}
