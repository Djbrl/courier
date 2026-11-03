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
    slug: "floor-dash",
    name: "Floor Dash",
    sells: "Food and flowers, brought to your floor",
    keywords: "burger fries pizza dinner lunch takeout delivery flowers bouquet",
    resource: address("floor-dash"),
    tile: "#f0531c",
    mark: '<path d="M26 22h24M18 32h32M26 42h24" stroke="#fff" stroke-width="6" stroke-linecap="round"/><circle cx="12" cy="22" r="3" fill="#fff"/><circle cx="16" cy="42" r="3" fill="#fff"/>',
  },
  {
    slug: "amazoo",
    name: "Amazoo",
    sells: "Books, gadgets and everyday things",
    keywords: "books novels cables chargers kettle notebook home",
    resource: address("amazoo"),
    tile: "#12a150",
    mark: '<circle cx="23" cy="32" r="10" fill="#fff"/><circle cx="41" cy="32" r="10" fill="#fff"/><circle cx="25" cy="33" r="4.4" fill="#143d28"/><circle cx="43" cy="33" r="4.4" fill="#143d28"/><path d="M14 19c3-3 7-4 11-3M50 19c-3-3-7-4-11-3" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/><path d="M24 47c5 3.4 11 3.4 16 0" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/>',
  },
  {
    slug: "beanbucks",
    name: "Beanbucks",
    sells: "Coffee, pastries and beans",
    keywords: "coffee espresso latte pastries croissant beans tea",
    resource: address("beanbucks"),
    tile: "#8b5a2b",
    mark: '<path d="M19 21h26l-3 27a4 4 0 0 1-4 4H26a4 4 0 0 1-4-4z" fill="#fff"/><rect x="16" y="14" width="32" height="7" rx="3.5" fill="#e9d8c3"/><ellipse cx="32" cy="36" rx="6" ry="8" fill="#8b5a2b"/>',
  },
  {
    slug: "lord-knight",
    name: "Lord Knight",
    sells: "Game currency and skins",
    keywords: "game gaming knight bucks currency skin cosmetic battle pass",
    resource: address("lord-knight"),
    tile: "#7c3aed",
    mark: '<path d="M14 14h36v20c0 9-8 15-18 18-10-3-18-9-18-18z" fill="#f2c14e"/><path d="M21 34V22l5.5 5L32 20l5.5 7 5.5-5v12z" fill="#7c3aed"/>',
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
    slug: "ikeep",
    name: "Ikeep",
    sells: "Flat-pack furniture and storage",
    keywords: "furniture sofa shelf bookcase desk lamp bed flatpack",
    resource: address("ikeep"),
    tile: "#ff8a1f",
    mark: '<path d="M13 32 32 15l19 17v19H13z" fill="#fff"/><rect x="27" y="36" width="10" height="15" rx="2" fill="#ff8a1f"/>',
  },
  {
    slug: "juniper",
    name: config.store.name,
    sells: "Records, tapes and turntables",
    keywords: "records vinyl music jazz cassette cd turntable headphones",
    resource: STORE_RESOURCE,
    tile: "#fb7185",
    mark: '<circle cx="32" cy="32" r="21" fill="#0f1f1a"/><circle cx="32" cy="32" r="14" fill="none" stroke="#fff" stroke-width="1.4" opacity=".45"/><circle cx="32" cy="32" r="6" fill="#d9f26b"/>',
  },
  {
    slug: "walmore",
    name: "Walmore",
    sells: "Household basics in bulk",
    keywords: "supermarket household cleaning toiletries towels batteries bulk essentials",
    resource: address("walmore"),
    tile: "#dc1f3c",
    mark: '<path d="M21 27a11 12 0 0 1 22 0" fill="none" stroke="#fff" stroke-width="4"/><path d="M11 27h42l-5 25H16z" fill="#fff"/><path d="M24 34v11M32 34v11M40 34v11" stroke="#dc1f3c" stroke-width="3" stroke-linecap="round"/>',
  },
  {
    slug: "itsy",
    name: "Itsy",
    sells: "Handmade and vintage finds",
    keywords: "handmade crafts vintage jewellery ceramics prints personalised",
    resource: address("itsy"),
    tile: "#ff5fa2",
    mark: '<rect x="17" y="13" width="30" height="7" rx="3" fill="#fff"/><rect x="17" y="44" width="30" height="7" rx="3" fill="#fff"/><path d="M22 24h20M22 30h20M22 36h20M22 41h20" stroke="#fbcfe8" stroke-width="3.4" stroke-linecap="round"/>',
  },
  {
    slug: "gamestomp",
    name: "Gamestomp",
    sells: "Video games and accessories",
    keywords: "videogame console controller headset boardgame",
    resource: address("gamestomp"),
    tile: "#6366f1",
    mark: '<path d="M19 22h26c7 0 11 9 12 19 1 8-7 11-11 5l-4-5H22l-4 5c-4 6-12 3-11-5 1-10 5-19 12-19z" fill="#fff"/><path d="M21 27v8M17 31h8" stroke="#6366f1" stroke-width="3.4" stroke-linecap="round"/><circle cx="43" cy="28" r="2.6" fill="#6366f1"/><circle cx="48" cy="33" r="2.6" fill="#6366f1"/>',
  },
  {
    slug: "sephoria",
    name: "Sephoria",
    sells: "Makeup, skincare and scent",
    keywords: "makeup skincare perfume lipstick beauty moisturiser",
    resource: address("sephoria"),
    tile: "#a21caf",
    mark: '<rect x="23" y="35" width="18" height="18" rx="2.5" fill="#f2c14e"/><rect x="26" y="26" width="12" height="10" fill="#fff"/><path d="M26 26V16l12-5v15z" fill="#fda4af"/>',
  },
  {
    slug: "best-bye",
    name: "Best Bye",
    sells: "Electronics and gadgets",
    keywords: "electronics laptop television smartphone speaker camera",
    resource: address("best-bye"),
    tile: "#06b6d4",
    mark: '<path d="M15 15h19l16 16a3 3 0 0 1 0 4L35 50a3 3 0 0 1-4 0L15 34z" fill="#fff"/><circle cx="24" cy="24" r="4" fill="#06b6d4"/>',
  },
  {
    slug: "wholesome-foods",
    name: "Wholesome Foods",
    sells: "Organic and health foods",
    keywords: "organic vegan supplements vitamins granola wholefood",
    resource: address("wholesome-foods"),
    tile: "#65a30d",
    mark: '<path d="M15 49C14 27 29 14 50 14c1 21-12 36-35 35z" fill="#fff"/><path d="M15 49 38 26" stroke="#65a30d" stroke-width="3" stroke-linecap="round"/>',
  },
  {
    slug: "zaza",
    name: "Zaza",
    sells: "Clothes and accessories",
    keywords: "clothing dress jeans jacket fashion scarf",
    resource: address("zaza"),
    tile: "#f5c518",
    mark: '<path d="M26 18a6 6 0 1 1 9 5c-2 1-3 2-3 5l19 13a3 3 0 0 1-2 6H15a3 3 0 0 1-2-6l19-13" fill="none" stroke="#141414" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  {
    slug: "petsmarty",
    name: "Petsmarty",
    sells: "Pet food, toys and treats",
    keywords: "dog cat pet leash treats kibble",
    resource: address("petsmarty"),
    tile: "#2563eb",
    mark: '<ellipse cx="32" cy="41" rx="12" ry="10" fill="#fff"/><circle cx="16" cy="30" r="5" fill="#fff"/><circle cx="26" cy="20" r="5.5" fill="#fff"/><circle cx="38" cy="20" r="5.5" fill="#fff"/><circle cx="48" cy="30" r="5" fill="#fff"/>',
  },
  {
    slug: "bookworm",
    name: "Bookworm",
    sells: "Independent bookshop",
    keywords: "bookshop poetry comics paperback kids books",
    resource: address("bookworm"),
    tile: "#312e81",
    mark: '<path d="M32 21c-6-5-13-6-21-5v31c8-1 15 0 21 5 6-5 13-6 21-5V16c-8-1-15 0-21 5z" fill="#fff"/><path d="M32 21v31" stroke="#312e81" stroke-width="3"/><circle cx="43" cy="26" r="4" fill="#d9f26b"/>',
  },
  {
    slug: "home-despot",
    name: "Home Despot",
    sells: "Tools, paint and hardware",
    keywords: "tools drill paint hardware garden hammer",
    resource: address("home-despot"),
    tile: "#475569",
    mark: '<rect x="28.5" y="24" width="7" height="29" rx="3" fill="#fbbf24"/><path d="M17 13h27l6 11H17z" fill="#fff"/>',
  },
  {
    slug: "airbedd",
    name: "Airbedd",
    sells: "Short stays in lofts and cabins",
    keywords: "stay accommodation apartment loft cabin holiday rental",
    resource: address("airbedd"),
    tile: "#2dd4bf",
    mark: '<rect x="10" y="17" width="6" height="33" rx="3" fill="#fff"/><rect x="48" y="30" width="6" height="20" rx="3" fill="#fff"/><rect x="16" y="33" width="32" height="10" fill="#fff"/><rect x="19" y="24" width="14" height="9" rx="3" fill="#cffafe"/>',
  },
  {
    slug: "ticketmonster",
    name: "Ticketmonster",
    sells: "Tickets to gigs and shows",
    keywords: "tickets concert festival theatre gig show",
    resource: address("ticketmonster"),
    tile: "#ea9a00",
    mark: '<path d="M10 20h44v9a4 4 0 0 0 0 8v9H10v-9a4 4 0 0 0 0-8z" fill="#fff"/><circle cx="25" cy="30" r="4" fill="#ea9a00"/><circle cx="39" cy="30" r="4" fill="#ea9a00"/><path d="M24 39c5 3 11 3 16 0" fill="none" stroke="#ea9a00" stroke-width="3" stroke-linecap="round"/>',
  },
  {
    slug: "trader-moes",
    name: "Trader Moe’s",
    sells: "Everyday groceries and snacks",
    keywords: "groceries snacks pasta cheese frozen sauces",
    resource: address("trader-moes"),
    tile: "#134e4a",
    mark: '<path d="M36 22 16 50c-1 2 1 3 3 2l28-20c3-4 0-9-4-11-2-1-5-1-7 1z" fill="#fdba74"/><path d="M41 21c0-5 2-8 6-10M43 23c5-1 9 0 12 3M42 22c3-3 7-4 10-3" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/>',
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
