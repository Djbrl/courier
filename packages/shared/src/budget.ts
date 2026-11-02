/** The errand budgets a person can set, in dollars. Checked in code wherever a budget comes in. */
export const BUDGET_MIN = 1;
export const BUDGET_MAX = 500;

export interface NamedBudget {
  dollars: number;
  /** The whole message was about the budget ("$20", "make it 40"), with no request in it. */
  only: boolean;
}

const NUMBER = String.raw`(\d{1,6}(?:\.\d{1,2})?)`;
const UNIT = "(?:dollars?|bucks?|usd)";
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
