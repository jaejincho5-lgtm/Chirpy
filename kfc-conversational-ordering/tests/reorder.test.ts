import assert from "node:assert/strict";
import { buildUsualFromRecords, buildUsualOrder } from "../lib/reorder";
import { createAgentRuntime } from "../lib/agent";
import {
  getHistoryStore,
  resetInMemoryHistory,
  type CompletedOrderRecord,
} from "../lib/history-store";
import type { TasteProfile } from "../lib/profile";

function rec(
  lines: Array<{ catalogId: string; quantity: number; optionIds: string[] }>,
  placedAt: string,
  totalVnd = 0,
): CompletedOrderRecord {
  return {
    customerId: "linh",
    orderId: `o_${placedAt}`,
    placedAt,
    context: { weather: "clear", hour: 12 } as CompletedOrderRecord["context"],
    lines,
    totalVnd,
  };
}

function profile(usual: TasteProfile["usual"] = null): TasteProfile {
  return {
    customerId: "linh",
    orderCount: usual ? 2 : 0,
    usual,
    attachRates: {},
    spice: null,
    declinedRecently: [],
    avgTicketVnd: 0,
  };
}

// --- exact replay of the most recent order (2 lines), correct total ----------

const replay = buildUsualFromRecords(
  [
    rec(
      [
        { catalogId: "combo-zinger", quantity: 1, optionIds: ["drink-pepsi"] },
        { catalogId: "combo-classic", quantity: 1, optionIds: [] },
      ],
      "2026-07-10T10:00:00Z",
    ),
    rec([{ catalogId: "combo-classic", quantity: 1, optionIds: [] }], "2026-07-01T10:00:00Z"),
  ],
  profile(),
);
assert.ok(replay.ok, "replay succeeds");
if (replay.ok) {
  assert.equal(replay.source, "last_order");
  assert.equal(replay.lines.length, 2, "both lines of the most recent order are replayed");
  assert.equal(replay.skipped.length, 0, "nothing skipped");
  // 79.000 (zinger, pepsi delta 0) + 59.000 (classic) = 138.000
  assert.equal(replay.totalVnd, 138000, "total is the sum of the replayed lines");
}

// --- an item removed from the catalog is skipped + reported, rest applied -----

const withGhost = buildUsualFromRecords(
  [
    rec(
      [
        { catalogId: "combo-classic", quantity: 1, optionIds: [] },
        { catalogId: "ghost-item-xyz", quantity: 1, optionIds: [] },
      ],
      "2026-07-10T10:00:00Z",
    ),
  ],
  profile(),
);
assert.ok(withGhost.ok, "partial replay still succeeds");
if (withGhost.ok) {
  assert.equal(withGhost.lines.length, 1, "the surviving line is applied");
  assert.equal(withGhost.lines[0].catalogId, "combo-classic");
  assert.equal(withGhost.skipped.length, 1, "the removed item is reported");
  assert.equal(withGhost.skipped[0], "ghost-item-xyz");
}

// --- no history at all → no_history -----------------------------------------

const none = buildUsualFromRecords([], profile(null));
assert.equal(none.ok, false, "no orders and no usual → failure");
if (!none.ok) assert.equal(none.reason, "no_history");

// --- fallback to profile.usual when the exact-replay path is empty -----------

const fallback = buildUsualFromRecords(
  [],
  profile({ catalogId: "combo-couple", optionIds: ["spice-spicy"], share: 0.5 }),
);
assert.ok(fallback.ok, "profile usual is used when there are no completed orders");
if (fallback.ok) {
  assert.equal(fallback.source, "profile_usual");
  assert.equal(fallback.lines.length, 1);
  assert.equal(fallback.lines[0].catalogId, "combo-couple");
  assert.deepEqual(fallback.lines[0].optionIds, ["spice-spicy"]);
  assert.equal(fallback.totalVnd, 189000);
}

// --- integration: reorder_usual tool applies to the live order ---------------

resetInMemoryHistory();
await getHistoryStore().recordOrder(
  rec(
    [
      { catalogId: "combo-zinger", quantity: 1, optionIds: ["drink-pepsi"] },
      { catalogId: "combo-classic", quantity: 1, optionIds: [] },
    ],
    new Date().toISOString(),
    138000,
  ),
);
const seeded = await buildUsualOrder("linh");
assert.ok(seeded.ok, "buildUsualOrder reads the seeded history");

const rt = createAgentRuntime({ sessionKey: "reorder-int", customerId: "linh" });
const applied = await (rt.tools.reorder_usual as any).execute({}, { toolCallId: "t", messages: [] });
assert.equal(applied.ok, true, "reorder_usual succeeds for a customer with history");
assert.equal(applied.applied.length, 2, "both lines land in the cart");
assert.equal(applied.order.cart.length, 2, "the live order carries the replayed cart");

// --- integration: a brand-new customer gets a graceful no-history result ------

const freshRt = createAgentRuntime({ sessionKey: "reorder-fresh", customerId: "brand-new-xyz" });
const fresh = await (freshRt.tools.reorder_usual as any).execute({}, { toolCallId: "t", messages: [] });
assert.equal(fresh.ok, false, "no crash for a first-time customer");
assert.equal(fresh.reason, "no_history");

resetInMemoryHistory();
console.log("one-phrase reorder tests passed");
