// SUITE 5 - send-time prediction convergence (held-out, deterministic)
//
// The hour-level re-engagement claim is intentionally narrow: as a customer
// gives us more completed orders, their own send-time prediction should move
// closer to their held-out preferred hour, and beat a generic fixed blast.

import assert from "node:assert/strict";
import {
  CircularMeanPredictor,
  MIN_CONFIDENCE,
  VN_UTC_OFFSET_HOURS,
  circularHourDistance,
} from "../lib/reengage";
import { seededRandom } from "../lib/reco/pos-sim";

const CUSTOMERS = 150;
const SEED = 7701; // disjoint from 1401/8801/9901 seeds used elsewhere.
const ORDERS_PER_CUSTOMER = 8;
const BASE_EPOCH_MS = 1_750_000_000_000;
const BASE_UTC_DAY_MS = Math.floor(BASE_EPOCH_MS / 86_400_000) * 86_400_000;

type CustomerTimeline = {
  truePreferredHour: number;
  placedAtsIso: string[];
};

export function runReengageSuite() {
  const rand = seededRandom(SEED);
  const customers = Array.from({ length: CUSTOMERS }, () => generateCustomer(rand));
  const genericHour = circularMean(customers.map((customer) => customer.truePreferredHour));
  const genericErrorMinutes =
    customers.reduce(
      (sum, customer) => sum + circularHourDistance(genericHour, customer.truePreferredHour) * 60,
      0,
    ) / CUSTOMERS;

  const predictor = new CircularMeanPredictor();
  const errorByK: Record<number, number> = {};
  const unlockedShareByK: Record<number, number> = {};

  for (let k = 2; k <= ORDERS_PER_CUSTOMER; k += 1) {
    let errorMinutes = 0;
    let unlocked = 0;
    for (const customer of customers) {
      const prediction = predictor.predictOrderHour(customer.placedAtsIso.slice(0, k));
      assert.notEqual(prediction.predictedHour, null, `k=${k} should produce an hour prediction`);
      errorMinutes += circularHourDistance(prediction.predictedHour ?? 0, customer.truePreferredHour) * 60;
      if (prediction.confidence >= MIN_CONFIDENCE) unlocked += 1;
    }
    errorByK[k] = Number((errorMinutes / CUSTOMERS).toFixed(1));
    unlockedShareByK[k] = Number((unlocked / CUSTOMERS).toFixed(3));
  }

  const roundedGenericErrorMinutes = Number(genericErrorMinutes.toFixed(1));

  assert.ok(errorByK[8] < errorByK[2], "k=8 personalized error should improve over k=2");
  assert.ok(
    errorByK[8] < roundedGenericErrorMinutes,
    "k=8 personalized error should beat the generic fixed-time baseline",
  );

  console.log("\nSUITE 5 - send-time prediction convergence (held-out, deterministic)");
  console.log(`  customers: ${CUSTOMERS} (8 orders each, seed ${SEED}, disjoint from training/eval seeds)`);
  console.log(`  generic fixed-time baseline: ${roundedGenericErrorMinutes.toFixed(1)} min mean error`);
  console.log(
    `  mean personalized error by k: ${Object.entries(errorByK)
      .map(([k, error]) => `k=${k} ${error.toFixed(1)}m`)
      .join(" | ")}`,
  );
  console.log(
    `  unlocked share (confidence >= ${MIN_CONFIDENCE}): ${Object.entries(unlockedShareByK)
      .map(([k, share]) => `k=${k} ${(share * 100).toFixed(1)}%`)
      .join(" | ")}`,
  );

  return {
    errorByK,
    genericErrorMinutes: roundedGenericErrorMinutes,
    unlockedShareByK,
  };
}

function generateCustomer(rand: () => number): CustomerTimeline {
  const truePreferredHour = drawPreferredHour(rand);
  const sigmaMinutes = 15 + rand() * 30;
  const gapDays = 1 + Math.floor(rand() * 4);
  const placedAtsIso: string[] = [];

  for (let k = 0; k < ORDERS_PER_CUSTOMER; k += 1) {
    const approximateGaussian = ((rand() + rand() + rand() - 1.5) / 1.5) * sigmaMinutes;
    const noisyHour = truePreferredHour + approximateGaussian / 60;
    placedAtsIso.push(vnLocalHourToUtcIso(k * gapDays, noisyHour));
  }

  return { truePreferredHour, placedAtsIso };
}

function drawPreferredHour(rand: () => number): number {
  const roll = rand();
  if (roll < 0.4) return 11 + rand() * 2; // lunch, 11:00-13:00
  if (roll < 0.8) return 18 + rand() * 3; // evening, 18:00-21:00
  return rand() * 24; // other dayparts
}

function vnLocalHourToUtcIso(dayOffset: number, vnHour: number): string {
  const utcMs = BASE_UTC_DAY_MS + dayOffset * 86_400_000 + (vnHour - VN_UTC_OFFSET_HOURS) * 3_600_000;
  return new Date(utcMs).toISOString();
}

function circularMean(hours: number[]): number {
  let x = 0;
  let y = 0;
  for (const hour of hours) {
    const angle = (hour / 24) * 2 * Math.PI;
    x += Math.cos(angle);
    y += Math.sin(angle);
  }
  return ((Math.atan2(y, x) / (2 * Math.PI)) * 24 + 24) % 24;
}
