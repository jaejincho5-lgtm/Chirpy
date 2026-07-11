import { getCatalogEntry, normalizeText, toMenuMatch, type MenuMatch } from "./menu";

type Axis =
  | "crispy"
  | "spicy"
  | "light"
  | "heavy"
  | "warm"
  | "refreshing"
  | "sweet"
  | "shareable"
  | "kids";

type Vector = Partial<Record<Axis, number>>;

export type CravingResult = {
  matches: MenuMatch[];
  budgetVnd: number | null;
  matchedAxes: Axis[];
  unmatched: boolean;
};

const ITEM_VECTORS: Record<string, Vector> = {
  "fried-chicken-1pc": { crispy: 0.9, spicy: 0.4, heavy: 0.5, warm: 0.8 },
  "fried-chicken-2pc": { crispy: 0.9, spicy: 0.4, heavy: 0.7, warm: 0.8, shareable: 0.3 },
  "tenders-3pc": { crispy: 0.8, spicy: 0.9, heavy: 0.4, warm: 0.8 },
  "popcorn-regular": { crispy: 0.8, spicy: 0.3, heavy: 0.4, warm: 0.7, kids: 0.7 },
  "zinger-burger": { crispy: 0.7, spicy: 0.8, heavy: 0.6, warm: 0.7 },
  "shrimp-burger": { crispy: 0.6, spicy: 0.2, heavy: 0.5, warm: 0.7 },
  "fried-chicken-rice": { heavy: 0.6, warm: 0.8, light: 0.3, sweet: 0.2 },
  "fried-chicken-pasta": { heavy: 0.5, warm: 0.8, kids: 0.8, sweet: 0.3 },
  "combo-classic": { crispy: 0.9, spicy: 0.4, heavy: 0.9, warm: 0.8, shareable: 0.2 },
  "combo-zinger": { crispy: 0.7, spicy: 0.8, heavy: 0.8, warm: 0.7, shareable: 0.2 },
  "combo-family-4": { heavy: 0.8, warm: 0.8, shareable: 1.0 },
  "combo-party-6": { heavy: 0.9, warm: 0.8, shareable: 1.0 },
  "fries-regular": { crispy: 0.8, light: 0.3, warm: 0.6, kids: 0.6 },
  "seaweed-soup": { warm: 1.0, light: 0.7, sweet: 0.3 },
  coleslaw: { refreshing: 0.9, light: 0.9 },
  "egg-tart": { sweet: 0.9, warm: 0.5, light: 0.5, kids: 0.5 },
  "pepsi-medium": { refreshing: 0.8, sweet: 0.6 },
  "lipton-medium": { refreshing: 0.9, light: 0.7, sweet: 0.4 },
  "7up-medium": { refreshing: 0.9, light: 0.6, sweet: 0.5 },
};

const LEXICON: Record<Axis, string[]> = {
  crispy: ["gion", "gion rum", "crispy", "crunchy"],
  spicy: ["cay", "spicy", "hot"],
  light: ["nhe", "thanh", "khong dau mo", "light", "not heavy", "healthy"],
  heavy: ["no", "chac bung", "filling", "hungry", "doi"],
  warm: ["am", "nong", "soup", "sup", "warm"],
  refreshing: ["mat", "giai khat", "refreshing", "thirsty", "khat"],
  sweet: ["ngot", "sweet", "trang mieng", "dessert"],
  shareable: ["nhom", "chia se", "share", "party", "ban be"],
  kids: ["tre em", "cho be", "kids", "con"],
};

export function interpretCraving(craving: string): CravingResult {
  const normalized = normalizeText(craving);
  const budgetVnd = parseBudget(craving);
  const queryVec: Record<Axis, number> = {
    crispy: 0,
    spicy: 0,
    light: 0,
    heavy: 0,
    warm: 0,
    refreshing: 0,
    sweet: 0,
    shareable: 0,
    kids: 0,
  };
  const matchedAxes = new Set<Axis>();

  for (const [axis, terms] of Object.entries(LEXICON) as Array<[Axis, string[]]>) {
    for (const term of terms) {
      const normalizedTerm = normalizeText(term);
      if (!phraseMatches(normalized, normalizedTerm)) continue;
      const negated = isNegated(normalized, normalizedTerm);
      queryVec[axis] += negated ? -1 : 1;
      matchedAxes.add(axis);
    }
  }

  if (!matchedAxes.size) {
    return { matches: [], budgetVnd, matchedAxes: [], unmatched: true };
  }

  const matches = Object.entries(ITEM_VECTORS)
    .map(([catalogId, vector]) => {
      const item = getCatalogEntry(catalogId);
      if (!item || !item.available) return null;
      if (budgetVnd !== null && item.priceVnd > budgetVnd) return null;
      const comboPenalty = item.category === "combo" && queryVec.heavy <= 0 && queryVec.shareable <= 0 ? 0.75 : 1;
      const score = scoreVector(queryVec, vector) * comboPenalty;
      if (score <= 0) return null;
      return { item, score };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(Boolean(b.item.popular)) - Number(Boolean(a.item.popular)) ||
        a.item.priceVnd - b.item.priceVnd,
    )
    .slice(0, 3)
    .map(({ item, score }) => toMenuMatch(item, Math.round(score * 10000) / 10000));

  return { matches, budgetVnd, matchedAxes: Array.from(matchedAxes), unmatched: false };
}

function parseBudget(craving: string) {
  const normalized = normalizeText(craving);
  const explicit = /(?:duoi|toi da|under|below|<)\s*(\d{2,3})\s*k/.exec(normalized);
  const fallback = /(\d{2,3})\s*k(?:\s|$)/.exec(normalized);
  const match = explicit ?? fallback;
  return match ? Number(match[1]) * 1000 : null;
}

function scoreVector(queryVec: Record<Axis, number>, itemVec: Vector) {
  return (Object.keys(queryVec) as Axis[]).reduce(
    (sum, axis) => sum + queryVec[axis] * (itemVec[axis] ?? 0),
    0,
  );
}

function phraseMatches(text: string, phrase: string) {
  return new RegExp(`(?:^|\\s)${escapeRegExp(phrase)}(?:\\s|$)`).test(text);
}

function isNegated(text: string, phrase: string) {
  return new RegExp(`(?:^|\\s)(?:khong|not|no)\\s+${escapeRegExp(phrase)}(?:\\s|$)`).test(text);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
