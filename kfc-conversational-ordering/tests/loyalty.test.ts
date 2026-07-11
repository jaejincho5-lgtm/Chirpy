import assert from "node:assert/strict";
import { checkLoyalty } from "../lib/oms";
import {
  DEMO_SEED_BALANCES,
  EARN_RATE_VND_PER_POINT,
  MAX_REDEEM_PER_ORDER,
  getLoyaltyStore,
  pointsEarnedFor,
  resetInMemoryLoyalty,
} from "../lib/loyalty";

delete process.env.SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

resetInMemoryLoyalty();
const store = getLoyaltyStore();

// --- seeded demo balances are present and resettable -------------------------

for (const [customerId, points] of Object.entries(DEMO_SEED_BALANCES)) {
  const account = await store.getAccount(customerId);
  assert.equal(account.points, points, `${customerId} seed points are loaded`);
  assert.equal(account.lifetimePoints, points, `${customerId} seed lifetime points are loaded`);
}

await store.redeem("linh", 1000, "seed-mutation");
assert.equal((await store.getAccount("linh")).points, DEMO_SEED_BALANCES.linh - 1000, "seed account can mutate");
resetInMemoryLoyalty();
assert.equal((await store.getAccount("linh")).points, DEMO_SEED_BALANCES.linh, "reset restores seed points");

// --- earning floors at one point per 1,000 VND -------------------------------

assert.equal(pointsEarnedFor(-1), 0, "negative totals earn no points");
assert.equal(pointsEarnedFor(999), 0, "999 VND earns no points");
assert.equal(pointsEarnedFor(EARN_RATE_VND_PER_POINT), 1, "1,000 VND earns one point");
assert.equal(pointsEarnedFor(1999), 1, "earning floors fractional thousands");
assert.equal(pointsEarnedFor(2000), 2, "2,000 VND earns two points");

const earned = await store.earn("earn-floor", 150999, "earn-floor-order");
assert.equal(earned, 150, "earn() returns floored points earned");
let earnedAccount = await store.getAccount("earn-floor");
assert.equal(earnedAccount.points, 150, "earned points are added to current balance");
assert.equal(earnedAccount.lifetimePoints, 150, "earned points are added to lifetime points");

// --- redemption offer is capped, and checking redemption does not debit ------

const vipBefore = await store.getAccount("demo-vip");
const vipCheck = await checkLoyalty("demo-vip", true);
assert.equal(vipCheck.redeemOptions[0]?.points, MAX_REDEEM_PER_ORDER, "redeem option is capped per order");
assert.equal(vipCheck.redemption.pointsRedeemed, MAX_REDEEM_PER_ORDER, "redemption payload is capped per order");
assert.equal(
  (await store.getAccount("demo-vip")).points,
  vipBefore.points,
  "checking a redemption does not debit points",
);

const placedDebit = await store.redeem("demo-vip", vipCheck.redemption.pointsRedeemed, "placed-vip");
assert.equal(placedDebit, MAX_REDEEM_PER_ORDER, "placement settlement debits the capped redemption");
assert.equal(
  (await store.getAccount("demo-vip")).points,
  vipBefore.points - MAX_REDEEM_PER_ORDER,
  "points debit only after placement settlement",
);

// --- direct store redemption cannot overdraw, but currently ignores the cap --

await store.earn("over-cap", (MAX_REDEEM_PER_ORDER + 5000) * EARN_RATE_VND_PER_POINT, "seed-over-cap");
const overCapRequest = MAX_REDEEM_PER_ORDER + 1;
const overCapDebit = await store.redeem("over-cap", overCapRequest, "placed-over-cap");
// NOTE: possible bug — direct store redemption is not capped at MAX_REDEEM_PER_ORDER; expected-correct behavior should debit at most MAX_REDEEM_PER_ORDER per placed order.
assert.equal(overCapDebit, overCapRequest, "current behavior: direct store redeem debits above the per-order cap");
assert.ok((await store.getAccount("over-cap")).points >= 0, "over-cap account still cannot go negative");

await store.earn("no-overdraw", 2500, "small-earn");
assert.equal(await store.redeem("no-overdraw", 999, "too-large-redeem"), 2, "redeem clamps to the balance");
let noOverdraw = await store.getAccount("no-overdraw");
assert.equal(noOverdraw.points, 0, "overlarge redeem leaves zero points");
assert.ok(noOverdraw.points >= 0, "overlarge redeem never overdraws");
assert.equal(await store.redeem("no-overdraw", -100, "negative-redeem"), 0, "negative redeem debits nothing");
assert.equal((await store.getAccount("no-overdraw")).points, 0, "negative redeem keeps points unchanged");

// --- lifetimePoints is monotonic across redemption and later earning ---------

await store.earn("lifetime", 10999, "life-earn-1");
const lifeAfterEarn = await store.getAccount("lifetime");
assert.equal(lifeAfterEarn.lifetimePoints, 10, "initial lifetime is earned points");

await store.redeem("lifetime", 8, "life-redeem");
const lifeAfterRedeem = await store.getAccount("lifetime");
assert.equal(lifeAfterRedeem.points, 2, "redeem reduces spendable points");
assert.equal(lifeAfterRedeem.lifetimePoints, lifeAfterEarn.lifetimePoints, "redeem does not reduce lifetime points");

await store.earn("lifetime", 1000, "life-earn-2");
const lifeAfterSecondEarn = await store.getAccount("lifetime");
assert.equal(lifeAfterSecondEarn.lifetimePoints, lifeAfterEarn.lifetimePoints + 1, "later earn increases lifetime");
assert.ok(
  lifeAfterSecondEarn.lifetimePoints >= lifeAfterRedeem.lifetimePoints,
  "lifetime points remain monotonic",
);

resetInMemoryLoyalty();
console.log("loyalty tests passed");
