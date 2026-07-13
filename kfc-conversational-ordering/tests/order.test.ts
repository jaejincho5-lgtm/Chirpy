import assert from "node:assert/strict";
import {
  addToCart,
  createOrder,
  revalidateOrder,
  repriceOrder,
  setVoucher,
  setQuote,
  CartGuardrailError,
  type CartLine,
} from "../lib/order";
import { searchMenu, getCatalogEntry, createMatchId } from "../lib/menu";
import { applyVoucher, quoteOrder, placeOrder } from "../lib/oms";
import { otpProvider } from "../lib/otp";
import { createAgentRuntime } from "../lib/agent";

const match = searchMenu("classic combo").matches[0];
assert.ok(match, "expected menu search to return a match");

const order = addToCart(createOrder(), {
  source: "search_menu",
  catalogId: match.catalogId,
  matchId: match.matchId,
  quantity: 2,
});

assert.equal(order.cart.length, 1);
assert.equal(order.cart[0].source, "search_menu");
assert.equal(order.cart[0].quantity, 2);
assert.ok(order.totals.subtotalVnd > 0);

const runtime = createAgentRuntime({ sessionKey: "customer-plumbing-test", customerId: "linh" });
const loyaltyPayload = await (runtime.tools.check_loyalty as any).execute(
  { redeem: false },
  { toolCallId: "tool-test", messages: [] },
);
assert.equal(loyaltyPayload.customerId, "linh", "loyalty defaults to the runtime customer");
assert.equal(loyaltyPayload.order.customerId, "linh", "tool payload order carries runtime customerId");

assert.throws(
  () =>
    addToCart(createOrder(), {
      source: "search_menu",
      catalogId: match.catalogId,
      matchId: "manual-price:fake",
      quantity: 1,
    }),
  (error) => error instanceof CartGuardrailError && error.code === "invalid_match_id",
  "cart must reject a line without a real search_menu matchId",
);

assert.throws(
  () =>
    addToCart(createOrder(), {
      source: "manual" as "search_menu",
      catalogId: match.catalogId,
      matchId: match.matchId,
      quantity: 1,
    }),
  (error) => error instanceof CartGuardrailError && error.code === "missing_search_match",
  "cart must reject non-search_menu sources",
);

// --- SECURITY: server re-validates client-reconstructed orders ---------------

// A crafted order with a forged cart line (real catalogId but tampered price)
// must be rebuilt from the catalog, not trusted.
const legit = getCatalogEntry("combo-classic")!;
const forgedLine: CartLine = {
  lineId: "line_forged",
  catalogId: "combo-classic",
  matchId: createMatchId("combo-classic"),
  source: "search_menu",
  name: "Classic Chicken Combo",
  vietnameseName: "combo ga ran classic",
  quantity: 1,
  unitPriceVnd: 1, // forged price
  options: [],
  totalPriceVnd: 1, // forged total
  displayUnitPrice: "1 VND",
  displayTotalPrice: "1 VND",
};
const tampered = repriceOrder({ ...createOrder(), cart: [forgedLine] });
const revalidated = revalidateOrder(tampered);
assert.equal(revalidated.order.cart.length, 1, "legit catalog line survives revalidation");
assert.equal(
  revalidated.order.cart[0].unitPriceVnd,
  legit.priceVnd,
  "forged price is overwritten with the catalog price",
);

// An entirely fake catalogId is dropped.
const fakeLine: CartLine = { ...forgedLine, catalogId: "totally-fake", matchId: "search_menu:x:totally-fake" };
const withFake = revalidateOrder(repriceOrder({ ...createOrder(), cart: [fakeLine] }));
assert.equal(withFake.order.cart.length, 0, "unknown catalog line is rejected");
assert.equal(withFake.rejected[0]?.reason, "unknown_catalog_item");

// --- SECURITY: forged otp.verified does not allow placement ------------------

const forgedOtpOrder = addToCart(createOrder(), {
  source: "search_menu",
  catalogId: match.catalogId,
  matchId: match.matchId,
  quantity: 1,
});
// Even if the client claims otp.verified, placeOrder trusts only the server flag.
const placedForged = placeOrder(forgedOtpOrder, "cod", false);
assert.equal(placedForged.ok, false, "place_order rejects when server OTP is not verified");

// A real server-verified OTP allows placement.
const key = "test-session";
const req = await otpProvider.request(key, "0901234567");
assert.ok(req.ok, "OTP request succeeds");
assert.equal(req.devCode, undefined, "OTP code is not returned unless the dev flag is set");
process.env.OTP_EXPOSE_DEV_CODE = "1";
const req2 = await otpProvider.request(`${key}-dev`, "0901234567");
assert.ok(req2.ok, "dev OTP request succeeds");
assert.ok(req2.devCode, "dev code is exposed only behind OTP_EXPOSE_DEV_CODE");
assert.equal((await otpProvider.verify(`${key}-dev`, "000000-wrong")).ok, false, "wrong OTP is rejected");
assert.equal((await otpProvider.verify(`${key}-dev`, req2.devCode!)).ok, true, "correct OTP verifies");
assert.equal(await otpProvider.isVerified(`${key}-dev`), true, "server tracks verification");
const placedReal = placeOrder(forgedOtpOrder, "cod", await otpProvider.isVerified(`${key}-dev`));
assert.equal(placedReal.ok, true, "place_order succeeds with server-verified OTP");

// --- REPRICE: voucher discount recomputed on mutation ------------------------

// Use combo-couple (189,000 — above KFC20's 80k minimum) so the 20% discount
// stays under the 60,000 cap and can be observed growing as items are added.
let vOrder = addToCart(createOrder(), {
  source: "search_menu",
  catalogId: "combo-couple",
  matchId: createMatchId("combo-couple"),
  quantity: 1,
});
const kfc20 = await applyVoucher(vOrder, "KFC20");
assert.equal(kfc20.ok, true);
if (!kfc20.ok) throw new Error("KFC20 should apply");
vOrder = kfc20.order;
const discountAfterOne = vOrder.totals.voucherDiscountVnd;
// Add another combo — the % voucher discount must grow (recomputed, not frozen).
vOrder = addToCart(vOrder, {
  source: "search_menu",
  catalogId: "combo-classic",
  matchId: createMatchId("combo-classic"),
  quantity: 1,
});
assert.ok(
  vOrder.totals.voucherDiscountVnd > discountAfterOne,
  "voucher discount is recomputed after adding items",
);

// --- FREESHIP waiver lives in calculateTotals (apply-order independent) -------

// Apply voucher AFTER quoting delivery — the fee must still be waived.
let fOrder = addToCart(createOrder(), {
  source: "search_menu",
  catalogId: "combo-family-4",
  matchId: createMatchId("combo-family-4"),
  quantity: 1,
});
fOrder = setQuote(fOrder, quoteOrder(fOrder, "delivery"));
assert.ok(fOrder.totals.deliveryFeeVnd > 0, "delivery fee charged before FREESHIP");
const freeship = await applyVoucher(fOrder, "FREESHIP");
assert.equal(freeship.ok, true);
if (!freeship.ok) throw new Error("FREESHIP should apply");
assert.equal(freeship.order.totals.deliveryFeeVnd, 0, "FREESHIP waives fee regardless of apply order");

// --- cartForNewRequest: a new request after checkout never reuses the cart ---
// Regression: "the usual" (reorder_usual) or add_to_cart in the same session as a
// placed order used to append to the already-charged cart and double every line.
{
  const { cartForNewRequest } = await import("../lib/order");
  const base = addToCart(createOrder("web"), {
    source: "search_menu",
    catalogId: match.catalogId,
    matchId: match.matchId,
    quantity: 1,
  });

  const placedStage = { ...base, stage: "placed" as const };
  const fresh = cartForNewRequest(placedStage);
  assert.equal(fresh.cart.length, 0, "placed order yields a FRESH empty cart");
  assert.equal(fresh.stage, "browsing", "fresh order starts at browsing");
  assert.equal(fresh.channel, "web", "fresh order keeps the channel");

  const readd = addToCart(fresh, {
    source: "search_menu",
    catalogId: match.catalogId,
    matchId: createMatchId(match.catalogId),
    quantity: 1,
  });
  assert.equal(readd.cart[0].quantity, 1, "re-ordering after checkout is 1x, never merged to 2x");

  const handoffStage = { ...base, stage: "handoff" as const };
  assert.equal(cartForNewRequest(handoffStage).cart.length, 0, "handoff order also yields a fresh cart");

  assert.equal(cartForNewRequest(base), base, "an active cart passes through untouched");
}

console.log("order guardrail + security + reprice tests passed");
