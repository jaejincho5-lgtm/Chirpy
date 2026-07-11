import assert from "node:assert/strict";
import { interpretCraving } from "../lib/cravings";

const spicyCrispy = interpretCraving("gion gion cay cay duoi 100k");
const spicyIds = spicyCrispy.matches.map((match) => match.catalogId);
assert.ok(spicyIds.length > 0);
assert.ok(spicyCrispy.matches.every((match) => match.priceVnd <= 100000));
assert.ok(
  spicyIds.every((id) =>
    ["tenders-3pc", "zinger-burger", "fried-chicken-1pc", "fried-chicken-2pc"].includes(id),
  ),
);
assert.ok(
  spicyIds[0] === "tenders-3pc" || spicyIds[0] === "zinger-burger",
  "hot wings or zinger should lead crispy spicy cravings",
);

const lightFresh = interpretCraving("gi do nhe nhe mat mat");
assert.ok(
  lightFresh.matches[0]?.catalogId === "coleslaw" || lightFresh.matches[0]?.catalogId === "7up-medium",
  "light refreshing cravings should lead with coleslaw or Aquafina",
);

const notSpicy = interpretCraving("khong cay");
assert.notEqual(notSpicy.matches[0]?.catalogId, "tenders-3pc");

console.log("craving translator tests passed");
