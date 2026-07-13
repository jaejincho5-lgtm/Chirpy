import assert from "node:assert/strict";
import { extractSay } from "../lib/say";
import { speakableText } from "../lib/speech";

// --- speakableText: emoji stripping never mangles English prose --------------

assert.equal(speakableText("Crispy spicy chicken 🍗🔥 is great!"), "Crispy spicy chicken is great!", "pictographs stripped");
assert.equal(speakableText("Hello there! 🐔"), "Hello there!", "trailing emoji leaves no dangling space before punctuation");
assert.equal(speakableText("Yes 👍🏻👍🏿 please"), "Yes please", "skin-tone modifiers removed with their base");
assert.equal(speakableText("Flag 🇺🇸 USA"), "Flag USA", "regional-indicator pairs removed");
assert.equal(speakableText("Family 👨‍👩‍👧‍👦 meal"), "Family meal", "ZWJ sequences fully removed");
assert.equal(speakableText("Number 1⃣ please"), "Number 1 please", "combining keycap stripped, digit kept");
assert.equal(speakableText("🐔🍗🔥"), "", "emoji-only text becomes empty (speaker must no-op)");
assert.equal(speakableText("   "), "", "whitespace-only text becomes empty");
assert.equal(speakableText("Okay … really ?"), "Okay… really?", "spaces collapsed before punctuation");

// --- extractSay: fenced JSON contract ---------------------------------------

assert.equal(
  extractSay('Right away!\n```json\n{"say":"ignored","cart":[]}\n```'),
  "Right away!",
  "prose before fence wins",
);
assert.equal(
  extractSay('```json\n{"say":"I added 1 crispy chicken 🐔","cart":[]}\n```'),
  "I added 1 crispy chicken 🐔",
  "fence-only reply falls back to say field",
);
assert.equal(
  extractSay('```json\n{"say":"Half done'),
  "Half done",
  "stream truncated mid-fence: say value is salvaged, fence markers never spoken",
);
assert.equal(
  extractSay('{"say":"Cut off halfway'),
  "Cut off halfway",
  "bare contract truncated mid-string: say value salvaged",
);
assert.equal(
  extractSay('{"say":"Hello \\"guest\\"'),
  'Hello "guest"',
  "salvaged say unescapes JSON escapes",
);
assert.equal(extractSay("```json"), "", "fence opener alone yields empty, not the literal marker");

// --- extractSay: unfenced trailing contract ---------------------------------

assert.equal(
  extractSay('Order confirmed! {"say":"dup","total":45000}'),
  "Order confirmed!",
  "prose before raw JSON object wins",
);
assert.equal(
  extractSay('{"say":"Only JSON here"}'),
  "Only JSON here",
  "bare JSON object returns its say",
);
assert.equal(extractSay('{"notsay":true}'), '{"notsay":true}', "JSON without say falls through to raw text");

// --- extractSay: markdown stripping + passthrough ---------------------------

assert.equal(extractSay("**Crispy Chicken** is great"), "Crispy Chicken is great", "bold markers stripped");
assert.equal(extractSay("## Deals\nBuy 1 get 1"), "Deals\nBuy 1 get 1", "heading markers stripped");
assert.equal(extractSay("Hello!"), "Hello!", "plain prose passes through untouched");
assert.equal(extractSay(""), "", "empty input stays empty");

// --- the /voice pipeline: extractSay -> speakableText composes safely --------

const raw = '**Yes!** I added 1 Crispy Chicken 🍗 now ```json\n{"say":"x"}\n```';
assert.equal(speakableText(extractSay(raw)), "Yes! I added 1 Crispy Chicken now", "full pipeline yields clean speakable prose");

console.log("speech text pipeline tests passed");
