import { getCatalogEntry } from "../lib/menu";
import type { CompletedOrderRecord } from "../lib/history-store";
import { deriveProfileFromRecords } from "../lib/profile";
import { suggestAddons, TRAIN_SEED } from "../lib/reco/suggest";
import { generateCustomerHistory, generatePersona, type PosOrder } from "../lib/reco/pos-sim";

export const PERSONA_SEED = 7301;
export const CUSTOMERS = 100;
export const ORDERS_PER_CUSTOMER = 10;

const TAKE_RATES = [0.12, 0.2, 0.28, 0.34, 0.4];
const MAIN_CATEGORIES = new Set(["chicken", "burger", "rice", "combo"]);

type Bucket = { events: number; hits: number };

export function runPersonalizationSuite() {
  let events = 0;
  let globalHits = 0;
  let personalizedHits = 0;
  let hitRevenueVnd = 0;
  const byHistory = new Map<string, Bucket>();

  for (let index = 0; index < CUSTOMERS; index += 1) {
    const customerId = `evalcust_${index}`;
    const persona = generatePersona(customerId, PERSONA_SEED + index);
    const history = generateCustomerHistory(persona, ORDERS_PER_CUSTOMER, PERSONA_SEED + 100 + index);
    const records = history.map(posOrderToRecord);

    for (let k = 0; k <= 8; k += 1) {
      const target = history[k];
      const primary = findPrimaryLine(target);
      if (!primary) continue;
      const attachments = target.lines.filter((line) => line !== primary).map((line) => line.itemId);
      if (!attachments.length) continue;

      const profile = k === 0 ? null : deriveProfileFromRecords(records.slice(0, k), [], customerId);
      const cart = [{ catalogId: primary.itemId, quantity: primary.quantity }];
      const global = suggestAddons(cart, target.context, null);
      const personalized = suggestAddons(cart, target.context, profile);
      const weight = target.lines
        .filter((line) => line !== primary)
        .reduce((sum, line) => sum + line.quantity, 0);
      const globalHit = Boolean(global.suggestion && attachments.includes(global.suggestion.catalogId));
      const personalizedHit = Boolean(
        personalized.suggestion && attachments.includes(personalized.suggestion.catalogId),
      );

      events += weight;
      if (globalHit) globalHits += weight;
      if (personalizedHit) {
        personalizedHits += weight;
        hitRevenueVnd += (personalized.suggestion?.priceVnd ?? 0) * weight;
      }

      const bucketKey = k >= 5 ? "5+" : String(k);
      const bucket = byHistory.get(bucketKey) ?? { events: 0, hits: 0 };
      bucket.events += weight;
      if (personalizedHit) bucket.hits += weight;
      byHistory.set(bucketKey, bucket);
    }
  }

  const globalPct = percent(globalHits, events);
  const personalizedPct = percent(personalizedHits, events);
  const lift = personalizedPct - globalPct;
  const k0 = bucketPercent(byHistory.get("0"));
  const k3 = bucketPercent(byHistory.get("3"));

  if (TRAIN_SEED !== 1401) throw new Error(`TRAIN_SEED drifted: ${TRAIN_SEED}`);
  if (events < 800) throw new Error(`Suite 3 expected at least 800 events, got ${events}`);
  if (lift < 4.0) throw new Error(`Suite 3 expected >= +4.0pp lift, got ${formatPct(lift)}`);
  if (k3 <= k0) throw new Error(`Suite 3 expected k>=3 to beat k=0, got ${formatPct(k3)} <= ${formatPct(k0)}`);

  const byHistoryLine = ["0", "1", "2", "3", "4", "5+"]
    .map((key) => `${key}:${formatPct(bucketPercent(byHistory.get(key)))}`)
    .join(" ");
  const aovLine = TAKE_RATES.map((rate) => `${Math.round(rate * 100)}%:+${formatVndShort((hitRevenueVnd * rate) / events)}`).join(
    " ",
  );

  const block = [
    "SUITE 3 - personalization lift (held-out, engine never saw these customers)",
    `  events: ${events}            (target: >= 800)`,
    `  precision@1 global:      ${formatPct(globalPct)}`,
    `  precision@1 personalized:${formatPct(personalizedPct)}`,
    `  lift: +${formatPct(lift).replace("%", "pp")}`,
    `  by history size k: ${byHistoryLine}   (personalized arm)`,
    `  AOV projection @ take-rate {12,20,28,34,40}%: ${aovLine}`,
  ].join("\n");

  console.log("\n" + block + "\n");
  return { block, events, globalPct, personalizedPct, lift };
}

function posOrderToRecord(order: PosOrder): CompletedOrderRecord {
  return {
    customerId: order.customerId,
    orderId: order.id,
    placedAt: `2026-07-${String(order.seq || 1).padStart(2, "0")}T12:00:00.000Z`,
    context: order.context,
    lines: order.lines.map((line) => ({
      catalogId: line.itemId,
      quantity: line.quantity,
      optionIds: line.optionIds ?? [],
    })),
    totalVnd: order.lines.reduce(
      (sum, line) => sum + (getCatalogEntry(line.itemId)?.priceVnd ?? 0) * line.quantity,
      0,
    ),
  };
}

function findPrimaryLine(order: PosOrder) {
  return order.lines.find((line) => {
    const item = getCatalogEntry(line.itemId);
    return item ? MAIN_CATEGORIES.has(item.category) : false;
  });
}

function percent(numerator: number, denominator: number) {
  return denominator ? (100 * numerator) / denominator : 0;
}

function bucketPercent(bucket?: Bucket) {
  return bucket ? percent(bucket.hits, bucket.events) : 0;
}

function formatPct(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatVndShort(value: number) {
  return `${Math.round(value).toLocaleString("vi-VN")} VND`;
}
