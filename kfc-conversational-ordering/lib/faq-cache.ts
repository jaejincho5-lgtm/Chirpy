// Instant FAQ cache for the KFC ambassador. A curated library of evergreen,
// order-neutral answers that we can serve locally in ~1ms instead of waking
// Opus 4.8 for "mấy giờ mở cửa?". Governed by one rule: NEVER WRONG.
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
//      hit is not — so we bias hard toward missing.
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

/** Lowercase, strip Vietnamese diacritics + đ, drop punctuation, collapse spaces. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // combining accent marks
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s]/g, " ") // punctuation, emoji → space
    .replace(/\s+/g, " ")
    .trim();
}

// ---- negative guard --------------------------------------------------------
// If any of these fire, the message is (or might be) an order/checkout action.
// We never serve a cached answer for it — the agent + Order state machine must
// run. Guard verbs are deliberately SPECIFIC phrases so that policy questions
// ("có giao hàng không") still pass while imperatives ("giao tới nhà") don't.

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
  "dung diem",
  "doi diem",
  "tich diem",
  // checkout / fulfilment / handoff
  "xac nhan",
  "thanh toan luon",
  "giao toi",
  "giao den",
  "giao ve",
  "giao gium",
  "giao gap",
  "ship toi",
  "ship den",
  "gap nhan vien",
  "gap nguoi",
  "so dien thoai cua",
];

// A quantity like "2 miếng", "1 combo", "3 ly", or a phone-length digit run.
const QUANTITY_RE = /\b\d+\s*(mieng|phan|combo|ly|cai|suat|hop|phi|ban)\b/;
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
      "chung nhan halal",
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
      "Về dinh dưỡng, dị ứng hay halal thì để chắc chắn nhất, anh/chị hỏi nhân viên tại quầy hoặc xem trên bao bì giúp em nhé. Em không muốn nói sai chuyện này ạ.",
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
    ],
    answers: [
      "KFC thường mở khoảng 9h sáng tới 22h tối, nhưng tuỳ chi nhánh nên anh/chị kiểm tra cửa hàng gần nhất cho chắc nhé ạ!",
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
      "giao tan nha khong",
      "co ban mang ve",
      "an tai cho khong",
      "co cho ngoi khong",
      "co ghe ngoi khong",
    ],
    answers: [
      "Dạ KFC có cả giao tận nơi lẫn đến lấy tại quầy ạ. Anh/chị muốn giao hàng hay tự đến lấy để em chuẩn bị đơn nhé?",
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
    ],
    answers: [
      "Anh/chị trả được bằng tiền mặt, thẻ, hoặc ví như MoMo/ZaloPay khi nhận hàng hoặc tại quầy ạ.",
    ],
  },
  {
    id: "spice",
    triggers: [
      "co cay khong",
      "cay khong vay",
      "mon nao cay",
      "co mon cay",
      "co mon khong cay",
      "an cay duoc khong",
      "ga co cay",
      "cay nhieu khong",
      "do cay the nao",
      "cay lam khong",
    ],
    answers: [
      "Gà giòn truyền thống thì không cay, còn Gà Hot & Spicy sẽ cay nhẹ đậm đà ạ. Anh/chị thích vị nào để em gợi ý?",
    ],
  },
  {
    id: "promos-exist",
    triggers: [
      "co khuyen mai khong",
      "co uu dai khong",
      "co ma giam gia khong",
      "co voucher khong",
      "dang co khuyen mai",
      "khuyen mai gi khong",
      "co deal khong",
      "co giam gia khong",
      "co combo tiet kiem",
    ],
    answers: [
      "Dạ đang có nhiều ưu đãi ạ! Anh/chị muốn em áp thử mã giảm giá hay gợi ý combo tiết kiệm nhất không?",
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
    ],
    answers: [
      "Anh/chị cứ nói tên món, hoặc kiểu 'thèm gì đó cay cay dưới 100k' — em tìm món, thêm vào giỏ, áp mã và chốt đơn giúp ạ. Anh/chị muốn bắt đầu chưa?",
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
    ],
    answers: [
      "Em là Đại sứ ảo của KFC — một chú gà AI, ở đây để giúp anh/chị gọi món thật nhanh gọn ạ! 🐔",
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
      "Dạ em nói tiếng Việt là chính, nhưng anh/chị cứ thoải mái, em vẫn hiểu ạ! (I can understand English too.)",
    ],
  },
  {
    id: "thanks",
    triggers: ["cam on", "cam on em", "cam on nhe", "cam on ban", "thank you", "thanks nhe", "tks em"],
    answers: [
      "Dạ không có gì đâu ạ! Anh/chị cần thêm gì cứ nói em nhé 🍗",
    ],
  },
  {
    id: "goodbye",
    triggers: ["tam biet", "chao tam biet", "het roi nhe", "khong can nua", "thoi nhe", "bye bye", "goodbye"],
    answers: [
      "Dạ cảm ơn anh/chị, hẹn gặp lại ạ! Chúc anh/chị ngon miệng 🐔",
    ],
  },
  {
    id: "greeting",
    triggers: ["xin chao", "chao em", "chao shop", "chao ban", "hello em", "hello shop", "alo em", "alo shop", "chao ad"],
    answers: [
      "Dạ em chào anh/chị! Em là Đại sứ Gà KFC đây ạ. Anh/chị muốn dùng gì hôm nay để em gợi ý nhé? 🍗",
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
// "cho 1 burger" → "which burger?" built from the LIVE catalog, so it lists only
// real, in-stock items with real prices and can never go stale. Fires ONLY for a
// short, single-category opener with no specific item and no second item; a
// specific ("burger zinger") or compound ("burger và khoai tây") request falls
// through so the real agent (and its state machine) handles the add.

// Order lead ("cho/lấy/muốn/gọi/mua…") or a leading quantity.
const OPENER_LEAD_RE = /(^|\s)(cho|lay|muon|goi|order|mua)(\s|$)/;
const OPENER_QTY_RE = /^(\d+|mot|hai|ba)\s/;
// A second item joined on — treat as compound and let the model handle it.
const CONJUNCTION_RE = /(^|\s)(va|voi|kem|cong|them)(\s|$)/;

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
  label: string; // Vietnamese label for the clarifier
  words: string[]; // normalized category words that select this category
};

const OPENER_CATEGORIES: OpenerCategory[] = [
  { key: "burger", category: "burger", query: "burger", label: "burger", words: ["burger"] },
  { key: "combo", category: "combo", query: "combo", label: "combo", words: ["combo"] },
  {
    key: "chicken",
    category: "chicken",
    query: "ga ran",
    label: "món gà",
    words: ["ga", "ga ran", "phan ga", "mieng ga", "ga gion", "chicken"],
  },
  {
    key: "drink",
    category: "drink",
    query: "nuoc",
    label: "món nước",
    words: ["nuoc", "nuoc uong", "do uong", "thuc uong", "nuoc ngot"],
  },
  // Rice/side/dessert are deliberately omitted: "cơm" already means one specific
  // dish, so they're best left to the model to add directly.
];

// Leads, quantities, units and filler that carry no product specificity. If
// anything OTHER than these + the category word survives, the request is
// specific ("2 miếng gà rán không cay") and must go to the model, not a clarifier.
const OPENER_FILLER = new Set([
  "cho", "minh", "toi", "em", "ban", "lay", "muon", "goi", "mua", "order", "xin",
  "gium", "giup", "a", "di", "nhe", "mot", "hai", "ba", "bon", "phan", "mieng",
  "ly", "cai", "suat", "hop", "con", "dia", "to", "phai",
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
  return `${items.slice(0, -1).join(", ")} và ${items[items.length - 1]}`;
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
  if (!isBareOpener(norm, cat)) return null; // specific request → let the model add it

  const { matches } = await searchMenuGrounded(cat.query, 6);
  const available = matches.filter((m) => m.category === cat.category);
  if (available.length < 2) return null; // not actually ambiguous → let the model add it

  const shown = available.slice(0, 4);
  const list = joinList(shown.map((m) => `${m.name} (${m.displayPrice})`));
  const more = available.length > shown.length ? ", và vài lựa chọn khác nữa" : "";
  const say = `Dạ bên em có vài ${cat.label} như ${list}${more} ạ — anh/chị muốn phần nào để em thêm vào đơn nhé?`;

  return { id: `opener-${cat.key}`, say };
}
