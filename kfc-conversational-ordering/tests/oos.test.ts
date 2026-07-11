import assert from "node:assert/strict";
import { clearOutOfStock, setOutOfStock } from "../lib/demo";
import { addToCart, createOrder, updateCartLine } from "../lib/order";
import { createMatchId } from "../lib/menu";
import { placeOrder } from "../lib/oms";

try {
  setOutOfStock(["pepsi-medium"]);

  let order = addToCart(createOrder(), {
    source: "search_menu",
    catalogId: "pepsi-medium",
    matchId: createMatchId("pepsi-medium"),
    quantity: 1,
  });

  const failed = placeOrder(order, "cod", true);
  assert.equal(failed.ok, false);
  assert.equal("code" in failed ? failed.code : null, "item_out_of_stock");

  const substituteIds =
    "substitutes" in failed ? (failed.substitutes ?? []).map((match) => match.catalogId) : [];
  assert.ok(substituteIds.includes("lipton-medium"));
  assert.ok(substituteIds.includes("7up-medium"));

  order = updateCartLine(order, order.cart[0].lineId, 0);
  order = addToCart(order, {
    source: "search_menu",
    catalogId: "lipton-medium",
    matchId: createMatchId("lipton-medium"),
    quantity: 1,
  });

  const placed = placeOrder(order, "cod", true);
  assert.equal(placed.ok, true);
} finally {
  clearOutOfStock();
}

console.log("out-of-stock recovery tests passed");
