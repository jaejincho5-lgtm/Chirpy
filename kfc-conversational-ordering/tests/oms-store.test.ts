import assert from "node:assert/strict";
import { addToCart, createOrder, setPlacedOrder, type Order } from "../lib/order";
import { createMatchId } from "../lib/menu";
import { getOmsStore, resetInMemoryOms, OMS_STAGE_FLOW } from "../lib/oms-store";

// Runs against the in-memory store (no Supabase env in tsx test runs).
resetInMemoryOms();
const store = getOmsStore();

function placedOrder(customerId: string): Order {
  let order = createOrder("web");
  order = { ...order, customerId };
  order = addToCart(order, {
    source: "search_menu",
    catalogId: "zinger-burger",
    matchId: createMatchId("zinger-burger"),
    quantity: 1,
  });
  return setPlacedOrder(order, {
    orderNumber: `KFCVN-TEST-${customerId}`,
    createdAt: new Date().toISOString(),
    paymentMethod: "cod",
    omsStatus: "accepted",
  });
}

const order = placedOrder("linh");
await store.createOrder(order, "KFCVN-TEST-linh");

// Full happy-path lifecycle.
const a = await store.advance(order.orderId, "preparing");
assert.ok(!("error" in a), "placed → preparing allowed");
const b = await store.advance(order.orderId, "ready");
assert.ok(!("error" in b), "preparing → ready allowed");
const c = await store.advance(order.orderId, "completed");
assert.ok(!("error" in c), "ready → completed allowed");

// Illegal transitions rejected.
const back = await store.advance(order.orderId, "preparing");
assert.ok("error" in back, "completed → preparing rejected");

// Skipping stages rejected (fresh order).
const order2 = placedOrder("guest");
await store.createOrder(order2, "KFCVN-TEST-guest");
const skip = await store.advance(order2.orderId, "completed");
assert.ok("error" in skip, "placed → completed rejected (must walk the flow)");

// Lookups.
const latest = await store.latestForCustomer("linh");
assert.ok(latest && latest.omsOrderNumber === "KFCVN-TEST-linh", "latestForCustomer finds the order");
const byNumber = await store.getByOrderNumber("KFCVN-TEST-linh");
assert.ok(byNumber && byNumber.stage === "completed", "getByOrderNumber returns current stage");

// Event timeline: placed + preparing + ready + completed = 4.
const events = await store.getEvents(order.orderId);
assert.equal(events.length, 4, "four lifecycle events recorded");

// Transition map sanity.
assert.deepEqual(OMS_STAGE_FLOW.completed, [], "completed is terminal");
assert.deepEqual(OMS_STAGE_FLOW.cancelled, [], "cancelled is terminal");

console.log("OMS store lifecycle tests passed");
