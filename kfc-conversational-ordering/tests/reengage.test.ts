import assert from "node:assert/strict";
import {
  AUTO_MUTE_AFTER_IGNORES,
  CircularMeanPredictor,
  IGNORE_AFTER_HOURS,
  LEAD_MINUTES,
  MIN_CONFIDENCE,
  VN_UTC_OFFSET_HOURS,
  countConsecutiveIgnores,
  decideReengage,
  formatHourLabel,
} from "../lib/reengage";
import type { ReengageNotification, ReengagePrefs } from "../lib/reengage-store";
import { seededRandom } from "../lib/reco/pos-sim";

const BASE_EPOCH_MS = 1_750_000_000_000;
const BASE_UTC_DAY_MS = Math.floor(BASE_EPOCH_MS / 86_400_000) * 86_400_000;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

try {
  testCircularWraparound();
  console.log("reengage predictor wraparound tests passed");

  testRecencyWeighting();
  console.log("reengage predictor recency-weighting tests passed");

  testSpecExample();
  console.log("reengage predictor time-label tests passed");

  testConfidence();
  console.log("reengage predictor confidence tests passed");

  testGateOrder();
  console.log("reengage decision gate-order tests passed");

  testPersonalWindowOverride();
  console.log("reengage personal-window override tests passed");

  testConsecutiveIgnores();
  console.log("reengage ignore-streak tests passed");
} catch (error) {
  process.exitCode = 1;
  console.error(error);
}

function testCircularWraparound() {
  const prediction = new CircularMeanPredictor().predictOrderHour([
    "2025-06-01T16:30:00.000Z",
    "2025-06-01T17:30:00.000Z",
  ]);

  assert.notEqual(prediction.predictedHour, null);
  const predictedHour = prediction.predictedHour ?? 0;
  assert.ok(
    Math.min(Math.abs(predictedHour), Math.abs(24 - predictedHour)) <= 0.25,
    `expected midnight prediction, got ${predictedHour}`,
  );
  assert.ok(Math.abs(predictedHour - 12) > 6, "wraparound mean must not land near noon");
}

function testRecencyWeighting() {
  const placedAtsIso = [
    ...Array.from({ length: 6 }, (_, index) => vnLocalHourToUtcIso(index, 12)),
    ...Array.from({ length: 3 }, (_, index) => vnLocalHourToUtcIso(index + 6, 19)),
  ];
  const prediction = new CircularMeanPredictor().predictOrderHour(placedAtsIso);

  assert.notEqual(prediction.predictedHour, null);
  const predictedHour = prediction.predictedHour ?? 0;
  assert.ok(
    distance(predictedHour, 19) < distance(predictedHour, 12),
    `expected ${predictedHour} to be closer to 19:00 than 12:00`,
  );
}

function testSpecExample() {
  const prediction = new CircularMeanPredictor().predictOrderHour([
    vnLocalHourToUtcIso(0, 11 + 32 / 60),
    vnLocalHourToUtcIso(1, 11 + 28 / 60),
  ]);

  assert.equal(prediction.predictedTimeLabel, "11:30");
  assert.ok(
    prediction.predictedHour !== null && prediction.predictedHour >= 11.48 && prediction.predictedHour <= 11.52,
    `expected predictedHour near 11:30, got ${prediction.predictedHour}`,
  );
}

function testConfidence() {
  const tight = [-5, -3, -1, 0, 1, 2, 3, 5].map((minuteOffset, index) =>
    vnLocalHourToUtcIso(index, 18 + minuteOffset / 60),
  );
  const tightPrediction = new CircularMeanPredictor().predictOrderHour(tight);
  assert.ok(
    tightPrediction.confidence >= 0.8,
    `tight order hours should be high confidence, got ${tightPrediction.confidence}`,
  );

  const rand = seededRandom(4242);
  const scattered = Array.from({ length: 8 }, (_, index) =>
    vnLocalHourToUtcIso(index, (index * 3 + rand() * 3) % 24),
  );
  const scatteredPrediction = new CircularMeanPredictor().predictOrderHour(scattered);
  assert.ok(
    scatteredPrediction.confidence < MIN_CONFIDENCE,
    `scattered order hours should be below confidence threshold, got ${scatteredPrediction.confidence}`,
  );
}

function testGateOrder() {
  const firingOrders = buildHabitOrders(19);
  const now = Date.parse(firingOrders[firingOrders.length - 1]) + 6 * DAY_MS;
  const basePrefs = prefs();
  const baseInput = {
    placedAtsIso: firingOrders,
    context: { weather: "clear" as const, hour: 19 },
    prefs: basePrefs,
    notifications: [] as ReengageNotification[],
    now,
  };

  assert.equal(decideReengage({ ...baseInput, prefs: prefs({ optedOut: true }) }).gate, "opted_out");
  assert.equal(
    decideReengage({ ...baseInput, prefs: prefs({ mutedAt: iso(now - 10 * DAY_MS) }) }).gate,
    "muted",
  );

  const ignoredNotifications = [
    notification(now - 3 * DAY_MS),
    notification(now - 4 * DAY_MS),
  ];
  const autoMuted = decideReengage({ ...baseInput, notifications: ignoredNotifications });
  assert.equal(autoMuted.gate, "muted");
  assert.equal(autoMuted.autoMuted, true);

  const cooldown = decideReengage({
    ...baseInput,
    notifications: [notification(now - 2 * DAY_MS)],
  });
  assert.equal(cooldown.gate, "cooldown");
  assert.equal(cooldown.shouldSend, false);

  const ok = decideReengage(baseInput);
  assert.equal(ok.gate, "ok");
  assert.equal(ok.shouldSend, true);
  assert.notEqual(ok.prediction.predictedHour, null);
  assert.equal(
    ok.recommendedSendTime,
    formatHourLabel((ok.prediction.predictedHour ?? 0) - LEAD_MINUTES / 60),
  );

  const quietOrders = buildHabitOrders(5.5);
  const quietNow = Date.parse(quietOrders[quietOrders.length - 1]) + 6 * DAY_MS;
  const quiet = decideReengage({
    placedAtsIso: quietOrders,
    context: { weather: "clear", hour: 19 },
    prefs: basePrefs,
    notifications: [],
    now: quietNow,
  });
  assert.equal(quiet.gate, "quiet_hours");
  assert.equal(quiet.shouldSend, false);
}

function testPersonalWindowOverride() {
  // Lunch habit, clear midday context: the global appetite windows all miss
  // (not rainy/hot/evening), but a confident prediction that the customer
  // orders around NOW must pass — their own habit IS the appetite window.
  const lunchOrders = buildHabitOrders(11.5);
  const now = Date.parse(lunchOrders[lunchOrders.length - 1]) + 6 * DAY_MS;
  const base = {
    placedAtsIso: lunchOrders,
    prefs: prefs(),
    notifications: [] as ReengageNotification[],
    now,
  };

  const inWindow = decideReengage({ ...base, context: { weather: "clear" as const, hour: 11 } });
  assert.equal(inWindow.gate, "ok", "confident habit at the current hour overrides context_mismatch");
  assert.equal(inWindow.shouldSend, true);

  // Same customer, same clear sky, but mid-afternoon: no global window, no
  // personal window → still context_mismatch.
  const outOfWindow = decideReengage({ ...base, context: { weather: "clear" as const, hour: 15 } });
  assert.equal(outOfWindow.gate, "context_mismatch");
  assert.equal(outOfWindow.shouldSend, false);
}

function testConsecutiveIgnores() {
  const now = BASE_UTC_DAY_MS + 20 * DAY_MS;
  assert.equal(
    countConsecutiveIgnores([notification(now - (IGNORE_AFTER_HOURS - 1) * HOUR_MS)], [], now),
    0,
    "fresh notifications are not judged as ignored",
  );

  const orderAfterOlderNotification = iso(now - 5 * DAY_MS);
  const ignores = countConsecutiveIgnores(
    [notification(now - 3 * DAY_MS), notification(now - 6 * DAY_MS)],
    [orderAfterOlderNotification],
    now,
  );
  assert.equal(ignores, 1, "an order after an older notification breaks the ignore streak");
  assert.ok(AUTO_MUTE_AFTER_IGNORES > ignores);
}

function buildHabitOrders(vnHour: number) {
  return Array.from({ length: 5 }, (_, index) => vnLocalHourToUtcIso(index * 4, vnHour));
}

function prefs(overrides: Partial<ReengagePrefs> = {}): ReengagePrefs {
  return {
    customerId: "test-customer",
    optedOut: false,
    mutedAt: null,
    ...overrides,
  };
}

function notification(sentAtMs: number): ReengageNotification {
  return {
    customerId: "test-customer",
    channel: "messenger",
    message: "test",
    predictedFor: "19:00",
    confidence: 0.9,
    sentAt: iso(sentAtMs),
  };
}

function vnLocalHourToUtcIso(dayOffset: number, vnHour: number): string {
  return iso(BASE_UTC_DAY_MS + dayOffset * DAY_MS + (vnHour - VN_UTC_OFFSET_HOURS) * HOUR_MS);
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function distance(a: number, b: number): number {
  const raw = Math.abs(a - b) % 24;
  return Math.min(raw, 24 - raw);
}
