// Instant FAQ cache for the KFC ambassador. A curated library of evergreen,
// order-neutral answers that we can serve locally in ~1ms instead of waking
// Opus 4.8 for common opening-hours questions. Governed by one rule: NEVER WRONG.
//
// How "never wrong" is enforced:
//   1. Only evergreen, context-free facts live here. Nothing that depends on
//      live data (prices, addresses, promo codes, points, stock, order status)
//      is ever cached — those always fall through to the real agent.
//   2. A hard NEGATIVE GUARD: if the message carries any ordering/mutation
//      signal (an order verb, a quantity, a phone number), we bail immediately
//      and let the state machine handle it, even if an FAQ phrase also matches.
//   3. Strict matching: the message must be short/question-shaped AND contain a
//      curated multi-word trigger phrase. A paraphrase that misses simply falls
//      through to Opus (slower, but always correct). A miss is free; a wrong
//      hit is not, so we bias hard toward missing.
//
// Two matchers live here:
//   matchFaq()          — sync, order-NEUTRAL info questions (never touches menu)
//   matchOrderOpener()  — async, a bare single-category order opener ("cho 1
//                         burger") answered with a GROUNDED clarifier built from
//                         the live catalog. Never mutates the cart; it only asks
//                         which item, then the real agent adds it next turn.

import { searchMenuGrounded } from "./menu";

export type FaqHit = { id: string; say: string };

type FaqEntry = {
  id: string;
  /** Normalized substrings; if any appears in the normalized message, this entry matches. */
  triggers: string[];
  /** One or more voice-safe answers; a deterministic one is picked per message. */
  answers: string[];
};

/** Lowercase, strip Vietnamese diacritics, drop punctuation, collapse spaces. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // combining accent marks
    .replace(/\u0111/g, "d")
    .replace(/[^a-z0-9\s]/g, " ") // punctuation, emoji → space
    .replace(/\s+/g, " ")
    .trim();
}

// ---- negative guard --------------------------------------------------------
// If any of these fire, the message is (or might be) an order/checkout action.
// We never serve a cached answer for it — the agent + Order state machine must
// run. Guard verbs are deliberately SPECIFIC phrases so that policy questions
// policy questions still pass while imperatives do not.

const GUARD_PHRASES = [
  // add / order imperatives
  "cho minh",
  "cho toi",
  "cho em xin",
  "lay cho",
  "them mot",
  "them 1",
  "them phan",
  "them combo",
  "them ly",
  "goi mon",
  "dat mon",
  "dat hang",
  "dat 1",
  "dat combo",
  "chot don",
  "len don",
  "mua ngay",
  "add one",
  "add 1",
  "add to cart",
  "get me",
  "i want",
  "i would like",
  "place order",
  "order now",
  // cart edits
  "bo mon",
  "xoa mon",
  "doi mon",
  "doi sang",
  "bot di",
  // vouchers / loyalty (mutating)
  "ap ma",
  "ap dung ma",
  "dung ma",
  "nhap ma",
  "apply ",
  "apply code",
  "apply voucher",
  "use code",
  "dung diem",
  "doi diem",
  "tich diem",
  // checkout / fulfilment / handoff
  "xacn",
  "thanh toan luon",
  "giao toi",
  "giao den",
  "giao ve",
  "giao gium",
  "giao gap",
  "ship toi",
  "ship den",
  "gapn vien",
  "gap nguoi",
  "so dien thoai cua",
];

// A quantity like "2 pieces", "1 combo", "3 drinks", or a phone-length digit run.
const QUANTITY_RE = /\b\d+\s*(mieng|phan|combo|ly|cai|suat|hop|phi|ban|piece|pieces|drink|drinks|burger|burgers|meal|meals|item|items)\b/;
const PHONE_RE = /\d{9,}/;

function looksLikeOrder(norm: string): boolean {
  if (QUANTITY_RE.test(norm) || PHONE_RE.test(norm)) return true;
  return GUARD_PHRASES.some((p) => norm.includes(p));
}

// ---- the library -----------------------------------------------------------
// Order matters: earlier entries win on overlap. Safety-critical deflection
// (allergen/halal/nutrition) is first so it can never lose to a factual entry;
// the generic greeting is last so more specific intents win.

const LIBRARY: FaqEntry[] = [
  {
    // Safety deflection: never assert a health/dietary fact we can't guarantee.
    id: "allergen-halal-nutrition",
    triggers: [
      "co halal khong",
      "halal khong",
      "chungn halal",
      "co gluten",
      "bao nhieu calo",
      "bao nhieu calory",
      "bao nhieu calories",
      "gay di ung",
      "di ung khong",
      "thanh phan gi",
      "co chat gi",
      "do chay",
      "mon chay",
      "an chay",
    ],
    answers: [
      "For nutrition, allergen, or halal details, please check the packaging or ask store staff so you get the most accurate information.",
    ],
  },
  {
    // Complaints get an instant apology + handoff, never a canned excuse. Early
    // in the library so a complaint phrase can never lose to a factual entry.
    id: "complaint",
    triggers: [
      "khieu nai",
      "phan nan",
      "bi nguoi",
      "do an nguoi",
      "bi thieu mon",
      "giao thieu mon",
      "giao sai mon",
      "don bi sai",
      "giao sai roi",
      "lam roi vai",
      "te qua",
      "that vong",
      "phuc vu kem",
      "food arrived cold",
      "wrong item delivered",
      "missing item",
      "bad service",
    ],
    answers: [
      "I am sorry about that experience. Tell me which order or item had the issue, and I will pass it to support right away.",
    ],
  },
  {
    id: "hours",
    triggers: [
      "may gio mo",
      "gio mo cua",
      "mo cua may gio",
      "mo cua luc may",
      "may gio dong",
      "gio dong cua",
      "dong cua luc may",
      "bao gio mo",
      "bao gio dong",
      "gio mo cua the nao",
      "mo cua den may gio",
      "gio hoat dong",
      "dang mo cua khong",
      "dang mo khong",
      "con mo khong",
      "gio co mo khong",
      "mo cua chua",
      "what time do you open",
      "when do you open",
      "are you open",
      "what time do you close",
      "opening hours",
    ],
    answers: [
      "KFC usually opens around 9:00 AM and closes around 10:00 PM, but hours vary by branch. Please check your nearest store to be sure.",
    ],
  },
  {
    id: "holiday-hours",
    triggers: [
      "tet co mo",
      "le co mo",
      "co mo cua tet",
      "co mo tet khong",
      "nghi tet khong",
      "nghi le khong",
      "le tet co ban",
      "holiday hours",
      "open on holidays",
      "open during holidays",
      "open on tet",
    ],
    answers: [
      "Most KFC stores stay open through holidays, but hours can vary by branch. Please check your nearest store before visiting.",
    ],
  },
  {
    id: "delivery-policy",
    triggers: [
      "co giao hang khong",
      "co ship khong",
      "co giao khong",
      "giao hang khong",
      "ship khong vay",
      "co giao tan noi",
      "giao tan khong",
      "co ban mang ve",
      "an tai cho khong",
      "co cho ngoi khong",
      "co ghe ngoi khong",
      "do you deliver",
      "delivery available",
      "can i get delivery",
      "can i pick up",
      "takeaway available",
      "do you have seating",
    ],
    answers: [
      "KFC supports delivery and counter pickup. Would you like delivery or pickup?",
    ],
  },
  {
    id: "delivery-time",
    triggers: [
      "giao bao lau",
      "ship bao lau",
      "bao lau thi giao",
      "bao lau thi toi",
      "bao laun duoc",
      "giao co lau khong",
      "giaonh khong",
      "shipnh khong",
      "cho bao lau",
      "mat bao lau",
      "how long is delivery",
      "delivery time",
      "how long does delivery take",
      "is delivery fast",
    ],
    answers: [
      "Delivery is usually around 20 to 40 minutes depending on distance and peak hours. I will show the exact estimate when you confirm the order.",
    ],
  },
  {
    id: "delivery-fee",
    triggers: [
      "phi ship bao nhieu",
      "phi ship the nao",
      "phi giao hang",
      "ship bao nhieu tien",
      "phi van chuyen",
      "tien ship",
      "mat phi ship",
      "co tinh phi ship",
      "free ship khong",
      "co freeship",
      "mien phi giao hang",
      "mien phi ship",
      "delivery fee",
      "how much is delivery",
      "how much is shipping",
      "free delivery",
    ],
    answers: [
      "Delivery fee depends on distance and is shown before you confirm. There may also be free-delivery promos.",
    ],
  },
  {
    id: "delivery-area",
    triggers: [
      "giao xa khong",
      "co giao xa",
      "giao ngoai thanh",
      "co giao tinh",
      "khu vuc giao",
      "pham vi giao",
      "xa co giao khong",
      "delivery area",
      "do you deliver far",
      "delivery range",
      "outside delivery area",
    ],
    answers: [
      "Delivery range depends on the nearest branch. Share your address at checkout and the system will confirm availability.",
    ],
  },
  {
    id: "min-order",
    triggers: [
      "don toi thieu",
      "toi thieu bao nhieu",
      "mua toi thieu",
      "co toi thieu khong",
      "gia tri toi thieu",
      "minimum order",
      "minimum spend",
    ],
    answers: [
      "Choose what you like first. If delivery needs a minimum order value, I will show it clearly before checkout.",
    ],
  },
  {
    id: "payment",
    triggers: [
      "thanh toan the nao",
      "thanh toan bang gi",
      "thanh toan sao",
      "tra tien the nao",
      "tra bang gi",
      "tra tien mat",
      "co the tin dung",
      "co momo khong",
      "co zalopay",
      "co vi dien tu",
      "tra sau khong",
      "co cod khong",
      "how can i pay",
      "cash on delivery",
      "pay by card",
      "pay with wallet",
    ],
    answers: [
      "You can pay with cash, card, or wallets such as MoMo/ZaloPay on delivery or at the counter.",
    ],
  },
  {
    id: "invoice",
    triggers: [
      "xuat hoa don",
      "hoa don do",
      "hoa don vat",
      "lay hoa don",
      "co hoa don khong",
      "xuat vat",
      "vat invoice",
      "can i get an invoice",
      "electronic invoice",
    ],
    answers: [
      "KFC can support VAT invoices on request. Please tell staff when receiving the order or at the counter.",
    ],
  },
  {
    id: "spice",
    triggers: [
      "co spicy khong",
      "spicy khong vay",
      "mon nao spicy",
      "co mon spicy",
      "co mon khong spicy",
      "an spicy duoc khong",
      "ga co spicy",
      "spicy nhieu khong",
      "do spicy the nao",
      "spicy lam khong",
      "is it spicy",
      "which chicken is spicy",
      "what is not spicy",
      "non spicy",
      "not spicy",
    ],
    answers: [
      "Original crispy chicken is not spicy. Hot & Spicy has a bolder mild heat. Which flavor would you like?",
    ],
  },
  {
    id: "sauce",
    triggers: [
      "co tuong ot khong",
      "co tuong ca",
      "co sot khong",
      "sot gi khong",
      "co mayonnaise",
      "co sot mayo",
      "kem sot gi",
      "co cham gi",
      "xin them tuong",
      "do you have sauce",
      "ketchup",
      "chili sauce",
      "extra sauce",
    ],
    answers: [
      "Chili sauce and ketchup are included. Tell me at checkout if you want extra sauce.",
    ],
  },
  {
    id: "best-seller",
    triggers: [
      "mon nao ngon",
      "mon gi ngon",
      "ngont",
      "best seller",
      "ban chayt",
      "mon nao hot",
      "nen an gi",
      "an gi ngon",
      "nen thu mon nao",
      "mon nao dang thu",
      "mon nao noi tieng",
      "dac san la gi",
      "best seller",
      "what is good",
      "what should i eat",
      "most popular",
      "best item",
    ],
    answers: [
      "Best-sellers include Original Recipe Fried Chicken, Hot & Spicy Chicken, and the Zinger Burger. Do you prefer chicken, burger, or a value combo?",
    ],
  },
  {
    id: "budget",
    triggers: [
      "mon nao re",
      "ret la gi",
      "gia ret",
      "it tient",
      "tiet kiemt",
      "an gi re",
      "ngan sach it",
      "sinh vien ngheo",
      "cheap item",
      "cheapest item",
      "budget meal",
      "under budget",
      "value option",
    ],
    answers: [
      "There are plenty of value options. Give me a budget, for example under 100k, and I will find the best fit 💸",
    ],
  },
  {
    id: "portion",
    triggers: [
      "may mieng",
      "bao nhieu mieng",
      "gom nhung gi",
      "gom mon gi",
      "co nhung gi ben trong",
      "trong combo co gi",
      "mot phan co gi",
      "what is included",
      "what comes in",
      "how many pieces",
    ],
    answers: [
      "It depends on the item or combo. Tell me which one you mean and I will list what it includes with the price.",
    ],
  },
  {
    id: "kids-family",
    triggers: [
      "cho tre em",
      "tre em an duoc",
      "menu tre em",
      "phan tre em",
      "be an duoc khong",
      "cho be an",
      "con nit an",
      "do choi khong",
      "an ca gia dinh",
      "phan gia dinh",
      "kids menu",
      "for kids",
      "family meal",
      "for the family",
    ],
    answers: [
      "Original fried chicken, mashed potato, and soup are good family-friendly choices. How many people are eating?",
    ],
  },
  {
    id: "freshness",
    triggers: [
      "ga co tuoi khong",
      "co tuoi khong",
      "chien moi khong",
      "lam moi khong",
      "co nong khong",
      "con nong khong",
      "do an nong khong",
      "de lau chua",
      "co gion khong",
      "is it fresh",
      "is the chicken fresh",
      "chicken fresh",
      "freshly fried",
      "is it hot",
      "is it crispy",
    ],
    answers: [
      "KFC fries chicken throughout the day so it is served hot and crisp.",
    ],
  },
  {
    id: "birthday-party",
    triggers: [
      "dat tiec",
      "to chuc sinht",
      "tiec sinht",
      "lam sinht",
      "tiec cong ty",
      "dat cho nhieu nguoi",
      "dai gia dinh",
      "nhom dong nguoi",
      "birthday party",
      "group order",
      "large order",
      "office party",
    ],
    answers: [
      "KFC supports birthdays and group orders. For an in-store party, contact your nearest branch; for large food orders, I can help build the order here.",
    ],
  },
  {
    id: "loyalty-program",
    triggers: [
      "diem thuong la gi",
      "diem la gi",
      "chuong trinh diem",
      "tich luy diem",
      "the thanh vien",
      "co the thanh vien",
      "loyalty",
      "diem thuong dung sao",
      "diem dung lam gi",
      "loyalty program",
      "how do points work",
      "earn points",
      "redeem points",
    ],
    answers: [
      "Orders earn KFC points automatically. Points can be redeemed for discounts at checkout when eligible.",
    ],
  },
  {
    id: "store-locations",
    triggers: [
      "cua hang o dau",
      "chinh o dau",
      "co chinh nao",
      "gan day co kfc",
      "kfc gant",
      "cua hang gant",
      "dia chi cua hang",
      "dia chi o dau",
      "co cua hang o",
      "o dau vay shop",
      "store near me",
      "kfc near me",
      "nearest store",
      "where is kfc",
      "store location",
    ],
    answers: [
      "KFC has branches across major cities. Check kfcvietnam.com.vn or the KFC app for the nearest store, or order delivery here.",
    ],
  },
  {
    id: "hotline",
    triggers: [
      "so tong dai",
      "tong dai bao nhieu",
      "hotline bao nhieu",
      "so hotline",
      "lien he the nao",
      "cham soc khach hang",
      "hotline",
      "customer service",
      "contact number",
    ],
    answers: [
      "Please check the official hotline on kfcvietnam.com.vn. You can also message me here for ordering help.",
    ],
  },
  {
    id: "app-website",
    triggers: [
      "co app khong",
      "dat qua app",
      "tai app o dau",
      "co website khong",
      "dat online duoc khong",
      "dat qua mang",
      "do you have an app",
      "kfc app",
      "kfc website",
      "order online",
    ],
    answers: [
      "KFC has the KFC Vietnam app and kfcvietnam.com.vn. You can also order with me here without installing anything.",
    ],
  },
  {
    id: "wifi-seating",
    triggers: ["co wifi", "wifi khong", "pass wifi", "co cho sac", "o cam dien", "wifi", "charging outlet"],
    answers: [
      "Most branches have seating and many offer Wi-Fi, depending on the store. Ask staff at the counter for details.",
    ],
  },
  {
    id: "promos-exist",
    triggers: [
      "co khuyen mai khong",
      "co uu dai khong",
      "co ma giam gia khong",
      "co voucher khong",
      "promotion",
      "promo",
      "dang co khuyen mai",
      "khuyen mai gi khong",
      "co deal khong",
      "co giam gia khong",
      "co combo tiet kiem",
      "any promotion",
      "any promos",
      "any vouchers",
      "discount code",
      "deals today",
    ],
    answers: [
      "There are often promos available. Tell me what you want to order and I will check eligible codes or value combos.",
    ],
  },
  {
    id: "capabilities",
    triggers: [
      "ban lam duoc gi",
      "em lam duoc gi",
      "ban giup duoc gi",
      "giup duoc nhung gi",
      "lam duoc nhung gi",
      "ban biet gi",
      "em biet lam gi",
      "cach dung the nao",
      "dung nhu the nao",
      "noi gi voi em",
      "noi gi bay gio",
      "what can you do",
      "how do i use this",
      "help me order",
    ],
    answers: [
      "Tell me an item name or a craving like 'spicy under 100k'. I can find items, add them to cart, apply promos, and help checkout.",
    ],
  },
  {
    id: "identity",
    triggers: [
      "ban la ai",
      "em la ai",
      "la ai vay",
      "ban ten gi",
      "em ten gi",
      "ban la gi",
      "em la con gi",
      "la robot a",
      "co phai nguoi that",
      "co phai nguoi khong",
      "co phai ga that",
      "ban la ga",
      "la ga a",
      "co phai ai khong",
      "who are you",
      "are you real",
      "are you an ai",
      "what is your name",
    ],
    answers: [
      "I am KFC's virtual Chicken Ambassador, here to help you order quickly.",
    ],
  },
  {
    id: "language",
    triggers: [
      "noi tieng anh",
      "speak english",
      "english khong",
      "noi duoc tieng anh",
      "co tieng anh khong",
      "can you speak english",
      "do you speak english",
    ],
    answers: [
      "I can speak English. Tell me what you would like to order.",
    ],
  },
  {
    id: "thanks",
    triggers: ["cam on", "cam on em", "cam on nhe", "cam on ban", "thank you", "thanks nhe", "tks em"],
    answers: [
      "You're welcome. Tell me if you need anything else 🍗",
    ],
  },
  {
    id: "goodbye",
    triggers: ["tam biet", "chao tam biet", "het roi nhe", "khong can nua", "thoi nhe", "bye bye", "goodbye"],
    answers: [
      "Thanks for choosing KFC. See you next time 🐔",
    ],
  },
  {
    id: "greeting",
    triggers: [
      "xin chao",
      "chao em",
      "chao shop",
      "chao ban",
      "hello em",
      "hello shop",
      "alo em",
      "alo shop",
      "chao ad",
      "hi em",
      "hi shop",
      "hey em",
      "chao buoi sang",
      "chao buoi toi",
    ],
    answers: [
      "Hi, I am the KFC Chicken Ambassador. What would you like today?",
    ],
  },
];

/** Deterministic pick so identical questions always get the identical answer. */
function pickAnswer(entry: FaqEntry, norm: string): string {
  if (entry.answers.length === 1) return entry.answers[0];
  let sum = 0;
  for (let i = 0; i < norm.length; i++) sum += norm.charCodeAt(i);
  return entry.answers[sum % entry.answers.length];
}

const MAX_WORDS = 12;

/**
 * Try to answer `text` from the local library. Returns null (→ fall through to
 * the real agent) unless the message is a short, order-neutral question that
 * confidently matches one curated intent.
 */
/**
 * The exact gate matchFaq applies before it will serve a canned line: the
 * message must be non-empty, short/question-shaped (≤ MAX_WORDS words), and
 * carry NO ordering/mutation signal. The learned answer cache (lib/answer-cache)
 * reuses this so both cache layers share one definition of "safe to cache" — a
 * message that fails this must always reach the real agent.
 */
export function isEvergreenQuestion(text: string): boolean {
  const norm = normalize(text ?? "");
  if (!norm) return false;
  if (norm.split(" ").length > MAX_WORDS) return false;
  if (looksLikeOrder(norm)) return false;
  return true;
}

export function matchFaq(text: string): FaqHit | null {
  const raw = (text ?? "").trim();
  if (!raw) return null;

  const norm = normalize(raw);
  if (!norm) return null;

  // Short / question-shaped only — long messages carry too much intent to be
  // safely reduced to a canned line.
  if (norm.split(" ").length > MAX_WORDS) return null;

  // Never intercept anything that looks like an order or checkout action.
  if (looksLikeOrder(norm)) return null;

  for (const entry of LIBRARY) {
    if (entry.triggers.some((trigger) => norm.includes(trigger))) {
      return { id: entry.id, say: pickAnswer(entry, norm) };
    }
  }

  return null;
}

// ---- grounded order-opener clarifier ---------------------------------------
// "one burger" -> "which burger?" built from the LIVE catalog, so it lists only
// real, in-stock items with real prices and can never go stale. Fires ONLY for a
// short, single-category opener with no specific item and no second item; a
// specific ("burger zinger") or compound ("burger and fries") request falls
// through so the real agent (and its state machine) handles the add.

// Order lead or a leading quantity.
const OPENER_LEAD_RE = /(^|\s)(cho|lay|muon|goi|order|mua|add|get|want|buy)(\s|$)/;
const OPENER_QTY_RE = /^(\d+|mot|hai|ba|one|two|three)\s/;
// A second item joined on — treat as compound and let the model handle it.
const CONJUNCTION_RE = /(^|\s)(va|voi|kem|cong|them|and|with|plus)(\s|$)/;

// If any specific product token appears, the request is already specific enough
// to add directly — don't clarify.
const SPECIFIC_ITEM_TOKENS = [
  "zinger", "tom", "shrimp", "ga yo", "popcorn", "tenders", "egg tart", "eggtart",
  "banh trung", "pepsi", "7up", "seven up", "lipton", "khoai tay", "coleslaw",
  "bap cai", "salad", "rong bien", "sup", "mi y", "pasta", "bucket",
];

type OpenerCategory = {
  key: string;
  category: string; // MenuCategory to filter matches to
  query: string; // search query into the catalog
  label: string; // English label for the clarifier
  words: string[]; // normalized category words that select this category
};

const OPENER_CATEGORIES: OpenerCategory[] = [
  { key: "burger", category: "burger", query: "burger", label: "burger", words: ["burger"] },
  { key: "combo", category: "combo", query: "combo", label: "combo", words: ["combo"] },
  {
    key: "chicken",
    category: "chicken",
    query: "ga ran",
    label: "chicken",
    words: ["ga", "ga ran", "phan ga", "mieng ga", "ga gion", "chicken"],
  },
  {
    key: "drink",
    category: "drink",
    query: "nuoc",
    label: "drinks",
    words: ["nuoc", "nuoc uong", "do uong", "thuc uong", "nuoc ngot", "drink", "drinks"],
  },
  // Rice/side/dessert are deliberately omitted because those requests usually mean one specific
  // dish, so they're best left to the model to add directly.
];

// Leads, quantities, units and filler that carry no product specificity. If
// anything OTHER than these + the category word survives, the request is
// specific ("2 pieces of fried chicken, not spicy") and must go to the model, not a clarifier.
const OPENER_FILLER = new Set([
  "cho", "minh", "toi", "em", "ban", "lay", "muon", "goi", "mua", "order", "xin",
  "gium", "giup", "a", "di", "nhe", "mot", "hai", "ba", "bon", "phan", "mieng",
  "ly", "cai", "suat", "hop", "con", "dia", "to", "phai",
  "add", "get", "want", "buy", "me", "please", "one", "two", "three", "four",
  "piece", "pieces", "drink", "drinks", "meal", "item",
]);

/** Whole-word containment on the normalized string (space-padded). */
function wordIncludes(norm: string, word: string): boolean {
  return ` ${norm} `.includes(` ${word} `);
}

/** Exactly one category selected → return it; zero or ambiguous (≥2) → null. */
function detectSingleCategory(norm: string): OpenerCategory | null {
  const hits = OPENER_CATEGORIES.filter((cat) => cat.words.some((w) => wordIncludes(norm, w)));
  return hits.length === 1 ? hits[0] : null;
}

/** True only when nothing but lead/quantity/filler + the category word remains. */
function isBareOpener(norm: string, cat: OpenerCategory): boolean {
  let s = ` ${norm} `;
  for (const w of [...cat.words].sort((a, b) => b.length - a.length)) {
    s = s.split(` ${w} `).join(" ");
  }
  const rest = s.trim().split(/\s+/).filter(Boolean).filter((t) => !OPENER_FILLER.has(t) && !/^\d+$/.test(t));
  return rest.length === 0;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Try to answer a bare category order-opener with a grounded clarifier. Returns
 * null (→ fall through to the real agent) unless the message is a short,
 * single-category opener that resolves to ≥2 available items. Async because it
 * reads the live catalog, but every gate before that is synchronous, so a normal
 * order (specific or compound) returns null without touching the catalog.
 */
export async function matchOrderOpener(text: string): Promise<FaqHit | null> {
  const norm = normalize(text ?? "");
  if (!norm) return null;
  if (norm.split(" ").length > 8) return null; // openers are short
  if (!OPENER_LEAD_RE.test(norm) && !OPENER_QTY_RE.test(norm)) return null;
  if (CONJUNCTION_RE.test(norm)) return null; // compound → model
  if (SPECIFIC_ITEM_TOKENS.some((token) => norm.includes(token))) return null; // already specific

  const cat = detectSingleCategory(norm);
  if (!cat) return null;
  // A digit AFTER the category word is a product name ("combo 1" → Combo 1 Fried
  // Chicken), not a quantity — that's already specific, never a bare opener.
  if (cat.words.some((w) => new RegExp(`\\b${w}\\s+\\d`).test(norm))) return null;
  if (!isBareOpener(norm, cat)) return null; // specific request → let the model add it

  const { matches } = await searchMenuGrounded(cat.query, 6);
  const available = matches.filter((m) => m.category === cat.category);
  if (available.length < 2) return null; // not actually ambiguous → let the model add it

  const shown = available.slice(0, 4);
  const list = joinList(shown.map((m) => `${m.name} (${m.displayPrice})`));
  const more = available.length > shown.length ? ", plus a few more options" : "";
  const say = `We have a few ${cat.label} options such as ${list}${more}. Which one should I add to your order?`;

  return { id: `opener-${cat.key}`, say };
}
