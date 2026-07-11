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

// --- store → lookup roundtrip on a normalized-identical paraphrase -----------

resetAnswerCache();
await storeAnswer("KFC có phòng sinh nhật không?", "Dạ nhiều chi nhánh có khu tổ chức sinh nhật ạ.", {
  toolCallCount: 0,
});
const hit = await lookupAnswer("kfc co phong sinh nhat khong"); // diacritic-free paraphrase → same key
assert.equal(hit, "Dạ nhiều chi nhánh có khu tổ chức sinh nhật ạ.", "paraphrase-identical question hits");
const stats = await getAnswerCacheStats();
assert.equal(stats.entries, 1, "one entry learned");
assert.equal(stats.hits, 1, "one hit recorded");

// --- GUARD: an order-intent message never stores nor hits --------------------

resetAnswerCache();
await storeAnswer("cho mình 1 burger", "answer", { toolCallCount: 0 });
assert.equal((await getAnswerCacheStats()).entries, 0, "order-shaped message is never stored");
// Even if a matching key is planted directly, the guard blocks the hit.
await getAnswerCacheStore().put({
  key: normalize("cho minh 1 burger"),
  say: "planted",
  hits: 0,
  createdAt: new Date().toISOString(),
  catalogVersion: CATALOG_VERSION,
});
assert.equal(await lookupAnswer("cho mình 1 burger"), null, "guard blocks the hit even with a live key");

// --- a turn that used tools is never stored (answer depended on live data) ----

resetAnswerCache();
await storeAnswer("mấy giờ mở cửa", "Dạ 9h tới 22h ạ", { toolCallCount: 2 });
assert.equal((await getAnswerCacheStats()).entries, 0, "a turn with tool calls is never stored");

// --- a reply carrying an order number / long digit run is never stored -------

resetAnswerCache();
await storeAnswer("quán có wifi không", "Dạ có, mật khẩu theo hoá đơn #5678 ạ", { toolCallCount: 0 });
assert.equal((await getAnswerCacheStats()).entries, 0, "reply with a 4+ digit run is never stored");
// the same question with a clean reply DOES store — proving it was the number.
await storeAnswer("quán có wifi không", "Dạ có wifi miễn phí cho khách ạ", { toolCallCount: 0 });
assert.equal((await getAnswerCacheStats()).entries, 1, "clean reply to the same question stores");

// --- catalogVersion mismatch ⇒ miss ------------------------------------------

resetAnswerCache();
await getAnswerCacheStore().put({
  key: normalize("kfc co wifi mien phi khong"),
  say: "Dạ có ạ",
  hits: 0,
  createdAt: new Date().toISOString(),
  catalogVersion: "stale-catalog-version",
});
assert.equal(await lookupAnswer("kfc có wifi miễn phí không"), null, "stale catalogVersion ⇒ miss");

// --- 24h expiry ⇒ miss (timestamps injected explicitly) ----------------------

resetAnswerCache();
const t0 = Date.parse("2026-07-11T00:00:00Z");
await storeAnswer("kfc có chỗ đỗ xe không", "Dạ đa số chi nhánh có chỗ đỗ xe ạ", { toolCallCount: 0 }, t0);
assert.ok(await lookupAnswer("kfc co cho do xe khong", t0 + 60_000), "fresh entry hits");
assert.equal(
  await lookupAnswer("kfc co cho do xe khong", t0 + 25 * 3600 * 1000),
  null,
  "entry older than 24h ⇒ miss",
);

resetAnswerCache();
console.log("learned answer-cache tests passed");
