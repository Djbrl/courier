import { type RawHtml, raw } from "@courier/shared";
import type { Item } from "./catalog.ts";

/*
 * Item pictures: one flat glyph per kind of thing, drawn for this project, on the item's own hue. Every mark here is
 * generic (a cup, a shoe, a ticket), never a real product, brand or logo. The SVG is built only from these constants
 * and a number (the hue), so it is safe to hand to raw().
 */

interface Ink {
  /** Paper: the glyph's main body. */
  P: string;
  /** A light tint of the hue. */
  L: string;
  /** A deep shade of the hue. */
  D: string;
  /** The tile itself, for cut-outs. */
  B: string;
}

type Glyph = (c: Ink) => string;

const PAPER = "#F2EFE9";
const INK = "#141414";
const CAB = "#FFC629";
const RED = "#E8352A";

/** A five-petal flower. */
function bloom(x: number, y: number, r: number, petal: string, heart: string): string {
  const petals = [0, 72, 144, 216, 288].map((a) => {
    const t = (a * Math.PI) / 180;
    return `<circle cx="${(x + Math.sin(t) * r).toFixed(1)}" cy="${(y - Math.cos(t) * r).toFixed(1)}" r="${(r * 0.75).toFixed(1)}" fill="${petal}"/>`;
  });
  return `${petals.join("")}<circle cx="${x}" cy="${y}" r="${(r * 0.7).toFixed(1)}" fill="${heart}"/>`;
}

/** A ticket with a small symbol on its left half. */
const ticket =
  (symbol: Glyph): Glyph =>
  (c) =>
    `<path d="M18 32h64v12a6 6 0 0 0 0 12v12H18V56a6 6 0 0 0 0-12z" fill="${c.P}"/><path d="M62 35v30" stroke="${c.D}" stroke-width="2.5" stroke-dasharray="4 3"/>${symbol(c)}<path d="M68 44h8M68 50h8M68 56h5" stroke="${c.L}" stroke-width="3" stroke-linecap="round"/>`;

const shirt: Glyph = (c) => `<path d="M38 24 22 34l6 12 6-3v33h32V43l6 3 6-12-16-10q-4 8-12 8t-12-8z" fill="${c.P}"/>`;

const GLYPHS = {
  // music
  record: (c) =>
    `<circle cx="62" cy="50" r="28" fill="${INK}"/><circle cx="62" cy="50" r="20" fill="none" stroke="#2E2E2E" stroke-width="1.5"/><circle cx="62" cy="50" r="8" fill="${c.L}"/><circle cx="62" cy="50" r="1.8" fill="${PAPER}"/><rect x="14" y="22" width="56" height="56" rx="3" fill="${c.D}"/><circle cx="42" cy="50" r="13" fill="${c.L}"/>`,
  cassette: (c) =>
    `<rect x="18" y="28" width="64" height="44" rx="5" fill="${INK}"/><rect x="26" y="36" width="48" height="18" rx="9" fill="${c.L}"/><circle cx="39" cy="45" r="5.5" fill="${PAPER}"/><circle cx="61" cy="45" r="5.5" fill="${PAPER}"/><path d="M32 72l4-9h28l4 9z" fill="#2E2E2E"/>`,
  cd: (c) =>
    `<circle cx="50" cy="50" r="29" fill="#E8E6E1"/><path d="M50 21a29 29 0 0 1 25 14.5L50 50z" fill="${c.L}"/><circle cx="50" cy="50" r="10" fill="${c.D}"/><circle cx="50" cy="50" r="3.5" fill="${PAPER}"/>`,
  turntable: (c) =>
    `<rect x="16" y="24" width="68" height="52" rx="6" fill="${c.P}"/><circle cx="44" cy="50" r="20" fill="${INK}"/><circle cx="44" cy="50" r="6" fill="${c.L}"/><path d="M74 30v22l-12 9" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
  headphones: (c) =>
    `<path d="M27 60v-9a23 23 0 0 1 46 0v9" stroke="${INK}" stroke-width="6" fill="none"/><rect x="20" y="54" width="16" height="24" rx="7" fill="${c.P}"/><rect x="64" y="54" width="16" height="24" rx="7" fill="${c.P}"/><rect x="24" y="60" width="6" height="12" rx="3" fill="${c.L}"/><rect x="70" y="60" width="6" height="12" rx="3" fill="${c.L}"/>`,
  slipmat: (c) =>
    `<circle cx="50" cy="50" r="30" fill="${c.D}"/><circle cx="50" cy="50" r="22" fill="none" stroke="${c.L}" stroke-width="2" stroke-dasharray="3 4"/><path d="M50 36c6 4 6 10 0 14-6-4-6-10 0-14z" fill="${c.L}"/><circle cx="50" cy="50" r="3" fill="${PAPER}"/>`,
  sleeve: (c) =>
    `<rect x="30" y="20" width="48" height="58" rx="3" fill="${c.L}"/><rect x="22" y="24" width="48" height="58" rx="3" fill="${c.P}"/><circle cx="46" cy="53" r="12" fill="none" stroke="${c.D}" stroke-width="2.5"/><circle cx="46" cy="53" r="3" fill="${c.D}"/>`,
  stylus: (c) =>
    `<path d="M24 30h44l10 12H24z" fill="${c.P}"/><rect x="40" y="42" width="20" height="14" rx="3" fill="${INK}"/><path d="M50 56v16" stroke="${c.L}" stroke-width="3.5" stroke-linecap="round"/><circle cx="50" cy="74" r="2.5" fill="${INK}"/>`,
  speaker: (c) =>
    `<rect x="31" y="20" width="38" height="60" rx="9" fill="${INK}"/><circle cx="50" cy="59" r="13" fill="${c.P}"/><circle cx="50" cy="59" r="5" fill="${INK}"/><circle cx="50" cy="35" r="6" fill="${c.L}"/>`,
  note: (c) =>
    `<path d="M40 70V32l26-6v36" stroke="${c.P}" stroke-width="6" fill="none" stroke-linejoin="round"/><circle cx="34" cy="70" r="8" fill="${c.P}"/><circle cx="60" cy="63" r="8" fill="${c.P}"/><path d="M40 40l26-6" stroke="${c.L}" stroke-width="6"/>`,

  // clothes
  shirt,
  merch: (c) => `${shirt(c)}<circle cx="50" cy="55" r="8" fill="${c.L}"/><circle cx="50" cy="55" r="3" fill="${INK}"/>`,
  hoodie: (c) =>
    `<path d="M37 26 21 36v38h10V48l3 28h32l3-28v26h10V36L63 26q-4-7-13-7t-13 7z" fill="${c.P}"/><path d="M39 26q11 16 22 0" fill="${c.D}"/><rect x="40" y="58" width="20" height="11" rx="3" fill="${c.L}"/>`,
  sock: (c) =>
    `<path d="M38 20h22v36l13 11a9 9 0 0 1-10 14L38 66z" fill="${c.P}"/><rect x="38" y="20" width="22" height="8" fill="${c.L}"/><path d="M63 62l9 8" stroke="${c.L}" stroke-width="5"/>`,
  shoe: (c) =>
    `<path d="M18 70V46q0-6 6-6h13q4 10 15 12l18 4q12 3 12 14z" fill="${c.P}"/><rect x="16" y="68" width="68" height="9" rx="3" fill="${INK}"/><path d="M40 47l5 5M47 46l5 5M54 49l4 4" stroke="${INK}" stroke-width="3" stroke-linecap="round"/><path d="M18 58h18" stroke="${c.L}" stroke-width="5"/>`,
  dress: (c) =>
    `<path d="M41 20h18l-2 18 17 40H26l17-40z" fill="${c.P}"/><rect x="42" y="36" width="16" height="5" fill="${INK}"/><path d="M36 64h28" stroke="${c.L}" stroke-width="4"/>`,
  jeans: (c) =>
    `<path d="M32 22h36l5 56H56l-6-34-6 34H27z" fill="${c.P}"/><rect x="32" y="22" width="36" height="7" fill="${INK}"/><path d="M36 34q6 4 10 0M54 34q6 4 10 0" stroke="${c.L}" stroke-width="3" fill="none"/>`,
  jacket: (c) =>
    `<path d="M37 24 21 32v44h11V50l2 26h32l2-26v26h11V32L63 24l-13 10z" fill="${c.P}"/><path d="M50 34v42" stroke="${INK}" stroke-width="3"/><path d="M37 24l13 10 13-10-4 14-9-4-9 4z" fill="${c.D}"/>`,
  scarf: (c) =>
    `<path d="M30 24h40v12a6 6 0 0 1-6 6H36a6 6 0 0 1-6-6z" fill="${c.P}"/><rect x="40" y="38" width="12" height="36" fill="${c.P}"/><path d="M30 30h40M40 52h12M40 62h12" stroke="${c.L}" stroke-width="4"/><path d="M41 74v6M46 74v6M51 74v6" stroke="${c.P}" stroke-width="2.5"/>`,
  bag: (c) =>
    `<path d="M38 42v-7a12 12 0 0 1 24 0v7" stroke="${INK}" stroke-width="5" fill="none"/><path d="M26 42h48l-4 36H30z" fill="${c.P}"/><rect x="26" y="42" width="48" height="6" fill="${c.L}"/>`,
  ring: (c) =>
    `<circle cx="50" cy="60" r="18" fill="none" stroke="${c.P}" stroke-width="7"/><path d="M41 32l9-12 9 12-9 10z" fill="${c.L}"/><path d="M41 32h18" stroke="${c.D}" stroke-width="2"/>`,

  // food and drink
  cup: (c) =>
    `<path d="M32 34h36l-4 44H36z" fill="${c.P}"/><rect x="29" y="26" width="42" height="9" rx="3" fill="${INK}"/><rect x="34" y="48" width="32" height="14" fill="${c.L}"/><path d="M58 26v-6" stroke="${INK}" stroke-width="3"/>`,
  mug: (c) =>
    `<path d="M28 32h36v36a9 9 0 0 1-9 9H37a9 9 0 0 1-9-9z" fill="${c.P}"/><path d="M64 41h4a8 8 0 0 1 0 16h-4" stroke="${c.P}" stroke-width="5" fill="none"/><path d="M28 46h36" stroke="${c.L}" stroke-width="6"/><path d="M40 16c-4 4 4 8 0 12M52 16c-4 4 4 8 0 12" stroke="${c.L}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`,
  beans: (c) =>
    `<path d="M30 30h40l3 48H27z" fill="${c.P}"/><path d="M30 30l4-8h32l4 8z" fill="${INK}"/><g transform="rotate(25 50 56)"><ellipse cx="50" cy="56" rx="10" ry="13" fill="${c.D}"/><path d="M48 44q7 12 0 24" stroke="${c.P}" stroke-width="2.5" fill="none"/></g>`,
  croissant: (c) =>
    `<path d="M18 62q6-26 32-28q26 2 32 28q-8 7-15 0q-7-12-17-12t-17 12q-7 7-15 0z" fill="${CAB}"/><path d="M36 40q5 10 1 20M50 35v18M64 40q-5 10-1 20" stroke="${c.D}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  kettle: (c) =>
    `<path d="M30 76h40l-5-32H35z" fill="${c.P}"/><rect x="38" y="36" width="24" height="9" rx="4" fill="${INK}"/><path d="M33 56 20 42" stroke="${c.P}" stroke-width="6" stroke-linecap="round"/><path d="M67 48q12 0 9 16" stroke="${INK}" stroke-width="5" fill="none"/><path d="M38 60h24" stroke="${c.L}" stroke-width="5"/>`,
  burger: (c) =>
    `<path d="M24 46q0-22 26-22t26 22z" fill="${CAB}"/><circle cx="40" cy="34" r="1.8" fill="${PAPER}"/><circle cx="50" cy="30" r="1.8" fill="${PAPER}"/><circle cx="60" cy="35" r="1.8" fill="${PAPER}"/><rect x="21" y="47" width="58" height="7" rx="3.5" fill="${c.L}"/><rect x="23" y="55" width="54" height="10" rx="5" fill="${INK}"/><path d="M24 67h52v2q0 8-8 8H32q-8 0-8-8z" fill="${CAB}"/>`,
  fries: (c) =>
    `<g fill="${CAB}"><rect x="33" y="24" width="7" height="30" rx="2"/><rect x="42" y="18" width="7" height="34" rx="2"/><rect x="51" y="22" width="7" height="32" rx="2"/><rect x="60" y="26" width="7" height="28" rx="2"/></g><path d="M28 44h44l-6 34H34z" fill="${c.P}"/><path d="M30 54h40" stroke="${RED}" stroke-width="5"/>`,
  pizza: (c) =>
    `<path d="M50 80 22 30q28-14 56 0z" fill="${CAB}"/><path d="M22 30q28-14 56 0l-3 7q-25-12-50 0z" fill="${c.D}"/><circle cx="44" cy="44" r="5" fill="${RED}"/><circle cx="57" cy="51" r="4.5" fill="${RED}"/><circle cx="49" cy="63" r="3.5" fill="${RED}"/>`,
  bowl: (c) =>
    `<path d="M57 18l12 32M65 18l9 32" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/><path d="M28 50q4-10 9 0q4-10 9 0q4-10 9 0q4-10 9 0q4-10 9 0" stroke="${CAB}" stroke-width="4" fill="none"/><path d="M20 50h60a30 28 0 0 1-60 0z" fill="${c.P}"/><path d="M26 60h48" stroke="${c.L}" stroke-width="4"/>`,
  groceries: (c) =>
    `<rect x="52" y="16" width="9" height="32" rx="4.5" fill="${CAB}" transform="rotate(14 56 32)"/><circle cx="40" cy="38" r="10" fill="${RED}"/><path d="M40 28q3-7 9-5" stroke="${INK}" stroke-width="2.5" fill="none"/><path d="M26 42h48l-4 36H30z" fill="${c.P}"/><rect x="26" y="42" width="48" height="6" fill="${c.D}"/>`,
  crisps: (c) =>
    `<path d="M30 22h40l-4 10 4 10v26l-4 10H34l-4-10V42l4-10z" fill="${c.P}"/><path d="M30 22h40" stroke="${INK}" stroke-width="4"/><circle cx="50" cy="52" r="11" fill="${CAB}"/><path d="M42 56q8-10 16 0" stroke="${c.D}" stroke-width="2.5" fill="none"/>`,
  snowflake: (c) =>
    `<g stroke="${c.P}" stroke-width="5" stroke-linecap="round" fill="none"><path d="M50 20v60M24 35l52 30M24 65l52-30"/><path d="M42 24l8 8 8-8M42 76l8-8 8 8" stroke="${c.L}"/></g>`,
  cheese: (c) =>
    `<path d="M22 58 74 34v42H22z" fill="${CAB}"/><path d="M22 58 74 34v9L22 66z" fill="${PAPER}"/><circle cx="38" cy="70" r="3.5" fill="${c.D}"/><circle cx="56" cy="62" r="4.5" fill="${c.D}"/><circle cx="66" cy="70" r="2.5" fill="${c.D}"/>`,
  carton: (c) =>
    `<rect x="44" y="18" width="12" height="7" fill="${INK}"/><path d="M34 40l6-14h20l6 14v38H34z" fill="${c.P}"/><path d="M34 40l6-14h20l6 14z" fill="${c.L}"/><rect x="38" y="50" width="24" height="16" rx="2" fill="${c.D}"/>`,
  bottle: (c) =>
    `<rect x="42" y="16" width="16" height="7" fill="${INK}"/><path d="M42 22h16v8l6 9v37a4 4 0 0 1-4 4H40a4 4 0 0 1-4-4V39l6-9z" fill="${c.P}"/><rect x="36" y="48" width="28" height="18" fill="${c.L}"/>`,
  jar: (c) =>
    `<rect x="30" y="38" width="40" height="40" rx="8" fill="${c.P}"/><rect x="28" y="26" width="44" height="13" rx="3" fill="${INK}"/><rect x="34" y="50" width="32" height="15" rx="2" fill="${c.L}"/>`,
  pill: (c) =>
    `<g transform="rotate(-35 50 50)"><rect x="22" y="39" width="56" height="22" rx="11" fill="${c.P}"/><path d="M50 39h17a11 11 0 0 1 0 22H50z" fill="${INK}"/></g><circle cx="30" cy="72" r="4" fill="${c.L}"/><circle cx="72" cy="28" r="3" fill="${c.L}"/>`,

  // home
  house: (c) =>
    `<path d="M50 20 18 48h9v30h46V48h9z" fill="${c.P}"/><rect x="44" y="58" width="12" height="20" fill="${INK}"/><rect x="31" y="52" width="9" height="9" fill="${c.L}"/><rect x="60" y="52" width="9" height="9" fill="${c.L}"/>`,
  building: (c) =>
    `<rect x="30" y="18" width="40" height="60" fill="${c.P}"/><g fill="${c.L}"><rect x="36" y="25" width="8" height="8"/><rect x="56" y="25" width="8" height="8"/><rect x="36" y="39" width="8" height="8"/><rect x="56" y="39" width="8" height="8"/><rect x="36" y="53" width="8" height="8"/></g><rect x="54" y="62" width="11" height="16" fill="${INK}"/>`,
  cabin: (c) =>
    `<circle cx="50" cy="32" r="16" fill="${c.D}"/><rect x="47" y="40" width="6" height="40" fill="${INK}"/><path d="M50 40 30 58h40z" fill="${c.P}"/><rect x="34" y="58" width="32" height="14" fill="${c.P}"/><rect x="46" y="62" width="8" height="10" fill="${INK}"/>`,
  chalet: (c) =>
    `<path d="M6 80 34 34l12 18 12-20 36 48z" fill="${c.D}"/><path d="M50 36 26 62h48z" fill="${c.P}"/><rect x="32" y="62" width="36" height="16" fill="${c.P}"/><rect x="45" y="48" width="10" height="9" fill="${c.L}"/><rect x="45" y="66" width="10" height="12" fill="${INK}"/>`,
  boat: (c) =>
    `<path d="M24 44 48 30l24 14z" fill="${c.L}"/><rect x="30" y="44" width="36" height="18" fill="${c.P}"/><rect x="36" y="49" width="8" height="7" fill="${c.L}"/><rect x="52" y="49" width="8" height="7" fill="${c.L}"/><path d="M16 62h68l-8 14H24z" fill="${INK}"/><path d="M12 82q6-4 12 0t12 0 12 0 12 0 12 0 12 0" stroke="${c.L}" stroke-width="3" fill="none"/>`,
  shelf: (c) =>
    `<rect x="28" y="18" width="44" height="62" rx="2" fill="${c.P}"/><g fill="${c.D}"><rect x="33" y="23" width="34" height="15"/><rect x="33" y="42" width="34" height="15"/><rect x="33" y="61" width="34" height="14"/></g><g fill="${c.L}"><rect x="36" y="26" width="5" height="12"/><rect x="42" y="28" width="5" height="10"/><rect x="54" y="45" width="5" height="12"/><rect x="60" y="47" width="5" height="10"/></g>`,
  lamp: (c) =>
    `<path d="M36 22h28l9 24H27z" fill="${c.P}"/><rect x="47" y="46" width="6" height="24" fill="${INK}"/><rect x="34" y="70" width="32" height="8" rx="3" fill="${INK}"/><path d="M32 52l-6 8M68 52l6 8M50 52v2" stroke="${CAB}" stroke-width="3.5" stroke-linecap="round"/>`,
  box: (c) =>
    `<rect x="22" y="36" width="56" height="40" rx="3" fill="${c.P}"/><rect x="22" y="36" width="56" height="9" fill="${c.L}"/><rect x="42" y="54" width="16" height="7" rx="3.5" fill="${INK}"/>`,
  sofa: (c) =>
    `<rect x="26" y="34" width="48" height="24" rx="6" fill="${c.P}"/><rect x="16" y="46" width="15" height="26" rx="6" fill="${c.P}"/><rect x="69" y="46" width="15" height="26" rx="6" fill="${c.P}"/><rect x="29" y="54" width="42" height="15" rx="3" fill="${c.L}"/><rect x="22" y="72" width="5" height="7" fill="${INK}"/><rect x="73" y="72" width="5" height="7" fill="${INK}"/>`,
  nightstand: (c) =>
    `<path d="M44 38v-9h12v9" fill="${CAB}"/><rect x="28" y="38" width="44" height="34" rx="3" fill="${c.P}"/><path d="M28 55h44" stroke="${c.D}" stroke-width="3"/><circle cx="50" cy="47" r="2.5" fill="${INK}"/><circle cx="50" cy="64" r="2.5" fill="${INK}"/><rect x="31" y="72" width="5" height="8" fill="${INK}"/><rect x="64" y="72" width="5" height="8" fill="${INK}"/>`,
  roll: (c) =>
    `<rect x="30" y="26" width="40" height="50" rx="3" fill="${c.P}"/><ellipse cx="50" cy="26" rx="20" ry="6" fill="${c.L}"/><ellipse cx="50" cy="26" rx="6" ry="2" fill="${INK}"/><path d="M30 46h40M30 62h40" stroke="${c.L}" stroke-width="2.5" stroke-dasharray="3 3"/>`,
  spray: (c) =>
    `<path d="M42 34V24h20l-6 10z" fill="${INK}"/><rect x="42" y="34" width="14" height="10" fill="${INK}"/><path d="M36 44h26v30a4 4 0 0 1-4 4H40a4 4 0 0 1-4-4z" fill="${c.P}"/><rect x="40" y="54" width="18" height="13" rx="2" fill="${c.L}"/><circle cx="72" cy="24" r="2" fill="${c.L}"/><circle cx="76" cy="31" r="2" fill="${c.L}"/><circle cx="70" cy="34" r="2" fill="${c.L}"/>`,
  towels: (c) =>
    `<rect x="22" y="58" width="56" height="16" rx="5" fill="${c.P}"/><rect x="26" y="42" width="48" height="16" rx="5" fill="${c.L}"/><rect x="30" y="26" width="40" height="16" rx="5" fill="${c.P}"/><path d="M22 68h56M26 52h48M30 36h40" stroke="${c.D}" stroke-width="2"/>`,
  tent: (c) =>
    `<path d="M50 24 18 76h64z" fill="${c.P}"/><path d="M50 44 40 76h20z" fill="${INK}"/><path d="M50 24l-5-7M50 24l5-7" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`,
  plant: (c) =>
    `<path d="M50 54V32" stroke="${INK}" stroke-width="3"/><path d="M50 42q-18-2-20-18q18 0 20 18z" fill="${c.D}"/><path d="M50 48q16-2 20-16q-18-2-20 16z" fill="${c.D}"/><rect x="31" y="52" width="38" height="8" rx="2" fill="${c.P}"/><path d="M35 60h30l-4 18H39z" fill="${c.P}"/>`,
  battery: (c) =>
    `<rect x="45" y="18" width="10" height="7" rx="2" fill="${c.P}"/><rect x="37" y="24" width="26" height="54" rx="4" fill="${c.P}"/><path d="M37 56h26v18a4 4 0 0 1-4 4H41a4 4 0 0 1-4-4z" fill="${c.L}"/><path d="M52 32l-7 12h10l-7 12" stroke="${INK}" stroke-width="3" fill="none" stroke-linejoin="round"/>`,
  plug: (c) =>
    `<rect x="42" y="18" width="5" height="16" fill="${INK}"/><rect x="53" y="18" width="5" height="16" fill="${INK}"/><rect x="36" y="32" width="28" height="24" rx="5" fill="${c.P}"/><path d="M50 56v10q0 10-12 10H22" stroke="${INK}" stroke-width="5" fill="none"/><circle cx="50" cy="44" r="4" fill="${c.L}"/>`,
  notebook: (c) =>
    `<rect x="30" y="20" width="40" height="60" rx="3" fill="${c.P}"/><rect x="30" y="20" width="9" height="60" fill="${INK}"/><g fill="${c.L}"><circle cx="47" cy="32" r="1.8"/><circle cx="55" cy="32" r="1.8"/><circle cx="63" cy="32" r="1.8"/><circle cx="47" cy="40" r="1.8"/><circle cx="55" cy="40" r="1.8"/><circle cx="63" cy="40" r="1.8"/><circle cx="47" cy="48" r="1.8"/><circle cx="55" cy="48" r="1.8"/><circle cx="63" cy="48" r="1.8"/></g><rect x="64" y="20" width="3" height="60" fill="${c.D}"/>`,
  frame: (c) =>
    `<rect x="26" y="20" width="48" height="60" rx="2" fill="${INK}"/><rect x="31" y="25" width="38" height="50" fill="${c.P}"/><path d="M50 72V50" stroke="${c.D}" stroke-width="2.5"/>${bloom(50, 44, 7, c.L, c.D)}`,
  candle: (c) =>
    `<path d="M50 16q8 9 0 15q-8-6 0-15z" fill="${CAB}"/><rect x="44" y="32" width="12" height="30" rx="2" fill="${c.P}"/><rect x="38" y="62" width="24" height="5" fill="${c.D}"/><path d="M47 67h6l3 7h10v5H34v-5h10z" fill="${c.D}"/>`,
  yarn: (c) =>
    `<circle cx="48" cy="52" r="23" fill="${c.P}"/><path d="M28 42q20 6 38-4M26 55q22 8 44-7M33 69q15 0 32-19" stroke="${c.L}" stroke-width="3.5" fill="none"/><path d="M69 66q9 4 11 14" stroke="${c.P}" stroke-width="3" fill="none"/>`,
  flowers: (c) =>
    `<path d="M50 72V44M50 62 36 48M50 62l14-14" stroke="${INK}" stroke-width="3.5"/>${bloom(50, 34, 8, c.P, CAB)}${bloom(32, 46, 7, c.L, CAB)}${bloom(68, 46, 7, c.L, CAB)}<path d="M34 60h32l-8 20H42z" fill="${c.D}"/>`,

  // tools
  wrench: (c) =>
    `<g transform="rotate(-40 50 50)"><rect x="45" y="34" width="10" height="46" rx="5" fill="${c.P}"/><circle cx="50" cy="28" r="14" fill="${c.P}"/><rect x="45" y="12" width="10" height="15" fill="${c.B}"/></g>`,
  hammer: (c) =>
    `<g transform="rotate(-25 50 50)"><rect x="46" y="32" width="8" height="48" rx="3" fill="${CAB}"/><path d="M30 22h28v13H30z" fill="${c.P}"/><path d="M58 22q12 2 14 14H58z" fill="${c.P}"/></g>`,
  drill: (c) =>
    `<path d="M24 30h38v20H24z" fill="${c.P}"/><rect x="62" y="35" width="10" height="10" fill="${INK}"/><rect x="72" y="38.5" width="12" height="3" fill="${INK}"/><path d="M32 50h16l4 20H36z" fill="${c.P}"/><rect x="30" y="70" width="26" height="8" rx="2" fill="${INK}"/><rect x="28" y="36" width="20" height="6" rx="3" fill="${c.L}"/>`,
  paint: (c) =>
    `<path d="M30 36q20-28 40 0" stroke="${INK}" stroke-width="3" fill="none"/><rect x="28" y="36" width="44" height="40" rx="4" fill="${c.P}"/><path d="M28 36h44v14q-6 0-6 8q-5 0-5-8H50q0 12-6 12q-5 0-5-12H28z" fill="${c.L}"/><ellipse cx="50" cy="36" rx="22" ry="5" fill="${INK}"/>`,
  nut: (c) => `<path d="M50 22l24 14v28L50 78 26 64V36z" fill="${c.P}"/><circle cx="50" cy="50" r="10" fill="${c.B}"/>`,

  // tech
  phone: (c) =>
    `<rect x="33" y="18" width="34" height="62" rx="7" fill="${INK}"/><rect x="37" y="25" width="26" height="44" rx="2" fill="${c.L}"/><circle cx="50" cy="74" r="2.5" fill="${PAPER}"/>`,
  laptop: (c) =>
    `<rect x="26" y="26" width="48" height="34" rx="3" fill="${INK}"/><rect x="30" y="30" width="40" height="26" fill="${c.L}"/><path d="M18 64h64l-5 9H23z" fill="${c.P}"/>`,
  camera: (c) =>
    `<rect x="32" y="28" width="16" height="10" rx="2" fill="${c.P}"/><rect x="22" y="35" width="56" height="38" rx="6" fill="${c.P}"/><circle cx="50" cy="54" r="13" fill="${INK}"/><circle cx="50" cy="54" r="6" fill="${c.L}"/><circle cx="69" cy="44" r="2.5" fill="${c.D}"/>`,
  tv: (c) =>
    `<rect x="18" y="24" width="64" height="42" rx="3" fill="${INK}"/><rect x="22" y="28" width="56" height="34" fill="${c.L}"/><path d="M42 66l-6 11M58 66l6 11" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
  controller: (c) =>
    `<path d="M30 36h40a13 13 0 0 1 13 12l2 18a7 7 0 0 1-12 5l-7-9H34l-7 9a7 7 0 0 1-12-5l2-18a13 13 0 0 1 13-12z" fill="${c.P}"/><path d="M29 49h12M35 43v12" stroke="${INK}" stroke-width="4"/><circle cx="62" cy="46" r="3.5" fill="${INK}"/><circle cx="70" cy="53" r="3.5" fill="${c.D}"/>`,
  game: (c) =>
    `<rect x="30" y="18" width="40" height="62" rx="3" fill="${INK}"/><rect x="30" y="18" width="40" height="7" fill="${c.P}"/><rect x="34" y="30" width="32" height="44" rx="2" fill="${c.L}"/><path d="M36 68l9-16 6 8 5-6 8 14z" fill="${c.D}"/><circle cx="57" cy="40" r="4.5" fill="${PAPER}"/>`,
  coins: (c) =>
    `<ellipse cx="44" cy="66" rx="22" ry="8" fill="${c.D}"/><rect x="22" y="56" width="44" height="10" fill="${c.D}"/><ellipse cx="44" cy="56" rx="22" ry="8" fill="${CAB}"/><ellipse cx="58" cy="44" rx="22" ry="8" fill="${c.D}"/><rect x="36" y="34" width="44" height="10" fill="${c.D}"/><ellipse cx="58" cy="34" rx="22" ry="8" fill="${CAB}"/><path d="M52 34h12" stroke="${c.D}" stroke-width="3" stroke-linecap="round"/>`,
  helmet: (c) =>
    `<path d="M50 26q8-10 16-6" stroke="${RED}" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M27 78V50a23 23 0 0 1 46 0v28H58V60H42v18z" fill="${c.P}"/><rect x="35" y="50" width="30" height="7" rx="3" fill="${INK}"/><path d="M50 60v16" stroke="${c.L}" stroke-width="3"/>`,
  flag: (c) =>
    `<rect x="26" y="18" width="5" height="62" rx="2" fill="${INK}"/><path d="M31 22h44l-9 13 9 13H31z" fill="${c.P}"/><circle cx="48" cy="35" r="6" fill="${CAB}"/>`,

  // beauty
  lipstick: (c) =>
    `<path d="M41 40V28l18-8v20z" fill="${RED}"/><rect x="40" y="40" width="20" height="12" fill="${c.P}"/><rect x="37" y="52" width="26" height="28" rx="2" fill="${INK}"/><path d="M37 60h26" stroke="${c.L}" stroke-width="2.5"/>`,
  perfume: (c) =>
    `<rect x="40" y="20" width="20" height="10" rx="3" fill="${c.L}"/><rect x="44" y="30" width="12" height="10" fill="${INK}"/><rect x="28" y="40" width="44" height="38" rx="11" fill="${c.P}"/><circle cx="50" cy="59" r="9" fill="${c.L}"/>`,
  gift: (c) =>
    `<path d="M50 34q-16-16-18-2q2 5 18 2q16 3 18-2q-2-14-18 2z" fill="${INK}"/><rect x="26" y="44" width="48" height="34" rx="3" fill="${c.P}"/><rect x="22" y="34" width="56" height="12" rx="3" fill="${c.L}"/><rect x="46" y="34" width="8" height="44" fill="${RED}"/>`,

  // books
  book: (c) =>
    `<path d="M24 28q13-4 26 3v46q-13-6-26-2z" fill="${c.P}"/><path d="M76 28q-13-4-26 3v46q13-6 26-2z" fill="${c.L}"/><path d="M30 40q8-2 14 1M30 48q8-2 14 1M56 41q6-3 14-1M56 49q6-3 14-1" stroke="${c.D}" stroke-width="2.5" fill="none"/>`,
  stack: (c) =>
    `<rect x="24" y="60" width="52" height="14" rx="2" fill="${c.P}"/><rect x="29" y="45" width="44" height="14" rx="2" fill="${c.L}"/><rect x="22" y="30" width="48" height="14" rx="2" fill="${INK}"/><path d="M28 67h10M34 52h10M28 37h10" stroke="${c.D}" stroke-width="3"/>`,
  comic: (c) =>
    `<path d="M20 26h60v36H48l-14 14V62H20z" fill="${c.P}"/><rect x="47" y="32" width="7" height="16" rx="3" fill="${RED}"/><circle cx="50.5" cy="54" r="3.5" fill="${RED}"/>`,

  // pets
  bone: (c) =>
    `<g transform="rotate(-25 50 50)" fill="${c.P}"><rect x="30" y="44" width="40" height="12" rx="4"/><circle cx="29" cy="43" r="8"/><circle cx="29" cy="57" r="8"/><circle cx="71" cy="43" r="8"/><circle cx="71" cy="57" r="8"/></g>`,
  ball: (c) =>
    `<circle cx="50" cy="50" r="26" fill="${c.P}"/><path d="M27 40q23 10 46 0M27 60q23-10 46 0" stroke="${c.L}" stroke-width="4" fill="none"/>`,
  paw: (c) =>
    `<ellipse cx="50" cy="62" rx="16" ry="13" fill="${c.P}"/><ellipse cx="30" cy="44" rx="6" ry="8" fill="${c.P}"/><ellipse cx="42" cy="32" rx="6" ry="8" fill="${c.P}"/><ellipse cx="58" cy="32" rx="6" ry="8" fill="${c.P}"/><ellipse cx="70" cy="44" rx="6" ry="8" fill="${c.P}"/>`,
  cushion: (c) =>
    `<ellipse cx="50" cy="60" rx="32" ry="18" fill="${c.P}"/><ellipse cx="50" cy="55" rx="21" ry="9" fill="${c.L}"/>${pawPrint(c)}`,
  petbowl: (c) =>
    `<path d="M32 54q4-10 10-6q4-8 10-2q6-6 10 2q6-2 6 6z" fill="${c.D}"/><rect x="22" y="52" width="56" height="7" rx="3.5" fill="${INK}"/><path d="M24 59h52l-6 18H30z" fill="${c.P}"/><circle cx="50" cy="68" r="3" fill="${c.L}"/>`,

  // tickets
  "ticket-concert": ticket(
    (c) =>
      `<path d="M38 60V42l14-4v18" stroke="${INK}" stroke-width="3.5" fill="none"/><circle cx="35" cy="60" r="4.5" fill="${INK}"/><circle cx="49" cy="56" r="4.5" fill="${INK}"/><path d="M38 46l14-4" stroke="${c.D}" stroke-width="3.5"/>`,
  ),
  "ticket-comedy": ticket(
    (c) =>
      `<rect x="36" y="36" width="10" height="16" rx="5" fill="${INK}"/><path d="M32 47a9 9 0 0 0 18 0M41 56v7M35 63h12" stroke="${c.D}" stroke-width="3" fill="none"/>`,
  ),
  "ticket-festival": ticket(
    () => `<path d="M40 34l4.7 9.6 10.6 1.5-7.6 7.4 1.8 10.5L40 58l-9.5 5 1.8-10.5-7.6-7.4 10.6-1.5z" fill="${CAB}"/>`,
  ),
  "ticket-film": ticket(
    (c) =>
      `<rect x="28" y="44" width="24" height="18" rx="2" fill="${INK}"/><path d="M28 44l3-8h24l-3 8z" fill="${c.D}"/><path d="M36 36l-3 8M44 36l-3 8" stroke="${PAPER}" stroke-width="2.5"/>`,
  ),
  "ticket-theatre": ticket(
    () =>
      `<circle cx="40" cy="50" r="12" fill="${INK}"/><circle cx="35.5" cy="46" r="2" fill="${PAPER}"/><circle cx="44.5" cy="46" r="2" fill="${PAPER}"/><path d="M34 53q6 6 12 0" stroke="${PAPER}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
  ),

  /** Anything without its own picture yet: a price tag. */
  tag: (c) =>
    `<path d="M24 30a6 6 0 0 1 6-6h22l28 28-28 28-28-28z" fill="${c.P}"/><circle cx="37" cy="37" r="5" fill="${c.B}"/><path d="M48 52l10-10" stroke="${c.L}" stroke-width="4" stroke-linecap="round"/>`,
} satisfies Record<string, Glyph>;

function pawPrint(c: Ink): string {
  return `<g fill="${c.D}"><ellipse cx="50" cy="57" rx="5" ry="4"/><circle cx="43" cy="51" r="2.2"/><circle cx="48" cy="48" r="2.2"/><circle cx="53" cy="48" r="2.2"/><circle cx="58" cy="51" r="2.2"/></g>`;
}

export type GlyphName = keyof typeof GLYPHS;

/** The picture for each category on the shelves. A shop can override one that means something else there. */
export const CATEGORY_GLYPHS: Record<string, GlyphName> = {
  vinyl: "record",
  cassette: "cassette",
  cd: "cd",
  turntable: "turntable",
  accessory: "headphones",
  merch: "merch",
  food: "bowl",
  flowers: "flowers",
  book: "book",
  gadget: "phone",
  home: "house",
  beans: "beans",
  drink: "cup",
  pastry: "croissant",
  gear: "kettle",
  currency: "coins",
  skin: "helmet",
  pass: "flag",
  shoes: "shoe",
  apparel: "shirt",
  shelving: "shelf",
  lighting: "lamp",
  storage: "box",
  sofa: "sofa",
  bedroom: "nightstand",
  household: "roll",
  cleaning: "spray",
  electrical: "battery",
  linen: "towels",
  grocery: "groceries",
  outdoor: "tent",
  ceramics: "mug",
  print: "frame",
  jewellery: "ring",
  vintage: "candle",
  textile: "yarn",
  game: "game",
  bundle: "stack",
  skincare: "jar",
  makeup: "lipstick",
  fragrance: "perfume",
  gift: "gift",
  audio: "speaker",
  computer: "laptop",
  "smart home": "plug",
  camera: "camera",
  television: "tv",
  pantry: "jar",
  dairy: "carton",
  supplement: "pill",
  dress: "dress",
  jeans: "jeans",
  jacket: "jacket",
  top: "shirt",
  treats: "bone",
  toys: "ball",
  walking: "paw",
  bedding: "cushion",
  comic: "comic",
  tools: "wrench",
  paint: "paint",
  hardware: "nut",
  garden: "plant",
  loft: "building",
  cabin: "cabin",
  cottage: "house",
  studio: "building",
  chalet: "chalet",
  houseboat: "boat",
  concert: "ticket-concert",
  comedy: "ticket-comedy",
  festival: "ticket-festival",
  film: "ticket-film",
  theatre: "ticket-theatre",
  snack: "crisps",
  frozen: "snowflake",
};

const SHOP_GLYPHS: Record<string, Record<string, GlyphName>> = {
  gamestomp: { accessory: "controller" },
  "best-bye": { accessory: "plug" },
  zaza: { accessory: "scarf" },
  petsmarty: { food: "petbowl" },
  "wholesome-foods": { drink: "bottle" },
};

/** A closer picture when the title says exactly what it is. */
const TITLE_GLYPHS: [RegExp, GlyphName][] = [
  [/slipmat/i, "slipmat"],
  [/inner sleeves?/i, "sleeve"],
  [/stylus/i, "stylus"],
  [/burger/i, "burger"],
  [/fries/i, "fries"],
  [/margherita|pizza/i, "pizza"],
  [/kettle|pour-over/i, "kettle"],
  [/plant/i, "plant"],
  [/notebook/i, "notebook"],
  [/cable/i, "plug"],
  [/power bank|batter/i, "battery"],
  [/socks/i, "sock"],
  [/hoodie/i, "hoodie"],
  [/tote/i, "bag"],
  [/headset/i, "headphones"],
  [/juice|kefir/i, "bottle"],
  [/cheddar|cheese/i, "cheese"],
  [/hammer/i, "hammer"],
  [/drill/i, "drill"],
  [/flower print|portrait/i, "frame"],
  [/hamper|gift set/i, "gift"],
];

export function glyphFor(item: Pick<Item, "title" | "category">, shop?: string): GlyphName {
  return (
    TITLE_GLYPHS.find(([re]) => re.test(item.title))?.[1] ??
    (shop ? SHOP_GLYPHS[shop]?.[item.category] : undefined) ??
    CATEGORY_GLYPHS[item.category] ??
    "tag"
  );
}

/** The item's picture: its glyph on a tile of its hue. */
export function itemArt(item: Pick<Item, "title" | "category" | "hue">, shop?: string): RawHtml {
  // Number() and the modulo keep anything but a hue out of the markup.
  const h = ((Math.round(Number(item.hue)) % 360) + 360) % 360 || 0;
  const c: Ink = {
    P: PAPER,
    L: `hsl(${h} 90% 80%)`,
    D: `hsl(${h} 55% 30%)`,
    B: `hsl(${h} 58% 50%)`,
  };
  return raw(
    `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><rect width="100" height="100" fill="${c.B}"/>${GLYPHS[glyphFor(item, shop)](c)}</svg>`,
  );
}
