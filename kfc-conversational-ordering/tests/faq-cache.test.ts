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

// --- normalize strips Vietnamese marks, punctuation, emoji, and extra space --

assert.equal(
  normalize("  Mấy giờ KFC mở cửa??? 🍗  "),
  "may gio kfc mo cua",
  "normalize returns a compact ASCII-ish key",
);
assert.equal(normalize("🍗🔥"), "", "emoji-only input normalizes to empty");

// --- evergreen hits: hours, including a diacritic-free paraphrase ------------

const hours = matchFaq("mấy giờ mở cửa?");
assert.equal(hours?.id, "hours", "opening-hours question hits the curated hours FAQ");
assert.equal(isEvergreenQuestion("mấy giờ mở cửa?"), true, "opening-hours question is evergreen");

const hoursPlain = matchFaq("may gio mo cua");
assert.equal(hoursPlain?.id, "hours", "diacritic-free hours paraphrase hits the same FAQ");
assert.equal(hoursPlain?.say, hours?.say, "same hours entry returns the same answer");

// --- order, cart, voucher, and mixed intents must not hit FAQ ----------------

const orderIntentCases = [
  ["cho mình 1 burger", "bare burger order opener"],
  ["áp mã KFC20", "voucher application command"],
  ["cho mình 2 miếng gà có cay không", "quantity plus FAQ-shaped phrase"],
  ["áp mã KFC20 có khuyến mãi không", "voucher code plus promo FAQ-shaped phrase"],
  ["xin chào, cho mình 1 burger", "greeting plus order intent"],
] as const;

for (const [text, label] of orderIntentCases) {
  assert.equal(matchFaq(text), null, `${label} does not hit FAQ`);
  assert.equal(isEvergreenQuestion(text), false, `${label} is not evergreen`);
}

const itemSpecificHit = matchFaq("burger zinger có cay không");
// NOTE: possible bug — item-specific menu questions currently hit the generic spice FAQ; expected-correct behavior should fall through to the agent so it can answer from the live menu item.
assert.equal(itemSpecificHit?.id, "spice", "current behavior: item-specific spice question hits generic FAQ");

const bareVoucherHit = matchFaq("KFC20 có khuyến mãi không");
// NOTE: possible bug — a bare voucher-code question currently hits the generic promo FAQ; expected-correct behavior should fall through to voucher validation/live promo logic.
assert.equal(bareVoucherHit?.id, "promos-exist", "current behavior: voucher-code promo question hits generic FAQ");

// --- empty, whitespace, emoji-only, and very long messages fall through ------

assert.equal(matchFaq(""), null, "empty input misses");
assert.equal(isEvergreenQuestion(""), false, "empty input is not evergreen");
assert.equal(matchFaq("   \t\n  "), null, "whitespace-only input misses");
assert.equal(isEvergreenQuestion("   \t\n  "), false, "whitespace-only input is not evergreen");
assert.equal(matchFaq("🍗🔥"), null, "emoji-only input misses");
assert.equal(isEvergreenQuestion("🍗🔥"), false, "emoji-only input is not evergreen");

const longHours =
  "mấy giờ mở cửa hôm nay vậy em ơi mình đang đi cùng gia đình rất đông người";
assert.equal(matchFaq(longHours), null, "very long FAQ-shaped input misses");
assert.equal(isEvergreenQuestion(longHours), false, "very long input is not evergreen");

// --- matchOrderOpener clarifies only bare, single-category order openers -----

const burgerOpener = await matchOrderOpener("cho mình 1 burger");
assert.equal(burgerOpener?.id, "opener-burger", "bare burger opener gets a grounded clarifier");
assert.ok(burgerOpener?.say.includes("Burger Zinger"), "clarifier lists real burger catalog items");
assert.ok(burgerOpener?.say.includes("56.000 VND"), "clarifier includes real catalog prices");

assert.equal(await matchOrderOpener("cho mình 1 burger zinger"), null, "specific burger order falls through");
assert.equal(await matchOrderOpener("cho 1 combo 1"), null, "numbered combo (Combo 1) is specific, falls through");
assert.equal(await matchOrderOpener("cho 2 combo 3"), null, "quantity + numbered combo falls through");
const bareComboOpener = await matchOrderOpener("cho 1 combo");
assert.equal(bareComboOpener?.id, "opener-combo", "bare combo opener still gets the grounded clarifier");
assert.equal(await matchOrderOpener("cho mình 1 burger và 1 pepsi"), null, "compound order falls through");
assert.equal(await matchOrderOpener("mấy giờ mở cửa"), null, "non-order FAQ is not an order opener");
assert.equal(await matchOrderOpener("áp mã KFC20"), null, "voucher command is not an order opener");
assert.equal(await matchOrderOpener("cho mình 1 burger thật ngon cho bữa trưa hôm nay nhé"), null, "long opener falls through");

// --- expanded library: common pre-cached intents hit the right entry ---------

const expandedHits = [
  ["giao bao lâu vậy shop?", "delivery-time"],
  ["phí ship bao nhiêu vậy", "delivery-fee"],
  ["giao xa không em", "delivery-area"],
  ["món nào ngon nhất vậy?", "best-seller"],
  ["đồ ăn bị nguội quá", "complaint"],
  ["giao sai món rồi", "complaint"],
  ["tích luỹ điểm thế nào?", "loyalty-program"],
  ["gần đây có KFC không?", "store-locations"],
  ["tết có mở cửa không?", "holiday-hours"],
  ["đang mở cửa không em?", "hours"],
  ["xuất hoá đơn được không", "invoice"],
  ["có tương ớt không?", "sauce"],
  ["gà có tươi không vậy", "freshness"],
  ["đặt tiệc sinh nhật được không", "birthday-party"],
  ["món nào rẻ nhất?", "budget"],
  ["menu trẻ em có gì", "kids-family"],
  ["có app không em", "app-website"],
] as const;

for (const [text, id] of expandedHits) {
  assert.equal(matchFaq(text)?.id, id, `"${text}" hits ${id}`);
}

// Guard still wins over every new entry: order-shaped messages never hit.
assert.equal(matchFaq("cho mình 1 phần gà rồi giao bao lâu"), null, "order verb + FAQ phrase stays guarded");
assert.equal(matchFaq("đặt hàng giao xa không"), null, "checkout verb + FAQ phrase stays guarded");

console.log("faq-cache tests passed");
