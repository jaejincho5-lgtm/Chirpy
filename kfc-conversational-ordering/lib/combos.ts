import {
  addToCart,
  updateCartLine,
  type CartLine,
  type Order,
} from "./order";
import { createMatchId, formatVnd, getCatalogEntry } from "./menu";

export type ComboSlot = { accepts: string[] };

// Slot contents mirror the OFFICIAL combo definitions (menu.json, 2026-07-06).
// A drink slot accepts any same-tier soft drink, matching KFC VN's swap policy.
const DRINKS = ["pepsi-std", "pepsi-medium", "7up-medium", "lipton-medium"];

export const COMBO_CONTENTS: Record<string, ComboSlot[]> = {
  // Combo 1 Fried Chicken 59k = 1 FC + FF(R) + Pepsi(STD) — itemized 70k.
  "combo-classic": [
    { accepts: ["fried-chicken-1pc"] },
    { accepts: ["fries-regular"] },
    { accepts: DRINKS },
  ],
  // Combo Burger Zinger 79k = Zinger + FF(R) + Pepsi(STD) — itemized 89k.
  "combo-zinger": [
    { accepts: ["zinger-burger"] },
    { accepts: ["fries-regular"] },
    { accepts: DRINKS },
  ],
  // Couple's Bucket 189k = 5 FC + FF(R) + 2 Pepsi(M) — official list 239k.
  "combo-couple": [
    { accepts: ["fried-chicken-1pc"] },
    { accepts: ["fried-chicken-2pc"] },
    { accepts: ["fried-chicken-2pc"] },
    { accepts: ["fries-regular"] },
    { accepts: DRINKS },
    { accepts: DRINKS },
  ],
  // Big Combo 279k = 4 FC + 2 Zinger + FF(R) + 4 Pepsi(STD) — itemized 332k.
  "combo-family-4": [
    { accepts: ["fried-chicken-2pc"] },
    { accepts: ["fried-chicken-2pc"] },
    { accepts: ["zinger-burger"] },
    { accepts: ["zinger-burger"] },
    { accepts: ["fries-regular"] },
    { accepts: DRINKS },
    { accepts: DRINKS },
    { accepts: DRINKS },
    { accepts: DRINKS },
  ],
  // Party Bucket 269k = 9 FC + 3 Pepsi(M) — official list 404k.
  "combo-party-6": [
    { accepts: ["fried-chicken-1pc"] },
    { accepts: ["fried-chicken-2pc"] },
    { accepts: ["fried-chicken-2pc"] },
    { accepts: ["fried-chicken-2pc"] },
    { accepts: ["fried-chicken-2pc"] },
    { accepts: DRINKS },
    { accepts: DRINKS },
    { accepts: DRINKS },
  ],
};

export type BillProposal = {
  swapId: string;
  savingsVnd: number;
  displaySavings: string;
  addCombos: Array<{ catalogId: string; quantity: number }>;
  consumeLines: Array<{ lineId: string; units: number }>;
  bonusItems: Array<{ catalogId: string; name: string }>;
  summary: string;
};

type Unit = {
  lineId: string;
  catalogId: string;
  priceVnd: number;
  optionNote?: string;
};

type ComboApplication = {
  comboId: string;
  matched: Unit[];
  bonusItems: Array<{ catalogId: string; name: string }>;
};

const PROPOSAL_TTL_MS = 10 * 60 * 1000;
const registry = new Map<string, { proposal: BillProposal; expires: number }>();

const COMBO_IDS = Object.keys(COMBO_CONTENTS).sort(
  (a, b) => (getCatalogEntry(b)?.priceVnd ?? 0) - (getCatalogEntry(a)?.priceVnd ?? 0),
);

export function optimizeBill(order: Order): BillProposal | null {
  const units = buildEligibleUnits(order.cart);
  if (units.length < 2) return null;

  const originalEligiblePrice = units.reduce((sum, unit) => sum + unit.priceVnd, 0);
  const plans = enumerateCounts(0, []);
  let best: { priceVnd: number; matchedUnits: number; combos: ComboApplication[]; remaining: Unit[] } | null = null;

  for (const counts of plans) {
    const applied = applyCounts(units, counts);
    if (!applied) continue;
    const comboPrice = applied.combos.reduce((sum, combo) => sum + (getCatalogEntry(combo.comboId)?.priceVnd ?? 0), 0);
    const remainingPrice = applied.remaining.reduce((sum, unit) => sum + unit.priceVnd, 0);
    const priceVnd = comboPrice + remainingPrice;
    const matchedUnits = applied.combos.reduce((sum, combo) => sum + combo.matched.length, 0);
    if (!best || matchedUnits > best.matchedUnits || (matchedUnits === best.matchedUnits && priceVnd < best.priceVnd)) {
      best = { priceVnd, matchedUnits, combos: applied.combos, remaining: applied.remaining };
    }
  }

  if (!best || !best.combos.length) return null;
  const savingsVnd = originalEligiblePrice - best.priceVnd;
  if (savingsVnd < 5000) return null;

  const proposal = makeProposal(best.combos, savingsVnd);
  registry.set(proposal.swapId, { proposal, expires: Date.now() + PROPOSAL_TTL_MS });
  return proposal;
}

export function takeProposal(swapId: string): BillProposal | undefined {
  sweepExpired();
  const entry = registry.get(swapId);
  if (!entry) return undefined;
  registry.delete(swapId);
  return entry.proposal;
}

export function applyProposal(order: Order, proposal: BillProposal): Order {
  let next = order;

  for (const consumed of proposal.consumeLines) {
    const line = next.cart.find((candidate) => candidate.lineId === consumed.lineId);
    if (!line) continue;
    next = updateCartLine(next, consumed.lineId, Math.max(0, line.quantity - consumed.units));
  }

  for (const combo of proposal.addCombos) {
    next = addToCart(next, {
      catalogId: combo.catalogId,
      matchId: createMatchId(combo.catalogId),
      quantity: combo.quantity,
      source: "search_menu",
    });
  }

  return next;
}

function buildEligibleUnits(cart: CartLine[]) {
  const units: Unit[] = [];
  for (const line of cart) {
    const item = getCatalogEntry(line.catalogId);
    if (!item || item.category === "combo" || !item.available) continue;
    if (line.options.some((option) => option.priceDeltaVnd > 0)) continue;
    const optionNote = line.options.length ? line.options.map((option) => option.name).join(", ") : undefined;
    for (let count = 0; count < line.quantity; count += 1) {
      units.push({ lineId: line.lineId, catalogId: line.catalogId, priceVnd: line.unitPriceVnd, optionNote });
    }
  }
  return units;
}

function enumerateCounts(index: number, prefix: number[]): number[][] {
  if (index === COMBO_IDS.length) return [prefix];
  const plans: number[][] = [];
  for (let count = 0; count <= 3; count += 1) {
    plans.push(...enumerateCounts(index + 1, [...prefix, count]));
  }
  return plans;
}

function applyCounts(units: Unit[], counts: number[]) {
  const remaining = [...units];
  const combos: ComboApplication[] = [];

  for (let comboIndex = 0; comboIndex < COMBO_IDS.length; comboIndex += 1) {
    const comboId = COMBO_IDS[comboIndex];
    for (let count = 0; count < counts[comboIndex]; count += 1) {
      const instance = matchCombo(comboId, remaining);
      if (!instance) return null;
      combos.push(instance);
    }
  }

  return { combos, remaining };
}

function matchCombo(comboId: string, remaining: Unit[]): ComboApplication | null {
  const slots = COMBO_CONTENTS[comboId];
  const matched: Unit[] = [];
  const matchedIndexes: number[] = [];
  const bonusItems: ComboApplication["bonusItems"] = [];

  for (const slot of slots) {
    const index = remaining.findIndex((unit, unitIndex) => !matchedIndexes.includes(unitIndex) && slot.accepts.includes(unit.catalogId));
    if (index >= 0) {
      matchedIndexes.push(index);
      matched.push(remaining[index]);
    } else {
      const catalogId = slot.accepts[0];
      const item = getCatalogEntry(catalogId);
      if (item) bonusItems.push({ catalogId, name: item.name });
    }
  }

  if (matched.length < 2) return null;
  for (const index of matchedIndexes.sort((a, b) => b - a)) {
    remaining.splice(index, 1);
  }
  return { comboId, matched, bonusItems };
}

function makeProposal(combos: ComboApplication[], savingsVnd: number): BillProposal {
  const comboCounts = new Map<string, number>();
  const consumeCounts = new Map<string, number>();
  const bonusItems: BillProposal["bonusItems"] = [];
  const optionNotes = new Set<string>();

  for (const combo of combos) {
    comboCounts.set(combo.comboId, (comboCounts.get(combo.comboId) ?? 0) + 1);
    for (const unit of combo.matched) {
      consumeCounts.set(unit.lineId, (consumeCounts.get(unit.lineId) ?? 0) + 1);
      if (unit.optionNote) optionNotes.add(unit.optionNote);
    }
    bonusItems.push(...combo.bonusItems);
  }

  const addCombos = Array.from(comboCounts.entries()).map(([catalogId, quantity]) => ({ catalogId, quantity }));
  const consumeLines = Array.from(consumeCounts.entries()).map(([lineId, units]) => ({ lineId, units }));
  const comboSummary = addCombos
    .map((combo) => `${combo.quantity}x ${getCatalogEntry(combo.catalogId)?.name ?? combo.catalogId}`)
    .join(", ");
  const bonusSummary = bonusItems.length ? ` Includes ${bonusItems.map((item) => item.name).join(", ")} as combo slots.` : "";
  const optionSummary = optionNotes.size ? ` Free customizations noted: ${Array.from(optionNotes).join("; ")}.` : "";

  return {
    swapId: makeSwapId(),
    savingsVnd,
    displaySavings: formatVnd(savingsVnd),
    addCombos,
    consumeLines,
    bonusItems,
    summary: `Swap eligible items into ${comboSummary} to save ${formatVnd(savingsVnd)}.${bonusSummary}${optionSummary}`,
  };
}

function sweepExpired() {
  const now = Date.now();
  for (const [swapId, entry] of registry.entries()) {
    if (entry.expires <= now) registry.delete(swapId);
  }
}

function makeSwapId() {
  return `swap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
