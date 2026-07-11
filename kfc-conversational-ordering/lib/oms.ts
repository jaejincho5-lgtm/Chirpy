import {
  type FulfillmentMode,
  type Handoff,
  type LoyaltyRedemption,
  type Order,
  type OrderQuote,
  type PlacedOrder,
  type VoucherApplication,
  setVoucher,
  summarizeOrder,
} from "./order";
import { MENU_CATALOG, formatVnd, getCatalogEntry, toMenuMatch } from "./menu";
import { loadVouchers, findVoucherAsync } from "./vouchers";
import { getLoyaltyStore, MAX_REDEEM_PER_ORDER } from "./loyalty";
import { isOutOfStock } from "./demo";

export async function applyVoucher(order: Order, code: string) {
  const normalizedCode = code.trim().toUpperCase();
  const rule = await findVoucherAsync(normalizedCode);

  if (!rule) {
    return {
      ok: false as const,
      code: normalizedCode,
      message: "Voucher code was not found in the mock OMS.",
      order,
    };
  }

  if (order.totals.subtotalVnd < rule.minimumSubtotalVnd) {
    return {
      ok: false as const,
      code: normalizedCode,
      message: `Minimum basket is ${formatVnd(rule.minimumSubtotalVnd)} for ${rule.code}.`,
      order,
    };
  }

  // Store the rule on the order — the actual discount is recomputed by
  // calculateTotals on every mutation, so there is no frozen amount here.
  const voucher: VoucherApplication = {
    code: rule.code,
    description: rule.description,
    discountType: rule.discountType,
    minimumSubtotalVnd: rule.minimumSubtotalVnd,
    percent: rule.percent,
    fixedVnd: rule.fixedVnd,
    maxDiscountVnd: rule.maxDiscountVnd,
    // The customer asked for this code by name — an auto-apply must never
    // replace it (see the quote_order hook in lib/agent.ts).
    appliedBy: "user",
  };

  const applied = setVoucher(order, voucher);
  return {
    ok: true as const,
    voucher,
    message: `${rule.code} applied. Discount now ${applied.totals.displayVoucherDiscount}.`,
    order: applied,
  };
}

export async function checkLoyalty(customerId = "demo-customer", redeem = false) {
  const account = await getLoyaltyStore().getAccount(customerId);
  const pointsBalance = account.points;
  const redeemablePoints = Math.min(pointsBalance, MAX_REDEEM_PER_ORDER);
  const discountVnd = Math.floor(redeemablePoints / 1000) * 1000;
  // NOTE: checking a redemption never debits points — the debit happens at
  // place_order when the order is actually settled (lib/agent.ts place_order).
  const redemption: LoyaltyRedemption = {
    customerId,
    pointsBalance,
    pointsRedeemed: redeem ? redeemablePoints : 0,
    discountVnd: redeem ? discountVnd : 0,
    displayDiscount: formatVnd(redeem ? discountVnd : 0),
  };

  return {
    ok: true as const,
    customerId,
    pointsBalance,
    lifetimePoints: account.lifetimePoints,
    redeemOptions: [
      {
        points: redeemablePoints,
        discountVnd,
        displayDiscount: formatVnd(discountVnd),
      },
    ],
    redemption,
  };
}

export function quoteOrder(
  order: Order,
  fulfillment: FulfillmentMode = "delivery",
  address?: string,
): OrderQuote {
  // Always quote the base delivery fee. The FREESHIP waiver is applied in
  // calculateTotals, so quote/voucher order no longer matters.
  const deliveryFeeVnd = fulfillment === "delivery" ? 15000 : 0;
  const etaMinutes = fulfillment === "pickup" ? 15 : order.totals.subtotalVnd > 250000 ? 35 : 28;

  return {
    fulfillment,
    address,
    deliveryFeeVnd,
    etaMinutes,
    displayDeliveryFee: formatVnd(deliveryFeeVnd),
  };
}

export function placeOrder(
  order: Order,
  paymentMethod: PlacedOrder["paymentMethod"] = "cod",
  otpVerified = false,
) {
  if (!order.cart.length) {
    return {
      ok: false as const,
      message: "Cannot place an empty order.",
    };
  }

  const outOfStockLines = order.cart.filter((line) => isOutOfStock(line.catalogId));
  if (outOfStockLines.length) {
    return {
      ok: false as const,
      code: "item_out_of_stock" as const,
      message: "Some items just went out of stock.",
      outOfStock: outOfStockLines.map((line) => ({ catalogId: line.catalogId, name: line.name })),
      substitutes: outOfStockLines.flatMap((line) => substitutesFor(line.catalogId)),
    };
  }

  // Trust ONLY the server-derived OTP state, never order.otp.verified from the
  // client. A forged otp.verified:true cannot reach here.
  if (!otpVerified) {
    return {
      ok: false as const,
      message: "OTP verification is required before placing the order.",
    };
  }

  const placedOrder: PlacedOrder = {
    orderNumber: `KFCVN-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${Math.floor(
      1000 + Math.random() * 9000,
    )}`,
    createdAt: new Date().toISOString(),
    paymentMethod,
    omsStatus: "accepted",
  };

  return {
    ok: true as const,
    placedOrder,
    message: `Order ${placedOrder.orderNumber} accepted by mock OMS.`,
  };
}

function substitutesFor(catalogId: string) {
  const item = getCatalogEntry(catalogId);
  if (!item) return [];

  return MENU_CATALOG.filter(
    (candidate) =>
      candidate.id !== item.id &&
      candidate.category === item.category &&
      candidate.available &&
      !isOutOfStock(candidate.id) &&
      Math.abs(candidate.priceVnd - item.priceVnd) <= 15000,
  )
    .sort(
      (a, b) =>
        Math.abs(a.priceVnd - item.priceVnd) - Math.abs(b.priceVnd - item.priceVnd) ||
        a.priceVnd - b.priceVnd ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 2)
    .map((candidate, index) => toMenuMatch(candidate, 1 - index * 0.01));
}

export function createHumanHandoff(order: Order, reason: string, transcriptSummary?: string): Handoff {
  const summary = transcriptSummary || summarizeOrder(order);
  return {
    reason,
    ticketId: `KFC-HANDOFF-${Math.floor(10000 + Math.random() * 90000)}`,
    summary,
    createdAt: new Date().toISOString(),
  };
}

export async function availableVoucherCodes() {
  const vouchers = await loadVouchers();
  return vouchers.map((voucher) => ({
    code: voucher.code,
    description: voucher.description,
    minimumSubtotalVnd: voucher.minimumSubtotalVnd,
    displayMinimumSubtotal: formatVnd(voucher.minimumSubtotalVnd),
  }));
}
