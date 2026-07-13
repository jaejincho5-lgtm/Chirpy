import assert from "node:assert/strict";
import { CATALOG_VERSION } from "../lib/menu";
import { normalize } from "../lib/faq-cache";
import {
  lookupAnswer,
  storeAnswer,
  getAnswerCacheStats,
  getAnswerCacheStore,
  resetAnswerCache,
} from "../lib/answer-cache";

// --- store -> lookup roundtrip on a normalized-identical paraphrase ----------

resetAnswerCache();
await storeAnswer("Does KFC have birthday rooms?", "Many branches can host birthday parties.", {
  toolCallCount: 0,
});
const hit = await lookupAnswer("does kfc have birthday rooms");
assert.equal(hit, "Many branches can host birthday parties.", "paraphrase-identical question hits");
const stats = await getAnswerCacheStats();
assert.equal(stats.entries, 1, "one entry learned");
assert.equal(stats.hits, 1, "one hit recorded");

// --- GUARD: an order-intent message never stores nor hits --------------------

resetAnswerCache();
await storeAnswer("add 1 burger", "answer", { toolCallCount: 0 });
assert.equal((await getAnswerCacheStats()).entries, 0, "order-shaped message is never stored");
// Even if a matching key is planted directly, the guard blocks the hit.
await getAnswerCacheStore().put({
  key: normalize("add 1 burger"),
  say: "planted",
  hits: 0,
  createdAt: new Date().toISOString(),
  catalogVersion: CATALOG_VERSION,
});
assert.equal(await lookupAnswer("add 1 burger"), null, "guard blocks the hit even with a live key");

// --- a turn that used tools is never stored (answer depended on live data) ----

resetAnswerCache();
await storeAnswer("what time do you open", "Usually 9 AM to 10 PM.", { toolCallCount: 2 });
assert.equal((await getAnswerCacheStats()).entries, 0, "a turn with tool calls is never stored");

// --- a reply carrying an order number / long digit run is never stored -------

resetAnswerCache();
await storeAnswer("does this branch have wifi", "Yes, the Wi-Fi password is on receipt #5678.", {
  toolCallCount: 0,
});
assert.equal((await getAnswerCacheStats()).entries, 0, "reply with a 4+ digit run is never stored");
// The same question with a clean reply DOES store, proving it was the number.
await storeAnswer("does this branch have wifi", "Yes, many branches provide free Wi-Fi for guests.", {
  toolCallCount: 0,
});
assert.equal((await getAnswerCacheStats()).entries, 1, "clean reply to the same question stores");

// --- catalogVersion mismatch -> miss ----------------------------------------

resetAnswerCache();
await getAnswerCacheStore().put({
  key: normalize("does kfc have free wifi"),
  say: "Yes.",
  hits: 0,
  createdAt: new Date().toISOString(),
  catalogVersion: "stale-catalog-version",
});
assert.equal(await lookupAnswer("does kfc have free wifi"), null, "stale catalogVersion misses");

// --- 24h expiry -> miss (timestamps injected explicitly) --------------------

resetAnswerCache();
const t0 = Date.parse("2026-07-11T00:00:00Z");
await storeAnswer("does kfc have parking", "Most branches have parking nearby.", { toolCallCount: 0 }, t0);
assert.ok(await lookupAnswer("does kfc have parking", t0 + 60_000), "fresh entry hits");
assert.equal(
  await lookupAnswer("does kfc have parking", t0 + 25 * 3600 * 1000),
  null,
  "entry older than 24h misses",
);

resetAnswerCache();
console.log("learned answer-cache tests passed");
