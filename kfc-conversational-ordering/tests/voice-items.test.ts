import assert from "node:assert/strict";
import { getCatalogEntry, toMenuMatch } from "../lib/menu";
import { surfacedItems, lastAssistantId, type VoiceMessage } from "../lib/voice-items";

function match(catalogId: string, score = 1) {
  const entry = getCatalogEntry(catalogId);
  assert.ok(entry, `catalog entry ${catalogId} exists`);
  return toMenuMatch(entry!, score);
}

function assistantTurn(id: string, say: string, parts: object[]): VoiceMessage {
  return { id, role: "assistant", parts: [...parts, { type: "text", text: say }] as VoiceMessage["parts"] };
}

const searchPart = (matches: object[], state: string | undefined = "output-available") => ({
  type: "tool-search_menu",
  ...(state !== undefined ? { state } : {}),
  output: { ok: true, matches },
});
const cravingPart = (matches: object[]) => ({
  type: "tool-interpret_craving",
  state: "output-available",
  output: { ok: true, matches, unmatched: false },
});

// --- named-in-say filter: exactly the mentioned items, in score order --------

const fiveMatches = [
  match("zinger-burger", 9),
  match("shrimp-burger", 7),
  match("burger-ga-yo", 6),
  match("combo-zinger", 5),
  match("pepsi-std", 2),
];
const namedTurn = [
  assistantTurn("m1", "We have Burger Zinger for 56k and Burger Shrimp for 45k. Which one would you like?", [
    searchPart(fiveMatches),
  ]),
];
const named = surfacedItems(namedTurn);
assert.deepEqual(
  named.map((m) => m.catalogId),
  ["zinger-burger", "shrimp-burger"],
  "only the items named in the spoken line surface, score-ordered",
);

// --- paraphrase fallback: top-3 by score, never a wall of cards --------------

const paraphrased = [
  assistantTurn("m2", "We have several tasty burgers. Which type would you like?", [searchPart(fiveMatches)]),
];
const fallback = surfacedItems(paraphrased);
assert.deepEqual(
  fallback.map((m) => m.catalogId),
  ["zinger-burger", "shrimp-burger", "burger-ga-yo"],
  "no names in say -> top-3 by score fallback",
);

// --- named list respects the max cap ----------------------------------------

const sixNamed = [
  match("zinger-burger", 9),
  match("shrimp-burger", 8),
  match("burger-ga-yo", 7),
  match("combo-zinger", 6),
  match("pepsi-std", 5),
  match("fries-regular", 4),
];
const bigTurn = [
  assistantTurn(
    "m3",
    "We have Burger Zinger, Burger Shrimp, Burger Yo (Chicken), Combo Burger Zinger, Pepsi (STD), and French Fries (R).",
    [searchPart(sixNamed)],
  ),
];
assert.equal(surfacedItems(bigTurn).length, 4, "named surface capped at max=4");
assert.equal(surfacedItems(bigTurn, 2).length, 2, "custom max respected");

// --- interpret_craving surfaces items too -----------------------------------

const craving = [
  assistantTurn("m4", "For crunchy spicy bites, I suggest Popcorn Chicken (R).", [
    cravingPart([match("popcorn-regular", 4), match("tenders-3pc", 3)]),
  ]),
];
assert.deepEqual(
  surfacedItems(craving).map((m) => m.catalogId),
  ["popcorn-regular"],
  "craving matches surface; only the named one is kept",
);

// --- dedupe by catalogId across both tools in one turn -----------------------

const dupTurn = [
  assistantTurn("m5", "Yes, Burger Zinger is available.", [
    searchPart([match("zinger-burger", 9)]),
    cravingPart([match("zinger-burger", 3), match("pepsi-std", 2)]),
  ]),
];
assert.deepEqual(
  surfacedItems(dupTurn).map((m) => m.catalogId),
  ["zinger-burger"],
  "same item from two tools dedupes to one card",
);

// --- streaming / malformed parts never surface ------------------------------

const streaming = [
  assistantTurn("m6", "One moment please...", [searchPart(fiveMatches, "input-available")]),
];
assert.deepEqual(surfacedItems(streaming), [], "tool part without completed output is ignored");

const malformed = [
  assistantTurn("m7", "Sure.", [
    { type: "tool-search_menu", state: "output-available", output: { ok: true } }, // no matches array
    { type: "tool-search_menu", state: "output-available" }, // no output at all
    searchPart([{ name: "ghost" }, { catalogId: 42 }]), // rows missing required fields
  ]),
];
assert.deepEqual(surfacedItems(malformed), [], "missing/malformed outputs and rows are skipped");

// --- reorder_usual is excluded ----------------------------------------------

const reorder = [
  assistantTurn("m8", "I added your usual order back to the cart.", [
    { type: "tool-reorder_usual", state: "output-available", output: { ok: true, applied: ["Burger Zinger"] } },
  ]),
];
assert.deepEqual(surfacedItems(reorder), [], "reorder_usual adds to cart directly, no popups");

// --- turn selection ----------------------------------------------------------

assert.deepEqual(surfacedItems([]), [], "no messages -> no items");
assert.deepEqual(
  surfacedItems([{ id: "u1", role: "user", parts: [{ type: "text", text: "very hungry" }] }]),
  [],
  "no assistant turn -> no items",
);

const older = assistantTurn("m9", "Yes, Burger Zinger is available.", [searchPart([match("zinger-burger", 9)])]);
const newerNoTools = assistantTurn("m10", "Where should we deliver?", []);
assert.deepEqual(
  surfacedItems([older, newerNoTools]),
  [],
  "only the LAST assistant turn counts, so older turns' cards do not linger",
);
const trailingUser: VoiceMessage = { id: "u2", role: "user", parts: [{ type: "text", text: "yes" }] };
assert.equal(
  surfacedItems([older, trailingUser]).length,
  1,
  "a trailing user message does not hide the last assistant turn's items",
);

// --- lastAssistantId keys the popup refresh ---------------------------------

assert.equal(lastAssistantId([older, trailingUser]), "m9", "keyed on the last assistant message id");
assert.equal(lastAssistantId([trailingUser]), null, "null before any assistant reply");

console.log("voice items tests passed");
