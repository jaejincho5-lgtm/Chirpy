// Suite 4 — nudge targeting precision on HELD-OUT simulated customers.
//
// The trigger (lib/nudge.ts) is a lapsed-customer re-activation forecast: it
// fires once a customer runs meaningfully past their own reorder cadence
// (1.25x their median gap). So the honest question is NOT "does it predict the
// next order" — it's "does it nudge the customers who actually lapsed, and
// leave alone the ones who were coming back anyway?"
//
// Ground truth per customer (seeded, held out from the trigger):
//   on-cadence — next real order lands on their usual rhythm (±30% jitter).
//                Firing before that order is a FALSE POSITIVE (wasted/annoying
//                nudge to someone already on their way back → mute risk).
//   lapsed     — next real order drifts to 1.6-3x their base gap. Firing
//                inside the lapse window (after their cadence passed, before
//                they finally returned) is a TRUE POSITIVE (the re-activation
//                the feature exists for).
//
// Deterministic and free: no LLM, no store, pure decideNudge math. The seed
// is disjoint from TRAIN_SEED (1401) and the personalization eval (8801/2).

import { decideNudge, reorderGapsDays } from "../lib/nudge";
import { seededRandom } from "../lib/reco/pos-sim";

const CUSTOMERS = 200;
const SEED = 9901;

export function runNudgeSuite() {
  const rand = seededRandom(SEED);
  let truePositives = 0; // lapsed + nudged before they returned
  let falseNegatives = 0; // lapsed + never nudged (forecast too slow)
  let falsePositives = 0; // on-cadence + nudged anyway
  let trueNegatives = 0; // on-cadence + correctly left alone

  for (let i = 0; i < CUSTOMERS; i++) {
    // Per-customer cadence: base gap 2-9 days, ±30% jitter per interval.
    const baseGap = 2 + rand() * 7;
    const jitter = () => baseGap * (0.7 + rand() * 0.6);
    const orderCount = 4 + Math.floor(rand() * 5); // 4-8 completed orders
    const lapsed = rand() < 0.5;

    // History timestamps (ms), oldest→newest, last order at t=0 for the sweep.
    const gaps = Array.from({ length: orderCount - 1 }, jitter);
    const placedAts: string[] = [];
    let cursor = -gaps.reduce((sum, gap) => sum + gap, 0) * 86_400_000;
    placedAts.push(new Date(1_750_000_000_000 + cursor).toISOString());
    for (const gap of gaps) {
      cursor += gap * 86_400_000;
      placedAts.push(new Date(1_750_000_000_000 + cursor).toISOString());
    }

    // Held-out truth the trigger never sees: when this customer ACTUALLY
    // orders next. Lapsed customers drift to 1.6-3x their base gap.
    const trueReorderDay = lapsed ? baseGap * (1.6 + rand() * 1.4) : jitter();

    // Sweep the clock in half-day steps with a matching context (evening) so
    // the measurement isolates the timing forecast, not the context gate.
    const historyGaps = reorderGapsDays(placedAts);
    let firedAtDay: number | null = null;
    for (let day = 0.5; day < trueReorderDay; day += 0.5) {
      if (decideNudge(historyGaps, day, { weather: "clear", hour: 19 }).fire) {
        firedAtDay = day;
        break;
      }
    }

    if (lapsed) {
      if (firedAtDay !== null) truePositives += 1;
      else falseNegatives += 1;
    } else {
      if (firedAtDay !== null) falsePositives += 1;
      else trueNegatives += 1;
    }
  }

  const fired = truePositives + falsePositives;
  const lapsedTotal = truePositives + falseNegatives;
  const precision = fired ? truePositives / fired : 0;
  const recall = lapsedTotal ? truePositives / lapsedTotal : 0;

  console.log("\nSUITE 4 - nudge targeting precision (held-out cadences, deterministic)");
  console.log(`  customers: ${CUSTOMERS} (${lapsedTotal} lapsed / ${CUSTOMERS - lapsedTotal} on-cadence · seed ${SEED}, disjoint from training)`);
  console.log(
    `  nudged-lapsed ${truePositives} · missed-lapsed ${falseNegatives} · ` +
      `nudged-on-cadence ${falsePositives} · left-alone ${trueNegatives}`,
  );
  console.log(`  precision (nudges that hit a lapsed customer): ${(precision * 100).toFixed(1)}%`);
  console.log(`  recall    (lapsed customers reached in time):  ${(recall * 100).toFixed(1)}%`);
  return { precision, recall, truePositives, falsePositives, falseNegatives, trueNegatives };
}
