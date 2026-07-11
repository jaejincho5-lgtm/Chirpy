import assert from "node:assert/strict";
import { applyProposal, optimizeBill } from "../lib/combos";
import { addToCart, createOrder, type Order } from "../lib/order";
import { createMatchId } from "../lib/menu";
import { applyVoucher } from "../lib/oms";

function add(order: Order, catalogId: string, quantity = 1, optionIds: string[] = []) {
  return addToCart(order, {
    source: "search_menu",
    catalogId,
    matchId: createMatchId(catalogId),
    quantity,
    optionIds,
  });
}

let zingerOrder = createOrder();
zingerOrder = add(zingerOrder, "zinger-burger");
zingerOrder = add(zingerOrder, "fries-regular");
zingerOrder = add(zingerOrder, "pepsi-medium");
const zingerProposal = optimizeBill(zingerOrder);
assert.ok(zingerProposal, "zinger a la carte cart should produce a proposal");
assert.equal(zingerProposal.savingsVnd, 14000);
assert.deepEqual(zingerProposal.addCombos, [{ catalogId: "combo-zinger", quantity: 1 }]);
assert.equal(zingerProposal.bonusItems.length, 0);

// Big Combo 279k shape: 4 FC (2x 2pc) + 2 Zinger + fries + 4 Pepsi (STD).
// Itemized 2x74 + 2x56 + 20 + 4x13 = 332k -> official combo 279k = 53k saved.
let familyOrder = createOrder();
familyOrder = add(familyOrder, "fried-chicken-2pc", 2);
familyOrder = add(familyOrder, "zinger-burger", 2);
familyOrder = add(familyOrder, "fries-regular", 1);
familyOrder = add(familyOrder, "pepsi-std", 4);
const familyProposal = optimizeBill(familyOrder);
assert.ok(familyProposal, "family a la carte cart should produce a proposal");
assert.equal(familyProposal.savingsVnd, 53000);
assert.deepEqual(familyProposal.addCombos, [{ catalogId: "combo-family-4", quantity: 1 }]);

let customized = createOrder();
customized = add(customized, "zinger-burger");
customized = add(customized, "fries-regular", 1, ["fries-large"]);
customized = add(customized, "pepsi-medium");
assert.equal(optimizeBill(customized), null, "paid fries upsize must not be consumed by a combo swap");

const voucherResult = await applyVoucher(zingerOrder, "KFC20");
assert.equal(voucherResult.ok, true);
const proposalWithVoucher = optimizeBill(voucherResult.order);
assert.ok(proposalWithVoucher);
const swapped = applyProposal(voucherResult.order, proposalWithVoucher);
assert.equal(swapped.voucher?.code, "KFC20");
assert.ok(swapped.totals.voucherDiscountVnd > 0, "voucher discount is recomputed after combo swap");

console.log("combo optimizer tests passed");
