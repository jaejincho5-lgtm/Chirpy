// Voucher rules live here so both the OMS (validation/apply) and the order
// repricer (lib/order.ts calculateTotals) can share one source of truth.
// Discounts are recomputed from these rules on every mutation — nothing is
// frozen at apply time, so the order in which tools run no longer matters.

// Type-only import — erased at compile, so this does not create a runtime cycle
// with order.ts (which imports the pure discount helpers below).
import type { Order } from "./order";

export type VoucherDiscountType = "percent" | "fixed" | "free_delivery";

export type VoucherRule = {
  code: string;
  description: string;
  minimumSubtotalVnd: number;
  discountType: VoucherDiscountType;
  /** Percentage (0-100) for `percent` vouchers. */
  percent?: number;
  /** Absolute discount for `fixed` vouchers. */
  fixedVnd?: number;
  /** Cap applied to `percent` discounts. */
  maxDiscountVnd?: number;
};

export const VOUCHERS: VoucherRule[] = [
  {
    code: "KFC20",
    // Minimums rescaled 2026-07-06 when the catalog moved to official prices
    // (real combos are cheaper than the old mock ones).
    description: "20% off chicken and combo orders, capped at 60,000 VND",
    minimumSubtotalVnd: 60000,
    discountType: "percent",
    percent: 20,
    maxDiscountVnd: 60000,
  },
  {
    code: "FREESHIP",
    description: "Free delivery fee for delivery orders",
    minimumSubtotalVnd: 100000,
    discountType: "free_delivery",
  },
  {
    code: "LUNCH50",
    description: "50,000 VND off lunch baskets from 150,000 VND",
    minimumSubtotalVnd: 150000,
    discountType: "fixed",
    fixedVnd: 50000,
  },
];

export function findVoucher(code: string): VoucherRule | undefined {
  const normalized = code.trim().toUpperCase();
  return VOUCHERS.find((voucher) => voucher.code === normalized);
}

// ---------------------------------------------------------------------------
// DB-backed rules. kfc_vouchers is the live source (managed from /backend's
// Vouchers module); the VOUCHERS array above is the keyless/offline fallback
// and the seed. Cached for 60s so the agent's apply_voucher doesn't hit the
// DB on every tool call.

const VOUCHER_CACHE_TTL_MS = 60_000;
let voucherCache: { rules: VoucherRule[]; loadedAt: number } | null = null;

type VoucherRow = {
  code: string;
  description: string;
  minimum_subtotal_vnd: number;
  discount_type: VoucherDiscountType;
  discount_value: number;
  max_discount_vnd: number | null;
  starts_at: string;
  ends_at: string | null;
  is_active: boolean;
};

function ruleFromRow(row: VoucherRow): VoucherRule {
  return {
    code: row.code,
    description: row.description,
    minimumSubtotalVnd: row.minimum_subtotal_vnd,
    discountType: row.discount_type,
    percent: row.discount_type === "percent" ? row.discount_value : undefined,
    fixedVnd: row.discount_type === "fixed" ? row.discount_value : undefined,
    maxDiscountVnd: row.max_discount_vnd ?? undefined,
  };
}

export async function loadVouchers(): Promise<VoucherRule[]> {
  const hasSupabase = Boolean(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  if (!hasSupabase) return VOUCHERS;
  if (voucherCache && Date.now() - voucherCache.loadedAt < VOUCHER_CACHE_TTL_MS) {
    return voucherCache.rules;
  }
  try {
    const { supabaseAdmin } = await import("./supabase");
    const nowIso = new Date().toISOString();
    const { data, error } = await supabaseAdmin()
      .from("kfc_vouchers")
      .select("*")
      .eq("is_active", true)
      .lte("starts_at", nowIso);
    if (error) throw error;
    const rules = (data as VoucherRow[])
      .filter((row) => !row.ends_at || row.ends_at > nowIso)
      .map(ruleFromRow);
    voucherCache = { rules, loadedAt: Date.now() };
    return rules;
  } catch {
    return voucherCache?.rules ?? VOUCHERS;
  }
}

export function invalidateVoucherCache() {
  voucherCache = null;
}

export async function findVoucherAsync(code: string): Promise<VoucherRule | undefined> {
  const normalized = code.trim().toUpperCase();
  const rules = await loadVouchers();
  return rules.find((voucher) => voucher.code === normalized);
}

/**
 * Pure discount computation against the current subtotal. Free-delivery
 * vouchers waive the delivery fee (handled in calculateTotals), not the
 * subtotal, so they return 0 here.
 */
export function computeVoucherDiscount(rule: VoucherRule, subtotalVnd: number): number {
  if (subtotalVnd < rule.minimumSubtotalVnd) return 0;

  switch (rule.discountType) {
    case "percent": {
      const raw = Math.round((subtotalVnd * (rule.percent ?? 0)) / 100);
      const capped = rule.maxDiscountVnd ? Math.min(raw, rule.maxDiscountVnd) : raw;
      return Math.min(capped, subtotalVnd);
    }
    case "fixed":
      return Math.min(rule.fixedVnd ?? 0, subtotalVnd);
    case "free_delivery":
      return 0;
    default:
      return 0;
  }
}

export function isFreeDelivery(rule: Pick<VoucherRule, "discountType">): boolean {
  return rule.discountType === "free_delivery";
}

// ---------------------------------------------------------------------------
// Auto-best-voucher. Real customers don't know promo codes — so at quote time
// we find the single best eligible voucher and apply it for them. Pure over the
// order + a rule list, so it unit-tests directly (pass VOUCHERS or DB rules).

export type VoucherSaving = { rule: VoucherRule; savedVnd: number };

/**
 * Concrete VND saving `rule` would produce for `order` right now, or 0 if the
 * order does not meet the rule's minimum (⇒ ineligible). FREESHIP is only worth
 * something on a DELIVERY order that has been quoted a fee — its value is that
 * fee; on pickup or an unquoted order it saves nothing.
 */
export function voucherSavingFor(rule: VoucherRule, order: Order): number {
  const subtotalVnd = order.totals.subtotalVnd;
  if (subtotalVnd < rule.minimumSubtotalVnd) return 0;
  if (rule.discountType === "free_delivery") {
    if (order.quote?.fulfillment !== "delivery") return 0;
    return order.quote.deliveryFeeVnd;
  }
  return computeVoucherDiscount(rule, subtotalVnd);
}

/**
 * The single best eligible voucher for the order, or null if none saves
 * anything. Deterministic tie-break: larger saving wins; on an exact tie the
 * alphabetically-earlier code wins.
 */
export function bestVoucherFor(order: Order, rules: VoucherRule[] = VOUCHERS): VoucherSaving | null {
  let best: VoucherSaving | null = null;
  for (const rule of rules) {
    const savedVnd = voucherSavingFor(rule, order);
    if (savedVnd <= 0) continue;
    if (
      !best ||
      savedVnd > best.savedVnd ||
      (savedVnd === best.savedVnd && rule.code.localeCompare(best.rule.code) < 0)
    ) {
      best = { rule, savedVnd };
    }
  }
  return best;
}
