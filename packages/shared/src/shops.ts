import { config, STORE_RESOURCE } from "./config.ts";
import { type RawHtml, raw } from "./html.ts";

/**
 * The shops a courier can visit, all pretend. The names are parodies and the marks are drawn for this project: never a
 * real brand's logo, colours or product names, because these pages sit next to a PayPal sign-in. Each shop is its own
 * MCP server with its own address, so shops only ever see a pseudonym made for them.
 */
export interface Shop {
  slug: string;
  name: string;
  /** What it sells, in a few words. Shown to people and to the model. */
  sells: string;
  /** Things to ask for, so the model picks the right shop. */
  keywords: string;
  /** RFC 8707 audience of this shop's MCP server. */
  resource: string;
  /** Tile colour behind the mark. */
  tile: string;
  mark: string;
}

const address = (slug: string) => `${config.store.url}/${slug}/mcp`;

export const SHOPS: Shop[] = [
  {
    slug: "amazoo",
    name: "Amazoo",
    sells: "Books, gadgets and everyday things",
    keywords: "books novels cables chargers kettle notebook home",
    resource: address("amazoo"),
    tile: "#1f7a4d",
    mark: '<circle cx="23" cy="32" r="10" fill="#fff"/><circle cx="41" cy="32" r="10" fill="#fff"/><circle cx="25" cy="33" r="4.4" fill="#143d28"/><circle cx="43" cy="33" r="4.4" fill="#143d28"/><path d="M14 19c3-3 7-4 11-3M50 19c-3-3-7-4-11-3" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/><path d="M24 47c5 3.4 11 3.4 16 0" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/>',
  },
  {
    slug: "floor-dash",
    name: "Floor Dash",
    sells: "Food and flowers, brought to your floor",
    keywords: "burger fries pizza dinner lunch takeout delivery flowers bouquet",
    resource: address("floor-dash"),
    tile: "#c2410c",
    mark: '<path d="M26 22h24M18 32h32M26 42h24" stroke="#fff" stroke-width="6" stroke-linecap="round"/><circle cx="12" cy="22" r="3" fill="#fff"/><circle cx="16" cy="42" r="3" fill="#fff"/>',
  },
  {
    slug: "lord-knight",
    name: "Lord Knight",
    sells: "Game currency and skins",
    keywords: "game gaming knight bucks currency skin cosmetic battle pass",
    resource: address("lord-knight"),
    tile: "#4c2a85",
    mark: '<path d="M14 14h36v20c0 9-8 15-18 18-10-3-18-9-18-18z" fill="#f2c14e"/><path d="M21 34V22l5.5 5L32 20l5.5 7 5.5-5v12z" fill="#4c2a85"/>',
  },
  {
    slug: "mike",
    name: "Mike",
    sells: "Shoes and sportswear",
    keywords: "shoes sneakers trainers running socks shirt hoodie sportswear",
    resource: address("mike"),
    tile: "#17171a",
    mark: '<path d="M12 44 19 18h7l6 14 12-14h8l-7 26h-7l4-15-10 12h-5l-4-12-4 15z" fill="#fff"/><path d="M8 52h48" stroke="#ff5a36" stroke-width="4" stroke-linecap="round"/>',
  },
  {
    slug: "juniper",
    name: config.store.name,
    sells: "Records, tapes and turntables",
    keywords: "records vinyl music jazz cassette cd turntable headphones",
    resource: STORE_RESOURCE,
    tile: "#2f5d50",
    mark: '<circle cx="32" cy="32" r="21" fill="#0f1f1a"/><circle cx="32" cy="32" r="14" fill="none" stroke="#fff" stroke-width="1.4" opacity=".45"/><circle cx="32" cy="32" r="6" fill="#d9f26b"/>',
  },
];

export const JUNIPER = SHOPS.find((s) => s.slug === "juniper")!;

export const findShop = (slug: string | undefined) => SHOPS.find((s) => s.slug === slug);
export const shopForResource = (resource: string) => SHOPS.find((s) => s.resource === resource);

/** Finds a shop the way a person or model names it: "floor-dash", "Floor Dash" or "floordash". */
export function shopNamed(name: string): Shop | undefined {
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const wanted = squash(name);
  return SHOPS.find((s) => squash(s.slug) === wanted || squash(s.name) === wanted);
}

/** A shop's logo tile. The mark comes from the list above, never from a person or a model. */
export function shopLogo(shop: Shop, className = ""): RawHtml {
  return raw(
    `<span class="slogo ${className}" style="background:${shop.tile}" aria-hidden="true"><svg viewBox="0 0 64 64">${shop.mark}</svg></span>`,
  );
}
