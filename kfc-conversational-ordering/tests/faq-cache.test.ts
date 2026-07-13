import assert from "node:assert/strict";
import {
  isEvergreenQuestion,
  matchFaq,
  matchOrderOpener,
  normalize,
} from "../lib/faq-cache";

delete process.env.SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

// --- normalize strips punctuation and extra space --------------------------

assert.equal(
  normalize("  What time does KFC open???  "),
  "what time does kfc open",
  "normalize returns a compact ASCII-ish key",
);
assert.equal(normalize("!!!"), "", "punctuation-only input normalizes to empty");

// --- evergreen hits: hours, including a paraphrase -------------------------

const hours = matchFaq("what time do you open?");
assert.equal(hours?.id, "hours", "opening-hours question hits the curated hours FAQ");
assert.equal(isEvergreenQuestion("what time do you open?"), true, "opening-hours question is evergreen");

const hoursPlain = matchFaq("opening hours");
assert.equal(hoursPlain?.id, "hours", "short hours paraphrase hits the same FAQ");
assert.equal(hoursPlain?.say, hours?.say, "same hours entry returns the same answer");

// --- order, cart, voucher, and mixed intents must not hit FAQ ---------------

const orderIntentCases = [
  ["add 1 burger", "bare burger order opener"],
  ["apply KFC20", "voucher application command"],
  ["add 2 pieces of chicken, is it spicy?", "quantity plus FAQ-shaped phrase"],
  ["apply KFC20, any promo?", "voucher code plus promo FAQ-shaped phrase"],
  ["hello, add 1 burger", "greeting plus order intent"],
] as const;

for (const [text, label] of orderIntentCases) {
  assert.equal(matchFaq(text), null, `${label} does not hit FAQ`);
  assert.equal(isEvergreenQuestion(text), false, `${label} is not evergreen`);
}

const spiceHit = matchFaq("is it spicy?");
assert.equal(spiceHit?.id, "spice", "generic spice question hits the spice FAQ");

const bareVoucherHit = matchFaq("does KFC20 have a promotion?");
assert.equal(bareVoucherHit?.id, "promos-exist", "bare voucher-code promo question hits the promo FAQ");

// --- empty, whitespace, punctuation-only, and very long messages fall through

assert.equal(matchFaq(""), null, "empty input misses");
assert.equal(isEvergreenQuestion(""), false, "empty input is not evergreen");
assert.equal(matchFaq("   \t\n  "), null, "whitespace-only input misses");
assert.equal(isEvergreenQuestion("   \t\n  "), false, "whitespace-only input is not evergreen");
assert.equal(matchFaq("!!!"), null, "punctuation-only input misses");
assert.equal(isEvergreenQuestion("!!!"), false, "punctuation-only input is not evergreen");

const longHours =
  "what time do you open today if I am coming with a very large family group";
assert.equal(matchFaq(longHours), null, "very long FAQ-shaped input misses");
assert.equal(isEvergreenQuestion(longHours), false, "very long input is not evergreen");

// --- matchOrderOpener clarifies only bare, single-category order openers ----

const burgerOpener = await matchOrderOpener("add 1 burger");
assert.equal(burgerOpener?.id, "opener-burger", "bare burger opener gets a grounded clarifier");
assert.ok(burgerOpener?.say.includes("Burger Zinger"), "clarifier lists real burger catalog items");
assert.ok(burgerOpener?.say.includes("56,000 VND"), "clarifier includes real catalog prices");

assert.equal(await matchOrderOpener("add 1 burger zinger"), null, "specific burger order falls through");
assert.equal(await matchOrderOpener("add 1 combo 1"), null, "numbered combo (Combo 1) is specific, falls through");
assert.equal(await matchOrderOpener("add 2 combo 3"), null, "quantity + numbered combo falls through");
const bareComboOpener = await matchOrderOpener("add 1 combo");
assert.equal(bareComboOpener?.id, "opener-combo", "bare combo opener still gets the grounded clarifier");
assert.equal(await matchOrderOpener("add 1 burger and 1 pepsi"), null, "compound order falls through");
assert.equal(await matchOrderOpener("what time do you open"), null, "non-order FAQ is not an order opener");
assert.equal(await matchOrderOpener("apply KFC20"), null, "voucher command is not an order opener");
assert.equal(await matchOrderOpener("add 1 really good burger for lunch today please"), null, "long opener falls through");

// --- expanded library: common pre-cached intents hit the right entry --------

const expandedHits = [
  ["how long does delivery take?", "delivery-time"],
  ["how much is delivery?", "delivery-fee"],
  ["delivery range?", "delivery-area"],
  ["what is the best seller?", "best-seller"],
  ["my food arrived cold", "complaint"],
  ["wrong item delivered", "complaint"],
  ["how do points work?", "loyalty-program"],
  ["is there a KFC near me?", "store-locations"],
  ["holiday hours?", "holiday-hours"],
  ["are you open now?", "hours"],
  ["can I get an invoice?", "invoice"],
  ["do you have chili sauce?", "sauce"],
  ["is the chicken fresh?", "freshness"],
  ["can I book a birthday party?", "birthday-party"],
  ["what is the cheapest item?", "budget"],
  ["kids menu?", "kids-family"],
  ["do you have an app?", "app-website"],
] as const;

for (const [text, id] of expandedHits) {
  assert.equal(matchFaq(text)?.id, id, `"${text}" hits ${id}`);
}

// Guard still wins over every new entry: order-shaped messages never hit.
assert.equal(matchFaq("add 1 fried chicken then how long is delivery"), null, "order verb + FAQ phrase stays guarded");
assert.equal(matchFaq("place order, do you deliver far"), null, "checkout verb + FAQ phrase stays guarded");

console.log("faq-cache tests passed");
