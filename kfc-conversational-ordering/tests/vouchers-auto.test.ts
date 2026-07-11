import assert from "node:assert/strict";
import { createOrder, addToCart, updateCartLine, setVoucher, type Order } from "../lib/order";
import { createMatchId } from "../lib/menu";
import { applyVoucher } from "../lib/oms";
import { createAgentRuntime } from "../lib/agent";
import {
  bestVoucherFor,
  voucherSavingFor,
  findVoucher,
  type VoucherRule,
} from "../lib/vouchers";

// bestVoucherFor / voucherSavingFor read only subtotal + quote, so we can drive
// them with a minimal synthetic order rather than a real cart.
function orderWith(
  subtotalVnd: number,
  quote?: { fulfillment: "delivery" | "pickup"; deliveryFeeVnd: number },
): Order {
  const base = createOrder();
  return {
    ...base,
    totals: { ...base.totals, subtotalVnd },
    quote: quote
      ? {
          fulfillment: quote.fulfillment,
          deliveryFeeVnd: quote.deliveryFeeVnd,
          etaMinutes: 20,
          displayDeliveryFee: String(quote.deliveryFeeVnd),
        }
      : undefined,
  };
}

// --- respects each rule's minimum -------------------------------------------

assert.equal(bestVoucherFor(orderWith(59000)), null, "59k cart: nothing is eligible");
const at60 = bestVoucherFor(orderWith(60000));
assert.ok(at60 && at60.rule.code === "KFC20", "60k cart: KFC20 becomes the best eligible voucher");
assert.equal(at60!.savedVnd, 12000, "KFC20 saves 20% of 60k = 12k (under its 60k cap)");

// --- picks the max-saving voucher among several eligible ---------------------

// 200k delivery: KFC20 = 40k, FREESHIP = 15k, LUNCH50 = 50k → LUNCH50 wins.
const multi = bestVoucherFor(orderWith(200000, { fulfillment: "delivery", deliveryFeeVnd: 15000 }));
assert.ok(multi && multi.rule.code === "LUNCH50", "picks the largest concrete saving");
assert.equal(multi!.savedVnd, 50000, "LUNCH50's fixed 50k is the max saving here");

// deterministic tie-break: equal saving → alphabetically-earlier code wins.
const tieRules: VoucherRule[] = [
  { code: "BBB", description: "", minimumSubtotalVnd: 0, discountType: "fixed", fixedVnd: 10000 },
  { code: "AAA", description: "", minimumSubtotalVnd: 0, discountType: "fixed", fixedVnd: 10000 },
];
assert.equal(bestVoucherFor(orderWith(100000), tieRules)?.rule.code, "AAA", "tie broken alphabetically");

// --- FREESHIP is valued only on a quoted delivery order ----------------------

const freeship = findVoucher("FREESHIP")!;
assert.equal(
  voucherSavingFor(freeship, orderWith(120000, { fulfillment: "delivery", deliveryFeeVnd: 15000 })),
  15000,
  "FREESHIP is worth the delivery fee on a delivery order",
);
assert.equal(
  voucherSavingFor(freeship, orderWith(120000, { fulfillment: "pickup", deliveryFeeVnd: 0 })),
  0,
  "FREESHIP saves nothing on pickup",
);
assert.equal(
  voucherSavingFor(freeship, orderWith(120000)),
  0,
  "FREESHIP saves nothing before delivery is quoted",
);

// --- hook: quote_order auto-applies the best voucher -------------------------

const autoCart = addToCart(createOrder(), {
  source: "search_menu",
  catalogId: "combo-couple",
  matchId: createMatchId("combo-couple"),
  quantity: 1,
}); // 189k
const autoRt = createAgentRuntime({ sessionKey: "av-auto", customerId: "linh", initialOrder: autoCart });
const autoRes = await (autoRt.tools.quote_order as any).execute(
  { fulfillment: "delivery" },
  { toolCallId: "t", messages: [] },
);
assert.ok(autoRes.autoAppliedVoucher, "quote_order surfaces autoAppliedVoucher");
assert.equal(autoRes.order.voucher.appliedBy, "auto", "auto voucher is tagged appliedBy=auto");
assert.equal(
  autoRes.order.voucher.code,
  autoRes.autoAppliedVoucher.code,
  "announced code matches the attached voucher",
);
assert.ok(autoRes.order.totals.voucherDiscountVnd > 0, "the saving is reflected on the order total");

// --- hook: never overrides a voucher the customer applied themselves ---------

let userCart = addToCart(createOrder(), {
  source: "search_menu",
  catalogId: "combo-family-4",
  matchId: createMatchId("combo-family-4"),
  quantity: 1,
}); // 279k → KFC20 (55.8k) would out-save the user's LUNCH50 (50k)
const userApplied = await applyVoucher(userCart, "LUNCH50");
assert.ok(userApplied.ok, "user applies LUNCH50");
userCart = userApplied.order;
assert.equal(userCart.voucher!.appliedBy, "user", "manual apply is tagged appliedBy=user");
const userRt = createAgentRuntime({ sessionKey: "av-user", customerId: "linh", initialOrder: userCart });
const userRes = await (userRt.tools.quote_order as any).execute(
  { fulfillment: "delivery" },
  { toolCallId: "t", messages: [] },
);
assert.equal(userRes.order.voucher.code, "LUNCH50", "user's chosen voucher is left untouched");
assert.equal(userRes.order.voucher.appliedBy, "user", "provenance stays user");
assert.equal(userRes.autoAppliedVoucher, undefined, "nothing is auto-announced over a user voucher");

// --- ineligible-after-shrink stays consistent (no crash, no stale discount) --

let shrink = addToCart(createOrder(), {
  source: "search_menu",
  catalogId: "combo-zinger",
  matchId: createMatchId("combo-zinger"),
  quantity: 2,
}); // 158k
shrink = setVoucher(shrink, {
  code: "LUNCH50",
  description: "",
  discountType: "fixed",
  minimumSubtotalVnd: 150000,
  fixedVnd: 50000,
  appliedBy: "auto",
});
assert.equal(shrink.totals.voucherDiscountVnd, 50000, "LUNCH50 discounts a 150k+ cart");
shrink = updateCartLine(shrink, shrink.cart[0].lineId, 1); // 79k, below LUNCH50's minimum
assert.equal(shrink.totals.voucherDiscountVnd, 0, "auto voucher zeroes out below its minimum");
assert.equal(shrink.totals.totalVnd, 79000, "total stays consistent after the cart shrinks");

console.log("auto-best-voucher tests passed");
