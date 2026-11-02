/** The errand budgets a person can set, in dollars. Checked in code wherever a budget comes in. */
export const BUDGET_MIN = 1;
export const BUDGET_MAX = 500;
/** How long a person can call a purchase back after their courier makes it, unless they pay or move on first. */
export const CALL_BACK_MS = 3 * 60 * 1000;

export interface NamedBudget {
  dollars: number;
  /** The whole message was about the budget ("$20", "make it 40"), with no request in it. */
  only: boolean;
}

const NUMBER = String.raw`(\d{1,6}(?:\.\d{1,2})?)`;
const UNIT = String.raw`(?:dollars?|bucks?|usd|\$)`;
const LEAD =
  "(?:(?:my |the |a )?budget(?: is|'s|:| of)?|make it|change (?:it|the budget) to|set (?:it|the budget) to|raise it to|lower it to|let'?s say|say|maybe|about|around|up to|max|under|i have|i've got|i got)";

const ONLY = new RegExp(
  String.raw`^(?:${LEAD}\s+)*(?:about\s+|around\s+)?(\$)?\s*${NUMBER}\s*(${UNIT})?(?:\s+(?:max|tops|total|budget|is fine|please))?$`,
);
const INLINE = [
  new RegExp(String.raw`\bbudget(?: is|'s|:| of)?\s*\$?\s*${NUMBER}`),
  new RegExp(
    String.raw`\b(?:under|below|less than|up to|max(?:imum)?(?: of)?|no more than|about|around|spend|within|have(?: about| around| got)?|got)\s*\$\s*${NUMBER}`,
  ),
  new RegExp(
    String.raw`\b(?:under|below|less than|up to|max(?:imum)?(?: of)?|no more than|about|around|spend|within|have(?: about| around| got)?|got)\s*${NUMBER}\s*${UNIT}`,
  ),
  new RegExp(String.raw`\$\s*${NUMBER}\s*(?:budget|max|tops|total|limit)\b`),
];

/**
 * The budget a person named in their own message, read by code so a model never decides a limit. A price isn't a budget:
 * "the $149 turntable" names nothing. A bare "20" only counts when the courier has just asked.
 */
export function parseBudget(message: string, expecting = false): NamedBudget | null {
  const text = message
    .toLowerCase()
    .trim()
    .replace(/[.!?,]+$/, "");
  const only = text.match(ONLY);
  if (only) {
    const clear = Boolean(only[1] || only[3]) || text !== only[2];
    return clear || expecting ? { dollars: Math.ceil(Number(only[2])), only: true } : null;
  }
  for (const pattern of INLINE) {
    const found = text.match(pattern);
    if (found) return { dollars: Math.ceil(Number(found[1])), only: false };
  }
  return null;
}

const ONES: Record<string, number> = Object.fromEntries(
  "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen"
    .split(" ")
    .map((word, i) => [word, i + 1]),
);
const TENS: Record<string, number> = Object.fromEntries(
  "twenty thirty forty fifty sixty seventy eighty ninety".split(" ").map((word, i) => [word, (i + 2) * 10]),
);

/** Every amount written in a message, in figures or in words, rounded up to whole dollars. */
function amountsIn(message: string): Set<number> {
  const text = message.toLowerCase();
  const found = new Set(
    [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => Math.ceil(Number(m[0].replace(/,/g, "")))),
  );
  let thousands = 0;
  let current = 0;
  let inNumber = false;
  const flush = () => {
    if (inNumber) found.add(thousands + current);
    thousands = current = 0;
    inNumber = false;
  };
  for (const word of text.split(/[^a-z]+/)) {
    if (word in ONES) current += ONES[word]!;
    else if (word in TENS) current += TENS[word]!;
    else if (word === "hundred") current = (current || 1) * 100;
    else if (word === "thousand") {
      thousands += (current || 1) * 1000;
      current = 0;
    } else if (word !== "and" || !inNumber) {
      flush();
      continue;
    } else continue;
    inNumber = true;
  }
  flush();
  return found;
}

/**
 * A budget the courier read from the person's message, for wording parseBudget doesn't know ("forty five, I guess"). Taken
 * only if the person actually wrote that amount in the message, so neither a model nor a shop's text can make one up.
 */
export function budgetFromCourier(proposed: unknown, message: string): number | null {
  if (typeof proposed !== "number" || !Number.isFinite(proposed) || proposed <= 0) return null;
  const dollars = Math.ceil(proposed);
  return amountsIn(message).has(dollars) ? dollars : null;
}
