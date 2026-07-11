// Association-rule (co-purchase) mining.
//
// This is the single affinity computation for Project Chirpy. The live
// suggestion engine consumes rules mined here from the synthetic POS world.

import type { PosOrder } from "./pos-sim";

export type AffinityKind = "cross_sell" | "upsize";

export type AffinityRule = {
  from: string;
  to: string;
  kind: AffinityKind;
  support: number;
  confidence: number;
  lift: number;
  sampleOrders: number;
};

export type MineOptions = {
  /** Minimum co-occurring orders for a pair to become a rule. */
  minSampleOrders?: number;
  /** Keep only the top-N rules by confidence. */
  topN?: number;
};

/**
 * Mine co-purchase rules from an order log. `isCombo` classifies the consequent
 * item so combo attachments are labeled `upsize` (everything else `cross_sell`).
 */
export function mineAffinityRules(
  orders: PosOrder[],
  isCombo: (itemId: string) => boolean,
  options: MineOptions = {},
): AffinityRule[] {
  const minSampleOrders = options.minSampleOrders ?? 5;
  const topN = options.topN ?? 80;

  const itemCounts = new Map<string, number>();
  const pairCounts = new Map<string, number>();
  const totalOrders = orders.length;

  for (const order of orders) {
    const items = new Set(order.lines.map((line) => line.itemId));
    for (const item of items) itemCounts.set(item, (itemCounts.get(item) ?? 0) + 1);
    for (const from of items) {
      for (const to of items) {
        if (from === to) continue;
        const key = `${from}|${to}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }

  return Array.from(pairCounts.entries())
    .map(([key, pairOrders]) => {
      const [from, to] = key.split("|");
      const fromCount = itemCounts.get(from) ?? 1;
      const toCount = itemCounts.get(to) ?? 1;
      const confidence = pairOrders / fromCount;
      const support = pairOrders / totalOrders;
      const lift = confidence / (toCount / totalOrders);
      return {
        from,
        to,
        kind: (isCombo(to) ? "upsize" : "cross_sell") as AffinityKind,
        support,
        confidence,
        lift,
        sampleOrders: pairOrders,
      };
    })
    .filter((rule) => rule.sampleOrders >= minSampleOrders)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, topN);
}
