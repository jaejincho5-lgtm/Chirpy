import assert from "node:assert/strict";
import { extractSay } from "../lib/say";
import { speakableText } from "../lib/speech";

// --- speakableText: emoji stripping never mangles Vietnamese ------------------

assert.equal(speakableText("Gà rán giòn cay 🍗🔥 ngon lắm ạ!"), "Gà rán giòn cay ngon lắm ạ!", "pictographs stripped, diacritics intact");
assert.equal(speakableText("Chào anh/chị! 🐔"), "Chào anh/chị!", "trailing emoji leaves no dangling space before punctuation");
assert.equal(speakableText("Dạ 👍🏻👍🏿 vâng ạ"), "Dạ vâng ạ", "skin-tone modifiers removed with their base");
assert.equal(speakableText("Cờ 🇻🇳 Việt Nam"), "Cờ Việt Nam", "regional-indicator pairs removed");
assert.equal(speakableText("Gia đình 👨‍👩‍👧‍👦 vui vẻ"), "Gia đình vui vẻ", "ZWJ sequences fully removed");
assert.equal(speakableText("Số 1⃣ nhé"), "Số 1 nhé", "combining keycap stripped, digit kept");
assert.equal(speakableText("🐔🍗🔥"), "", "emoji-only text becomes empty (speaker must no-op)");
assert.equal(speakableText("   "), "", "whitespace-only text becomes empty");
assert.equal(speakableText("Ừ … thế à ?"), "Ừ… thế à?", "spaces collapsed before punctuation");

// --- extractSay: fenced JSON contract ----------------------------------------

assert.equal(
  extractSay('Dạ có ngay ạ!\n```json\n{"say":"ignored","cart":[]}\n```'),
  "Dạ có ngay ạ!",
  "prose before fence wins",
);
assert.equal(
  extractSay('```json\n{"say":"Dạ em thêm 1 gà giòn rồi ạ 🐔","cart":[]}\n```'),
  "Dạ em thêm 1 gà giòn rồi ạ 🐔",
  "fence-only reply falls back to say field",
);
assert.equal(
  extractSay('```json\n{"say":"Nửa chừng'),
  "Nửa chừng",
  "stream truncated mid-fence: say value is salvaged, fence markers never spoken",
);
assert.equal(
  extractSay('{"say":"Cụt nửa chừng'),
  "Cụt nửa chừng",
  "bare contract truncated mid-string: say value salvaged",
);
assert.equal(
  extractSay('{"say":"Xin ch\\u00e0o \\"quý khách\\"'),
  'Xin chào "quý khách"',
  "salvaged say unescapes JSON escapes",
);
assert.equal(extractSay("```json"), "", "fence opener alone yields empty, not the literal marker");

// --- extractSay: unfenced trailing contract -----------------------------------

assert.equal(
  extractSay('Em chốt đơn nhé! {"say":"dup","total":45000}'),
  "Em chốt đơn nhé!",
  "prose before raw JSON object wins",
);
assert.equal(
  extractSay('{"say":"Chỉ có JSON thôi ạ"}'),
  "Chỉ có JSON thôi ạ",
  "bare JSON object returns its say",
);
assert.equal(extractSay('{"notsay":true}'), '{"notsay":true}', "JSON without say falls through to raw text");

// --- extractSay: markdown stripping + passthrough ------------------------------

assert.equal(extractSay("**Gà Giòn** ngon lắm"), "Gà Giòn ngon lắm", "bold markers stripped");
assert.equal(extractSay("## Ưu đãi\nMua 1 tặng 1"), "Ưu đãi\nMua 1 tặng 1", "heading markers stripped");
assert.equal(extractSay("Xin chào!"), "Xin chào!", "plain prose passes through untouched");
assert.equal(extractSay(""), "", "empty input stays empty");

// --- the /voice pipeline: extractSay → speakableText composes safely ----------

const raw = '**Dạ vâng!** Em thêm 1 Gà Giòn Cay 🍗 nha ```json\n{"say":"x"}\n```';
assert.equal(speakableText(extractSay(raw)), "Dạ vâng! Em thêm 1 Gà Giòn Cay nha", "full pipeline yields clean speakable prose");

console.log("speech text pipeline tests passed");
