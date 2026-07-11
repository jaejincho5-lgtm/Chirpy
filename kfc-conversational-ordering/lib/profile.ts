import { getCatalogEntry } from "./menu";
import { getHistoryStore, type CompletedOrderRecord, type SuggestionEvent } from "./history-store";

export type TasteProfile = {
  customerId: string;
  orderCount: number;
  usual: { catalogId: string; optionIds: string[]; share: number } | null;
  attachRates: Record<string, number>;
  spice: "spicy" | "original" | null;
  declinedRecently: string[];
  declinedEver?: string[];
  avgTicketVnd: number;
};

const PRIMARY_CATEGORIES = new Set(["chicken", "burger", "rice", "combo"]);
const SPICE_OPTIONS = new Set(["spice-spicy", "spice-original", "spice-non-spicy"]);

export async function deriveProfile(customerId: string): Promise<TasteProfile> {
  const store = getHistoryStore();
  const [orders, suggestions] = await Promise.all([
    store.getOrders(customerId, 25),
    store.getSuggestions(customerId, 50),
  ]);
  return deriveProfileFromRecords(orders, suggestions, customerId);
}

export function deriveProfileFromRecords(
  orders: CompletedOrderRecord[],
  suggestions: SuggestionEvent[],
  customerId: string,
): TasteProfile {
  const sortedOrders = [...orders].sort((a, b) => Date.parse(b.placedAt) - Date.parse(a.placedAt));
  const orderCount = sortedOrders.length;
  const primaryCounts = new Map<string, number>();
  const optionCountsByPrimary = new Map<string, Map<string, number>>();
  const attachCounts = new Map<string, number>();
  const spiceCounts = new Map<"spicy" | "original", number>();

  for (const order of sortedOrders) {
    const primary = findPrimaryLine(order);
    if (!primary) continue;

    primaryCounts.set(primary.catalogId, (primaryCounts.get(primary.catalogId) ?? 0) + 1);
    const optionCounts = optionCountsByPrimary.get(primary.catalogId) ?? new Map<string, number>();
    for (const optionId of primary.optionIds) {
      optionCounts.set(optionId, (optionCounts.get(optionId) ?? 0) + 1);
    }
    optionCountsByPrimary.set(primary.catalogId, optionCounts);

    for (const line of order.lines) {
      if (line === primary) continue;
      attachCounts.set(line.catalogId, (attachCounts.get(line.catalogId) ?? 0) + 1);
    }
  }

  for (const order of sortedOrders) {
    for (const line of order.lines) {
      const item = getCatalogEntry(line.catalogId);
      if (!item || (item.category !== "chicken" && item.category !== "burger")) continue;
      for (const optionId of line.optionIds) {
        if (!SPICE_OPTIONS.has(optionId)) continue;
        const spice = optionId === "spice-spicy" ? "spicy" : "original";
        spiceCounts.set(spice, (spiceCounts.get(spice) ?? 0) + 1);
      }
    }
  }

  let usual: TasteProfile["usual"] = null;
  const modalPrimary = Array.from(primaryCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (modalPrimary && orderCount >= 2) {
    const [catalogId, count] = modalPrimary;
    const share = count / orderCount;
    if (share >= 0.4) {
      const optionCounts = optionCountsByPrimary.get(catalogId) ?? new Map<string, number>();
      const optionIds = Array.from(optionCounts.entries())
        .filter(([, optionCount]) => optionCount >= Math.ceil(count / 2))
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([optionId]) => optionId);
      usual = { catalogId, optionIds, share };
    }
  }

  const attachRates: Record<string, number> = {};
  for (const [catalogId, count] of attachCounts.entries()) {
    attachRates[catalogId] = (count + 1) / (orderCount + 2);
  }

  const spiceEntries = Array.from(spiceCounts.entries()).sort((a, b) => b[1] - a[1]);
  const spiceObservationCount = spiceEntries.reduce((sum, [, count]) => sum + count, 0);
  const spice = spiceObservationCount >= 2 ? spiceEntries[0]?.[0] ?? null : null;

  const declineCutoff = recentDeclineCutoff(sortedOrders);
  const declineCounts = new Map<string, number>();
  const declinedEver = new Set<string>();
  for (const event of suggestions) {
    if (event.action !== "declined") continue;
    declinedEver.add(event.catalogId);
    if (declineCutoff && Date.parse(event.at) < declineCutoff) continue;
    declineCounts.set(event.catalogId, (declineCounts.get(event.catalogId) ?? 0) + 1);
  }
  const declinedRecently = Array.from(declineCounts.entries())
    .filter(([, count]) => count >= 2)
    .map(([catalogId]) => catalogId)
    .sort();

  const avgTicketVnd = orderCount
    ? Math.round(sortedOrders.reduce((sum, order) => sum + order.totalVnd, 0) / orderCount)
    : 0;

  return {
    customerId,
    orderCount,
    usual,
    attachRates,
    spice,
    declinedRecently,
    declinedEver: Array.from(declinedEver).sort(),
    avgTicketVnd,
  };
}

function findPrimaryLine(order: CompletedOrderRecord) {
  return order.lines.find((line) => {
    const item = getCatalogEntry(line.catalogId);
    return item ? PRIMARY_CATEGORIES.has(item.category) : false;
  });
}

function recentDeclineCutoff(orders: CompletedOrderRecord[]) {
  if (!orders.length) return null;
  const fifthNewest = orders[Math.min(orders.length, 5) - 1];
  return Date.parse(fifthNewest.placedAt);
}
