// Pre-seed the learned answer cache (kfc_answer_cache) with common English
// questions so they answer in ~1ms on the very first ask. Every seed is pushed
// through the same runtime gates a live lookup uses, so unreachable seeds fail
// the script instead of silently rotting in the table.
//
// Re-run before a demo:
//   npx tsx db/seed-answer-cache.ts

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Load .env.local ourselves so the script runs with a bare `npx tsx`.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (match && !(match[1] in process.env)) process.env[match[1]] = match[2];
}

const { matchFaq, matchOrderOpener, isEvergreenQuestion, normalize } = await import("../lib/faq-cache");
const { getAnswerCacheStore } = await import("../lib/answer-cache");
const { CATALOG_VERSION } = await import("../lib/menu");

const SEEDS: Array<{ q: string; a: string }> = [
  {
    q: "do you sell rice meals",
    a: "Yes. KFC has fried chicken rice, roasted fillet chicken rice, and Nanban popcorn chicken rice.",
  },
  {
    q: "do you have roasted chicken",
    a: "Yes. Roasted Fillet Chicken is available, with a softer and less oily profile than fried chicken.",
  },
  {
    q: "do you have soup",
    a: "Yes. Seaweed Soup is available and works well as a warm side.",
  },
  {
    q: "do you have pasta",
    a: "Yes. KFC has sausage pasta, popcorn chicken pasta, and fried chicken pasta.",
  },
  {
    q: "do you have boneless chicken",
    a: "Yes. Popcorn Chicken and Tenders are boneless options.",
  },
  {
    q: "what drinks are available",
    a: "Drink options include Pepsi, 7Up, Lipton, and Pepsi Zero in several sizes.",
  },
  {
    q: "which chicken is spicy",
    a: "Hot & Spicy Chicken is the spicier fried chicken option. Original crispy chicken is not spicy.",
  },
  {
    q: "what should one person order",
    a: "For one person, a single combo with chicken or burger, fries, and a drink is usually a good fit.",
  },
  {
    q: "what should two people order",
    a: "For two people, Combo Group 2 or Couple's Bucket is usually a good starting point.",
  },
  {
    q: "can I order ahead",
    a: "Yes. Tell me the items and pickup or delivery time, and I can prepare the order flow.",
  },
  {
    q: "can I get takeaway",
    a: "Yes. You can order ahead and pick it up at the counter.",
  },
  {
    q: "does KFC have egg tarts",
    a: "Yes. Egg tarts are available individually or as a set of four.",
  },
  {
    q: "does KFC have shrimp burger",
    a: "Yes. The Shrimp Burger is available and can be ordered alone or as a combo.",
  },
  {
    q: "does KFC have salad",
    a: "Yes. Salad options include coleslaw-style cabbage salad, roasted sesame salad, and popcorn salad.",
  },
  {
    q: "does KFC have mashed potato",
    a: "Yes. Mashed Potato with gravy is available in multiple sizes.",
  },
  {
    q: "what is a bucket",
    a: "A bucket is a shareable chicken set for groups, usually better value when several people are eating.",
  },
  {
    q: "what are tenders",
    a: "Tenders are boneless chicken fillets, easy to share and good with sauce.",
  },
  {
    q: "what is a zinger",
    a: "Zinger is KFC's crispy spicy chicken burger.",
  },
  {
    q: "what should three people order",
    a: "For three people, Combo Group 3 is a practical choice with chicken, popcorn, and drinks.",
  },
  {
    q: "can I order for the office",
    a: "Yes. Tell me the number of portions and the target time, and I can help assemble a large order.",
  },
  {
    q: "can I send food to someone else",
    a: "Yes. Provide the recipient address and phone number during checkout.",
  },
  {
    q: "can I pay on delivery",
    a: "Yes. Cash on delivery is supported, and card at the door may be available depending on the branch.",
  },
  {
    q: "what should I pick if I do not want spicy food",
    a: "Original fried chicken, roasted fillet chicken, Shrimp Burger, and many sides are non-spicy choices.",
  },
  {
    q: "where is KFC from",
    a: "KFC started in Kentucky in the United States.",
  },
  {
    q: "who is the person in the KFC logo",
    a: "The person in the KFC logo is Colonel Harland Sanders, KFC's founder.",
  },
  {
    q: "what is the KFC slogan",
    a: "KFC's well-known slogan is Finger Lickin' Good.",
  },
  {
    q: "what is Nanban rice",
    a: "Nanban Popcorn Chicken Rice is a rice meal with popcorn chicken and a sweet-sour Japanese-style sauce.",
  },
  {
    q: "what is coleslaw",
    a: "Coleslaw is a cool cabbage salad with a creamy dressing, commonly served as a side with fried chicken.",
  },
  {
    q: "what should I eat for lunch",
    a: "For lunch, fried chicken rice or a single combo is a quick, filling choice.",
  },
  {
    q: "what should I eat tonight",
    a: "For dinner, a bucket or share combo is a good choice if you are eating with others.",
  },
];

const store = getAnswerCacheStore();
let seeded = 0;
const problems: string[] = [];

for (const { q, a } of SEEDS) {
  if (!isEvergreenQuestion(q)) {
    problems.push(`GUARDED (would never hit): "${q}"`);
    continue;
  }
  const curated = matchFaq(q) ?? (await matchOrderOpener(q));
  if (curated) {
    problems.push(`SHADOWED by curated "${curated.id}" (would never hit): "${q}"`);
    continue;
  }
  await store.put({
    key: normalize(q),
    say: a,
    hits: 0,
    createdAt: new Date().toISOString(),
    catalogVersion: CATALOG_VERSION,
  });
  seeded += 1;
  console.log(`seeded: "${q}"`);
}

console.log(`\n${seeded}/${SEEDS.length} seeded (catalog ${CATALOG_VERSION}, TTL 24h; re-run before the demo).`);
if (problems.length) {
  console.error(`\nNOT seeded:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
