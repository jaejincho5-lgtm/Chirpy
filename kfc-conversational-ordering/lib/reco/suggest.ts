import { formatVnd, getCatalogEntry } from "../menu";
import { COMBO_CONTENTS } from "../combos";
import type { TasteProfile } from "../profile";
import { mineAffinityRules, type AffinityRule } from "./affinity";
import { getDaypart, type OrderContext } from "./context";
import { generatePosOrders } from "./pos-sim";

export const TRAIN_SEED = 1401;

const RULES = mineAffinityRules(
  generatePosOrders(4000, TRAIN_SEED),
  (id) => id.startsWith("combo-"),
  { minSampleOrders: 8, topN: 60 },
);

export type Suggestion = {
  catalogId: string;
  name: string;
  priceVnd: number;
  displayPrice: string;
  reason: string;
  source: "global" | "personal" | "blended";
  score: number;
};

export type SuggestResult = {
  decision: "suggest" | "silent";
  suggestion: Suggestion | null;
  debug: {
    trainSeed: number;
    candidateCount: number;
    topScore: number;
    wP: number;
    reason: string;
  };
};

type CartInput = Array<{ catalogId: string; quantity: number }>;

const SUGGESTIBLE_CATEGORIES = new Set(["side", "drink", "dessert"]);
const MAIN_CATEGORIES = new Set(["chicken", "burger", "rice", "combo"]);

export function suggestAddons(
  cart: CartInput,
  context: OrderContext,
  profile: TasteProfile | null,
): SuggestResult {
  if (!cart.length) return silent("empty_cart");
  if (coversMainSideDrink(cart)) return silent("complete_cart");

  // A combo line implicitly contains its slot items — suggesting fries to a
  // customer whose combo already includes fries reads as dumb or greedy (it
  // happened on the 2026-07-06 real-phone transcript). Exclusion checks run
  // against cart items PLUS everything the cart's combos contain.
  const cartIds = expandComboContents(cart);
  const candidates = collectCandidates(cartIds, context, profile);
  const wP = profile ? Math.min(0.65, profile.orderCount / (profile.orderCount + 4)) : 0;

  const scored = Array.from(candidates)
    .map((catalogId) => scoreCandidate(catalogId, cartIds, context, profile, wP))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.catalogId.localeCompare(b.catalogId));

  const top = scored[0];
  // 0.05 (was 0.08): with combo contents now excluded, surviving candidates are
  // genuinely additive — accept slightly weaker signals to suggest more often.
  if (!top || top.score < 0.05) {
    return {
      decision: "silent",
      suggestion: null,
      debug: {
        trainSeed: TRAIN_SEED,
        candidateCount: candidates.size,
        topScore: round4(top?.score ?? 0),
        wP: round4(wP),
        reason: "low_score",
      },
    };
  }

  const item = getCatalogEntry(top.catalogId)!;
  return {
    decision: "suggest",
    suggestion: {
      catalogId: item.id,
      name: item.name,
      priceVnd: item.priceVnd,
      displayPrice: formatVnd(item.priceVnd),
      reason: buildReason(top, item.name, context, profile),
      source: top.source,
      score: round4(top.score),
    },
    debug: {
      trainSeed: TRAIN_SEED,
      candidateCount: candidates.size,
      topScore: round4(top.score),
      wP: round4(wP),
      reason: "top_score",
    },
  };
}

function collectCandidates(cartIds: Set<string>, context: OrderContext, profile: TasteProfile | null) {
  const candidates = new Set<string>();
  for (const rule of RULES) {
    if (!cartIds.has(rule.from) || cartIds.has(rule.to)) continue;
    if (isSuggestible(rule.to)) candidates.add(rule.to);
  }
  if (context.weather === "rainy" && !cartIds.has("seaweed-soup") && cartHasMain(cartIds)) {
    candidates.add("seaweed-soup");
  }
  // Hot-day counterpart of the rainy special-case: iced Lipton has no mined
  // rules strong enough to surface on its own, so inject it as a candidate
  // and let the prior/multiplier rank it (the real menu has no ice cream).
  if (context.weather === "hot" && !cartIds.has("lipton-medium") && cartHasMain(cartIds)) {
    candidates.add("lipton-medium");
  }
  if (profile) {
    for (const catalogId of Object.keys(profile.attachRates)) {
      if (!cartIds.has(catalogId) && isSuggestible(catalogId)) candidates.add(catalogId);
    }
  }
  return candidates;
}

function scoreCandidate(
  catalogId: string,
  cartIds: Set<string>,
  context: OrderContext,
  profile: TasteProfile | null,
  wP: number,
) {
  const matchingRules = RULES.filter((rule) => cartIds.has(rule.from) && rule.to === catalogId);
  const global = Math.max(
    matchingRules.reduce((best, rule) => Math.max(best, globalScore(rule)), 0),
    contextualPrior(catalogId, cartIds, context),
  );
  const personal = profile ? profile.attachRates[catalogId] ?? 1 / (profile.orderCount + 2) : 0;
  const blendedBase = (1 - wP) * global + wP * personal;
  const score = blendedBase * contextMult(catalogId, context) * rejectMult(catalogId, profile);
  const globalContribution = (1 - wP) * global;
  const personalContribution = wP * personal;
  const source =
    globalContribution > 0 && personalContribution > 0
      ? "blended"
      : personalContribution > globalContribution
        ? "personal"
        : "global";

  return {
    catalogId,
    score,
    source: source as Suggestion["source"],
    global,
    personal,
    bestRule: matchingRules.sort((a, b) => globalScore(b) - globalScore(a))[0],
  };
}

function globalScore(rule: AffinityRule) {
  return (rule.confidence * Math.min(rule.lift, 3)) / 3;
}

function contextMult(catalogId: string, context: OrderContext) {
  let multiplier = 1;
  if (context.weather === "rainy") {
    if (catalogId === "seaweed-soup") multiplier *= 1.6;
    if (catalogId === "lipton-medium") multiplier *= 1.15;
    if (catalogId === "pepsi-medium" || catalogId === "7up-medium") multiplier *= 0.8;
    if (catalogId === "coleslaw") multiplier *= 0.7;
  }
  // World knowledge: hot day → cold wins, hot soup loses (mirror of the rainy block).
  if (context.weather === "hot") {
    if (catalogId === "lipton-medium") multiplier *= 1.6;
    if (catalogId === "pepsi-medium" || catalogId === "7up-medium") multiplier *= 1.15;
    if (catalogId === "seaweed-soup") multiplier *= 0.6;
  }
  if (getDaypart(context.hour) === "evening" && catalogId === "egg-tart") multiplier *= 1.25;
  return multiplier;
}

function contextualPrior(catalogId: string, cartIds: Set<string>, context: OrderContext) {
  if (catalogId === "seaweed-soup" && context.weather === "rainy" && cartHasMain(cartIds)) return 0.18;
  // World knowledge: hot day → cold dessert (same prior strength as rain→soup;
  // the real ranking power comes from contextMult, exactly like the rainy flip).
  if (catalogId === "lipton-medium" && context.weather === "hot" && cartHasMain(cartIds)) return 0.18;
  return 0;
}

function rejectMult(catalogId: string, profile: TasteProfile | null) {
  if (!profile) return 1;
  if (profile.declinedRecently.includes(catalogId)) return 0;
  if (profile.declinedEver?.includes(catalogId)) return 0.5;
  return 1;
}

function isSuggestible(catalogId: string) {
  const item = getCatalogEntry(catalogId);
  if (!item || !item.available) return false;
  return SUGGESTIBLE_CATEGORIES.has(item.category) || catalogId === "tenders-3pc";
}

/** Cart item ids plus every item the cart's combos already include. */
function expandComboContents(cart: CartInput): Set<string> {
  const ids = new Set(cart.map((line) => line.catalogId));
  for (const line of cart) {
    for (const slot of COMBO_CONTENTS[line.catalogId] ?? []) {
      for (const accepted of slot.accepts) ids.add(accepted);
    }
  }
  return ids;
}

function coversMainSideDrink(cart: CartInput) {
  let hasMainOrCombo = false;
  let hasSide = false;
  let hasDrink = false;

  for (const catalogId of expandComboContents(cart)) {
    const item = getCatalogEntry(catalogId);
    if (!item) continue;
    if (MAIN_CATEGORIES.has(item.category)) hasMainOrCombo = true;
    if (item.category === "side") hasSide = true;
    if (item.category === "drink") hasDrink = true;
  }

  return hasMainOrCombo && hasSide && hasDrink;
}

function cartHasMain(cartIds: Set<string>) {
  for (const catalogId of cartIds) {
    const item = getCatalogEntry(catalogId);
    if (item && MAIN_CATEGORIES.has(item.category)) return true;
  }
  return false;
}

function buildReason(
  candidate: ReturnType<typeof scoreCandidate>,
  itemName: string,
  context: OrderContext,
  profile: TasteProfile | null,
) {
  // Customer-facing copy (Vietnamese, chat-native). A personal reason is only
  // claimed when the customer has actually attached the item before — a
  // Laplace-smoothed score with zero real occurrences falls back to the
  // population reason instead of "0 trong 1 đơn gần đây".
  const count = profile
    ? Math.max(0, Math.round((candidate.personal ?? 0) * (profile.orderCount + 2) - 1))
    : 0;
  const isPersonal =
    (candidate.source === "personal" || candidate.source === "blended") && profile !== null && count > 0;

  let reason: string;
  if (isPersonal && profile) {
    reason = `Bạn đã thêm ${itemName} trong ${count}/${profile.orderCount} đơn gần đây.`;
  } else {
    const rule = candidate.bestRule;
    if (!rule && candidate.catalogId === "seaweed-soup" && context.weather === "rainy") {
      return "Trời đang mưa — món ấm nóng được gọi nhiều hơn hẳn hôm nay.";
    }
    if (!rule && candidate.catalogId === "lipton-medium" && context.weather === "hot") {
      return "Trời đang nóng — Lipton mát lạnh rất hợp hôm nay.";
    }
    const fromName = rule ? getCatalogEntry(rule.from)?.name ?? rule.from : "đơn tương tự";
    reason = `${Math.round((rule?.confidence ?? 0) * 100)}% khách gọi ${fromName} thêm ${itemName}.`;
  }

  if (candidate.catalogId === "seaweed-soup" && context.weather === "rainy") {
    reason += " Trời đang mưa — món ấm nóng được gọi nhiều hơn hẳn.";
  }

  return reason;
}

function silent(reason: string): SuggestResult {
  return {
    decision: "silent",
    suggestion: null,
    debug: { trainSeed: TRAIN_SEED, candidateCount: 0, topScore: 0, wP: 0, reason },
  };
}

function round4(value: number) {
  return Math.round(value * 10000) / 10000;
}

export function getMinedRulesForDebug() {
  return RULES;
}
