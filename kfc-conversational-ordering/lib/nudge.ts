// P2-8 — proactive nudge trigger: a demand-TIMING forecast, not an LLM.
//
// The fire decision is pure statistics over the customer's own reorder
// cadence: median gap between their completed orders is the per-customer
// demand-interval forecast; we nudge once they are meaningfully overdue
// (1.25x the median) AND the context matches an appetite window (rain or
// evening). This is the only honest sense in which the product "forecasts":
// it predicts WHEN a specific customer is likely to order again, and its
// precision is measured on held-out simulated customers in eval/nudge.ts.
//
// Guardrails (enforced at the delivery layer, stated here for the record):
// opt-in after first completed order · max 1/week · quiet hours ·
// auto-mute after 2 ignores · one-tap stop.

import { getHistoryStore } from "./history-store";
import { normalizeContext, type OrderContext } from "./reco/context";

/** Overdue multiplier: nudge only once elapsed ≥ 1.25x the customer's median gap. */
export const OVERDUE_FACTOR = 1.25;
/** Need at least this many completed orders to estimate a cadence. */
export const MIN_ORDERS_FOR_CADENCE = 3;

export type NudgeDecision = {
  fire: boolean;
  reason:
    | "fire"
    | "insufficient_history"
    | "not_overdue"
    | "context_mismatch";
  /** Per-customer demand-interval forecast (median days between orders). */
  medianGapDays: number | null;
  elapsedDays: number;
  /** elapsed must reach this to be considered overdue (median x OVERDUE_FACTOR). */
  overdueThresholdDays: number | null;
  contextMatch: boolean;
};

/**
 * Pure decision core — takes the gap series directly so the eval harness can
 * drive thousands of synthetic timelines without a store.
 */
export function decideNudge(
  gapsDays: number[],
  elapsedDays: number,
  context: OrderContext,
): NudgeDecision {
  const normalized = normalizeContext(context);
  // Appetite windows: rain (comfort food), hot afternoons (cold dessert/drink),
  // and evenings (the dinner cadence).
  const contextMatch =
    normalized.weather === "rainy" || normalized.weather === "hot" || normalized.daypart === "evening";

  if (gapsDays.length < MIN_ORDERS_FOR_CADENCE - 1) {
    return {
      fire: false,
      reason: "insufficient_history",
      medianGapDays: null,
      elapsedDays,
      overdueThresholdDays: null,
      contextMatch,
    };
  }

  const sorted = [...gapsDays].sort((a, b) => a - b);
  const medianGapDays = sorted[Math.floor(sorted.length / 2)];
  const overdueThresholdDays = medianGapDays * OVERDUE_FACTOR;
  const overdue = elapsedDays >= overdueThresholdDays;

  return {
    fire: overdue && contextMatch,
    reason: overdue ? (contextMatch ? "fire" : "context_mismatch") : "not_overdue",
    medianGapDays,
    elapsedDays,
    overdueThresholdDays,
    contextMatch,
  };
}

/** Day-granular gaps between consecutive completed orders, oldest→newest. */
export function reorderGapsDays(placedAts: string[]): number[] {
  const times = placedAts
    .map((at) => Date.parse(at))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) {
    gaps.push((times[i] - times[i - 1]) / 86_400_000);
  }
  return gaps;
}

/** Store-backed wrapper used by /api/nudge. `now` is injectable for the demo clock. */
export async function decideNudgeForCustomer(
  customerId: string,
  context: OrderContext,
  now: number = Date.now(),
): Promise<NudgeDecision & { lastPlacedAt: string | null }> {
  const orders = await getHistoryStore().getOrders(customerId, 50);
  const placedAts = orders.map((order) => order.placedAt);
  const gaps = reorderGapsDays(placedAts);
  const lastPlacedAt = placedAts.length
    ? placedAts.reduce((a, b) => (Date.parse(a) > Date.parse(b) ? a : b))
    : null;
  const elapsedDays = lastPlacedAt ? Math.max(0, (now - Date.parse(lastPlacedAt)) / 86_400_000) : 0;
  return { ...decideNudge(gaps, elapsedDays, context), lastPlacedAt };
}
