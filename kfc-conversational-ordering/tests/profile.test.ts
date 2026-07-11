import assert from "node:assert/strict";
import { deriveProfileFromRecords } from "../lib/profile";
import type { CompletedOrderRecord, SuggestionEvent } from "../lib/history-store";

const customerId = "linh";

function record(day: number, lines: CompletedOrderRecord["lines"], totalVnd = 120000): CompletedOrderRecord {
  return {
    customerId,
    orderId: `order-${day}`,
    placedAt: `2026-07-${String(day).padStart(2, "0")}T12:00:00.000Z`,
    context: { weather: "clear", hour: 12 },
    lines,
    totalVnd,
  };
}

const orders: CompletedOrderRecord[] = [
  record(1, [
    { catalogId: "zinger-burger", quantity: 1, optionIds: ["spice-spicy"] },
    { catalogId: "fries-regular", quantity: 1, optionIds: [] },
  ]),
  record(2, [
    { catalogId: "zinger-burger", quantity: 1, optionIds: ["spice-spicy"] },
    { catalogId: "pepsi-medium", quantity: 1, optionIds: [] },
  ]),
  record(3, [
    { catalogId: "fried-chicken-2pc", quantity: 1, optionIds: ["spice-original"] },
    { catalogId: "coleslaw", quantity: 1, optionIds: [] },
  ]),
  record(4, [
    { catalogId: "zinger-burger", quantity: 1, optionIds: ["spice-spicy"] },
    { catalogId: "seaweed-soup", quantity: 1, optionIds: [] },
  ]),
  record(5, [{ catalogId: "fried-chicken-rice", quantity: 1, optionIds: [] }]),
  record(6, [
    { catalogId: "zinger-burger", quantity: 1, optionIds: ["spice-spicy"] },
    { catalogId: "egg-tart", quantity: 1, optionIds: [] },
  ]),
];

const suggestions: SuggestionEvent[] = [
  { customerId, catalogId: "seaweed-soup", action: "declined", at: "2026-07-05T12:05:00.000Z" },
  { customerId, catalogId: "seaweed-soup", action: "declined", at: "2026-07-06T12:05:00.000Z" },
  { customerId, catalogId: "lipton-medium", action: "declined", at: "2026-07-01T12:05:00.000Z" },
];

const profile = deriveProfileFromRecords(orders, suggestions, customerId);

assert.equal(profile.customerId, customerId);
assert.equal(profile.orderCount, 6);
assert.equal(profile.usual?.catalogId, "zinger-burger");
assert.deepEqual(profile.usual?.optionIds, ["spice-spicy"]);
assert.equal(profile.spice, "spicy");
assert.ok(profile.declinedRecently.includes("seaweed-soup"));
assert.equal(profile.declinedRecently.includes("lipton-medium"), false);

console.log("profile derivation tests passed");
