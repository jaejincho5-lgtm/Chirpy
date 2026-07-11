import assert from "node:assert/strict";
import { suggestAddons } from "../lib/reco/suggest";
import type { TasteProfile } from "../lib/profile";

const zingerCart = [{ catalogId: "zinger-burger", quantity: 1 }];

const clear = suggestAddons(zingerCart, { weather: "clear", hour: 12 }, null);
assert.equal(clear.decision, "suggest");
assert.ok(
  clear.suggestion?.catalogId === "fries-regular" || clear.suggestion?.catalogId === "pepsi-medium",
  "clear zinger cart should suggest a mined fries or Pepsi add-on",
);

const rainy = suggestAddons(zingerCart, { weather: "rainy", hour: 12 }, null);
assert.equal(rainy.decision, "suggest");
assert.equal(rainy.suggestion?.catalogId, "seaweed-soup", "rainy zinger cart should flip to corn soup");

const declinedProfile: TasteProfile = {
  customerId: "linh",
  orderCount: 4,
  usual: null,
  attachRates: { "seaweed-soup": 0.8, "fries-regular": 0.3 },
  spice: null,
  declinedRecently: ["seaweed-soup"],
  declinedEver: ["seaweed-soup"],
  avgTicketVnd: 100000,
};
const declined = suggestAddons(zingerCart, { weather: "rainy", hour: 12 }, declinedProfile);
assert.notEqual(declined.suggestion?.catalogId, "seaweed-soup", "recent declines hard-suppress corn soup");

const complete = suggestAddons(
  [
    { catalogId: "combo-zinger", quantity: 1 },
    { catalogId: "fries-regular", quantity: 1 },
    { catalogId: "pepsi-medium", quantity: 1 },
  ],
  { weather: "clear", hour: 12 },
  null,
);
assert.equal(complete.decision, "silent");

console.log("suggestion engine tests passed");
