// One-phrase reorder. A returning customer says "the usual" and
// the cart fills with their habitual order in ONE turn. Strategy: replay the
// most recent completed order exactly; if there are none, fall back to the
// derived TasteProfile.usual. Every line is revalidated against the live catalog
// so a menu change can never inject a stale/removed item — dropped lines are
// reported, never silently ordered.

import { addToCart, createOrder, type Order } from "./order";
import { createMatchId, formatVnd, getCatalogEntry, getMenuOption } from "./menu";
import { getHistoryStore, type CompletedOrderRecord } from "./history-store";
import { deriveProfile, type TasteProfile } from "./profile";

export type UsualLine = {
  catalogId: string;
  optionIds: string[];
  quantity: number;
  name: string;
};

export type UsualOrderResult =
  | {
      ok: true;
      source: "last_order" | "profile_usual";
      lines: UsualLine[];
      /** Item names dropped because they no longer exist / are unavailable. */
      skipped: string[];
      /** Human summary: item lines + total, e.g. "1x Zinger Burger, 1x Pepsi - 87,000 VND". */
      summary: string;
      totalVnd: number;
      displayTotal: string;
    }
  | { ok: false; reason: "no_history" };

type RawLine = { catalogId: string; optionIds: string[]; quantity: number };

// Validate a set of intended lines against the catalog by actually building them
// through the standard cart helpers (same guardrails add_to_cart enforces).
// Lines whose item is gone or unavailable are dropped and reported; option ids
// the item no longer offers are quietly filtered (the item itself still stands).
function buildFromLines(raw: RawLine[]): {
  order: Order;
  lines: UsualLine[];
  skipped: string[];
} {
  let order = createOrder();
  const lines: UsualLine[] = [];
  const skipped: string[] = [];

  for (const line of raw) {
    const item = getCatalogEntry(line.catalogId);
    if (!item || !item.available) {
      skipped.push(item?.name ?? line.catalogId);
      continue;
    }
    const quantity = Math.min(Math.max(1, Math.floor(line.quantity || 1)), 20);
    const optionIds = (line.optionIds ?? []).filter((id) => getMenuOption(item, id));
    try {
      order = addToCart(order, {
        source: "search_menu",
        catalogId: item.id,
        matchId: createMatchId(item.id),
        quantity,
        optionIds,
      });
      lines.push({ catalogId: item.id, optionIds, quantity, name: item.name });
    } catch {
      // Should not happen after the checks above, but never let a bad line crash
      // the reorder — drop and report it instead.
      skipped.push(item.name);
    }
  }

  return { order, lines, skipped };
}

function finalize(source: "last_order" | "profile_usual", built: ReturnType<typeof buildFromLines>): UsualOrderResult {
  const totalVnd = built.order.totals.totalVnd;
  const summary =
    built.order.cart.map((line) => `${line.quantity}x ${line.name}`).join(", ") + ` — ${formatVnd(totalVnd)}`;
  return {
    ok: true,
    source,
    lines: built.lines,
    skipped: built.skipped,
    summary,
    totalVnd,
    displayTotal: formatVnd(totalVnd),
  };
}

/**
 * Pure core: decide the usual from history + profile and validate it against the
 * catalog. Deterministic given the same records — unit-test this directly.
 */
export function buildUsualFromRecords(orders: CompletedOrderRecord[], profile: TasteProfile): UsualOrderResult {
  const sorted = [...orders].sort((a, b) => Date.parse(b.placedAt) - Date.parse(a.placedAt));

  // 1) Exact replay of the most recent completed order.
  if (sorted.length > 0) {
    const built = buildFromLines(
      sorted[0].lines.map((l) => ({ catalogId: l.catalogId, optionIds: l.optionIds, quantity: l.quantity })),
    );
    if (built.lines.length > 0) return finalize("last_order", built);
    // Every line was dropped (menu moved out from under the whole order) ⇒ treat
    // as no usable history rather than ordering a partial/empty cart.
    return { ok: false, reason: "no_history" };
  }

  // 2) No completed orders — fall back to the derived usual, if any.
  if (profile.usual) {
    const built = buildFromLines([
      { catalogId: profile.usual.catalogId, optionIds: profile.usual.optionIds, quantity: 1 },
    ]);
    if (built.lines.length > 0) return finalize("profile_usual", built);
  }

  return { ok: false, reason: "no_history" };
}

/**
 * Build the customer's usual order from their stored history + taste profile.
 */
export async function buildUsualOrder(customerId: string): Promise<UsualOrderResult> {
  const store = getHistoryStore();
  const [orders, profile] = await Promise.all([
    store.getOrders(customerId, 25),
    deriveProfile(customerId),
  ]);
  return buildUsualFromRecords(orders, profile);
}
