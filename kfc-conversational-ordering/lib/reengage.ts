// Nudge v2 — the predictive re-engagement engine. Extends lib/nudge.ts (the
// day-level "is this customer overdue" gate) with an HOUR-level send-time
// prediction: a recency-weighted circular mean of the customer's own order
// times. Statistics decide, templates speak — no LLM anywhere in the trigger.
//
// Circular math matters here: hours wrap. A naive average of 23:30 and 00:30
// predicts noon; the vector mean correctly predicts midnight. Each order's
// hour becomes a unit vector on the 24h circle, recent orders weigh more
// (half-life decay by order recency), and the resultant length R ∈ [0,1] is a
// free concentration measure: R→1 means a tight habitual window, R→0 means
// the customer orders at random times and we should NOT claim to know better.
//
// Confidence = R x sample factor, so it is low for BOTH sparse history and
// scattered history — the two honest reasons not to send.
//
// The Predictor interface is the swap point: replace CircularMeanPredictor
// with logistic regression / gradient boosting later without touching the
// decision gates, scanner, API, or console.
//
// Gates (in order, first failure wins):
//   opted_out → muted (2 ignored notifications auto-mute) → day-level nudge
//   gate (insufficient_history / not_overdue / context_mismatch, lib/nudge.ts)
//   → cooldown (max 1 per COOLDOWN_DAYS) → low_confidence → quiet_hours.
// The Messenger 24h-window guard lives at the delivery layer (scanner), where
// conversation recency is known.

import { decideNudge, reorderGapsDays, type NudgeDecision } from "./nudge";
import { getHistoryStore } from "./history-store";
import { deriveProfileFromRecords } from "./profile";
import { getCatalogEntry } from "./menu";
import { loadVouchers } from "./vouchers";
import { getDaypart, normalizeContext, type OrderContext } from "./reco/context";
import {
  getReengageStore,
  type ReengageNotification,
  type ReengagePrefs,
} from "./reengage-store";

/** Vietnam is UTC+7, no DST — a constant offset is correct, not a shortcut. */
export const VN_UTC_OFFSET_HOURS = 7;
/** Send this many minutes before the predicted order time (spec: 10-15). */
export const LEAD_MINUTES = 12;
/** Hour prediction needs at least this many completed orders. */
export const MIN_ORDERS_FOR_HOUR = 3;
/** Recency half-life: the 3rd-newest order weighs half the newest. */
export const HALF_LIFE_ORDERS = 3;
/** Only the most recent orders inform the hour habit (habits drift). */
export const MAX_HOUR_SAMPLES = 12;
/** Minimum confidence to send — below this the habit claim is not honest. */
export const MIN_CONFIDENCE = 0.6;
/** Max 1 proactive notification per customer per week (nudge doctrine). */
export const COOLDOWN_DAYS = 7;
/** No proactive sends outside 08:00-21:00 VN time. */
export const QUIET_HOURS = { startHour: 8, endHour: 21 };
/** A notification with no order within this window counts as ignored. */
export const IGNORE_AFTER_HOURS = 48;
/** This many consecutive ignored notifications auto-mute the customer. */
export const AUTO_MUTE_AFTER_IGNORES = 2;
/**
 * The customer's OWN habitual hour counts as an appetite window: when the
 * confident prediction says they order around now, a global-context miss
 * (e.g. clear-sky lunch) must not block the send — otherwise the daily
 * lunch-window cron can never reach lunch-habit customers. ± hours around
 * the predicted hour that qualify.
 */
export const PERSONAL_WINDOW_HOURS = 1;

export type HourPrediction = {
  /** Fractional VN-local hour of day [0,24), or null below MIN_ORDERS_FOR_HOUR-1. */
  predictedHour: number | null;
  /** "HH:MM" VN-local, or null. */
  predictedTimeLabel: string | null;
  /** 0..1 — resultant length x sample factor. */
  confidence: number;
  /** Orders actually used (capped at MAX_HOUR_SAMPLES). */
  sampleCount: number;
  /** Circular concentration R ∈ [0,1] of the weighted hour vectors. */
  resultantLength: number;
  /** ± minutes of circular std dev around the predicted hour. */
  spreadMinutes: number | null;
};

/**
 * The swap point for smarter models later (logistic regression, GBM, RL):
 * same inputs (order timestamps), same output shape, same gates around it.
 */
export interface Predictor {
  name: string;
  predictOrderHour(placedAtsIso: string[]): HourPrediction;
}

/** Fractional VN-local hour of day for an ISO timestamp. */
export function vnHourOfDay(iso: string): number {
  const ms = Date.parse(iso);
  const utcHour = (((ms % 86_400_000) + 86_400_000) % 86_400_000) / 3_600_000;
  return (utcHour + VN_UTC_OFFSET_HOURS) % 24;
}

/** "HH:MM" for a fractional hour, wrapping midnight. */
export function formatHourLabel(hourFloat: number): string {
  const totalMinutes = ((Math.round(hourFloat * 60) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const mm = String(totalMinutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Shortest distance between two hours on the 24h circle, in hours. */
export function circularHourDistance(a: number, b: number): number {
  const raw = Math.abs(a - b) % 24;
  return Math.min(raw, 24 - raw);
}

export class CircularMeanPredictor implements Predictor {
  name = "circular-mean-v1";

  predictOrderHour(placedAtsIso: string[]): HourPrediction {
    // Newest first; only valid timestamps; cap the window so habits can drift.
    const times = placedAtsIso
      .map((at) => Date.parse(at))
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => b - a)
      .slice(0, MAX_HOUR_SAMPLES);
    const sampleCount = times.length;

    if (sampleCount < MIN_ORDERS_FOR_HOUR - 1) {
      return {
        predictedHour: null,
        predictedTimeLabel: null,
        confidence: 0,
        sampleCount,
        resultantLength: 0,
        spreadMinutes: null,
      };
    }

    // Weighted vector sum on the 24h circle, newest orders heaviest.
    let x = 0;
    let y = 0;
    let weightSum = 0;
    times.forEach((ms, index) => {
      const hour = vnHourOfDay(new Date(ms).toISOString());
      const angle = (hour / 24) * 2 * Math.PI;
      const weight = Math.pow(0.5, index / HALF_LIFE_ORDERS);
      x += weight * Math.cos(angle);
      y += weight * Math.sin(angle);
      weightSum += weight;
    });

    const resultantLength = Math.min(1, Math.hypot(x, y) / weightSum);
    const meanAngle = Math.atan2(y, x);
    const predictedHour = ((meanAngle / (2 * Math.PI)) * 24 + 24) % 24;

    // Circular std dev → honest ± minutes; sample factor ramps 2→5 orders.
    const sigmaRad = Math.sqrt(-2 * Math.log(Math.max(resultantLength, 1e-9)));
    const spreadMinutes = Math.round((sigmaRad / (2 * Math.PI)) * 24 * 60);
    const sampleFactor = Math.min(1, (sampleCount - 1) / 4);
    const confidence = Number((resultantLength * sampleFactor).toFixed(3));

    return {
      predictedHour,
      predictedTimeLabel: formatHourLabel(predictedHour),
      confidence,
      sampleCount,
      resultantLength,
      spreadMinutes,
    };
  }
}

export const defaultPredictor: Predictor = new CircularMeanPredictor();

export type ReengageGate =
  | "ok"
  | "opted_out"
  | "muted"
  | "insufficient_history"
  | "not_overdue"
  | "context_mismatch"
  | "cooldown"
  | "low_confidence"
  | "quiet_hours";

export type ReengageDecision = {
  shouldSend: boolean;
  /** First failing gate, or "ok". */
  gate: ReengageGate;
  /** "HH:MM" VN-local predicted order time (null without a prediction). */
  predictedOrderTime: string | null;
  /** "HH:MM" VN-local — LEAD_MINUTES before the predicted order time. */
  recommendedSendTime: string | null;
  confidence: number;
  prediction: HourPrediction;
  /** Day-level math (lib/nudge.ts) shown verbatim on the console. */
  nudge: NudgeDecision;
  /** Days until the cooldown lifts (null when not in cooldown). */
  cooldownDaysLeft: number | null;
  /** Whether this decision just crossed the auto-mute threshold. */
  autoMuted: boolean;
  /** Deterministic model explanation for the console + README honesty. */
  explanation: string;
};

export type ReengagePureInputs = {
  placedAtsIso: string[];
  context: OrderContext;
  prefs: ReengagePrefs;
  notifications: ReengageNotification[];
  now: number;
  predictor?: Predictor;
};

/** True when the customer ordered at all after this notification went out. */
function orderedAfter(notification: ReengageNotification, placedAtsIso: string[]): boolean {
  const sentMs = Date.parse(notification.sentAt);
  return placedAtsIso.some((at) => Date.parse(at) > sentMs);
}

/**
 * Ignored = old enough to judge (IGNORE_AFTER_HOURS elapsed) and no order
 * followed it. AUTO_MUTE_AFTER_IGNORES consecutive ignores → mute. Honest and
 * observable: we never claim open-tracking Messenger does not give us.
 */
export function countConsecutiveIgnores(
  notifications: ReengageNotification[],
  placedAtsIso: string[],
  now: number,
): number {
  const newestFirst = [...notifications].sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt));
  let ignores = 0;
  for (const notification of newestFirst) {
    const ageHours = (now - Date.parse(notification.sentAt)) / 3_600_000;
    if (ageHours < IGNORE_AFTER_HOURS) continue; // too fresh to judge
    if (orderedAfter(notification, placedAtsIso)) break; // streak broken
    ignores += 1;
    if (ignores >= AUTO_MUTE_AFTER_IGNORES) break;
  }
  return ignores;
}

/**
 * Pure decision core — every input is passed in so tests and the eval harness
 * can drive thousands of timelines without a store or a clock.
 */
export function decideReengage(inputs: ReengagePureInputs): ReengageDecision {
  const { placedAtsIso, context, prefs, notifications, now } = inputs;
  const predictor = inputs.predictor ?? defaultPredictor;

  const prediction = predictor.predictOrderHour(placedAtsIso);
  const gaps = reorderGapsDays(placedAtsIso);
  const lastPlacedMs = placedAtsIso
    .map((at) => Date.parse(at))
    .filter((t) => Number.isFinite(t))
    .reduce((max, t) => Math.max(max, t), Number.NEGATIVE_INFINITY);
  const elapsedDays = Number.isFinite(lastPlacedMs) ? Math.max(0, (now - lastPlacedMs) / 86_400_000) : 0;
  const nudge = decideNudge(gaps, elapsedDays, context);

  const base: Omit<ReengageDecision, "gate" | "shouldSend" | "explanation"> = {
    predictedOrderTime: prediction.predictedTimeLabel,
    recommendedSendTime:
      prediction.predictedHour === null
        ? null
        : formatHourLabel(prediction.predictedHour - LEAD_MINUTES / 60),
    confidence: prediction.confidence,
    prediction,
    nudge,
    cooldownDaysLeft: null,
    autoMuted: false,
  };

  const fail = (gate: ReengageGate, explanation: string): ReengageDecision => ({
    ...base,
    shouldSend: false,
    gate,
    explanation,
  });

  if (prefs.optedOut) return fail("opted_out", "Khách đã nhắn 'dừng', không gửi thông báo chủ động.");
  if (prefs.mutedAt) {
    return fail("muted", "Đã tự tắt sau 2 thông báo bị bỏ qua, chỉ bật lại khi khách chủ động quay lại.");
  }

  const ignores = countConsecutiveIgnores(notifications, placedAtsIso, now);
  if (ignores >= AUTO_MUTE_AFTER_IGNORES) {
    return {
      ...fail("muted", `${ignores} thông báo liên tiếp bị bỏ qua, tự tắt để tránh làm phiền.`),
      autoMuted: true,
    };
  }

  // Day-level gate first (lib/nudge.ts): is this customer actually overdue,
  // in an appetite window, with enough history to estimate a cadence?
  if (nudge.reason === "insufficient_history") {
    return fail(
      "insufficient_history",
      `Chưa đủ lịch sử (cần ≥${MIN_ORDERS_FOR_HOUR} đơn) để dự đoán nhịp đặt hàng.`,
    );
  }
  if (nudge.reason === "not_overdue") {
    return fail(
      "not_overdue",
      `Khách chưa quá nhịp đặt của chính họ (median ${nudge.medianGapDays?.toFixed(1)} ngày · đã ${nudge.elapsedDays.toFixed(1)} ngày · ngưỡng ${nudge.overdueThresholdDays?.toFixed(1)} ngày).`,
    );
  }
  if (nudge.reason === "context_mismatch") {
    // Personal-window override: a confident prediction that the customer
    // habitually orders around NOW is itself the appetite signal — the global
    // windows (rain/heat/evening) exist for customers we know less about.
    const hourNow = normalizeContext(context).hour;
    const inPersonalWindow =
      prediction.predictedHour !== null &&
      prediction.confidence >= MIN_CONFIDENCE &&
      circularHourDistance(hourNow, prediction.predictedHour) <= PERSONAL_WINDOW_HOURS;
    if (!inPersonalWindow) {
      return fail(
        "context_mismatch",
        "Đã quá nhịp nhưng ngoài khung thèm ăn (mưa / nóng / buổi tối) và ngoài khung giờ quen của khách.",
      );
    }
  }

  // Cooldown: at most one proactive send per COOLDOWN_DAYS.
  const lastSentMs = notifications.reduce(
    (max, notification) => Math.max(max, Date.parse(notification.sentAt)),
    Number.NEGATIVE_INFINITY,
  );
  if (Number.isFinite(lastSentMs)) {
    const daysSinceSend = (now - lastSentMs) / 86_400_000;
    if (daysSinceSend < COOLDOWN_DAYS) {
      const left = Math.ceil(COOLDOWN_DAYS - daysSinceSend);
      return {
        ...fail("cooldown", `Đã gửi trong ${COOLDOWN_DAYS} ngày qua, còn ${left} ngày cooldown.`),
        cooldownDaysLeft: left,
      };
    }
  }

  if (prediction.predictedHour === null || prediction.confidence < MIN_CONFIDENCE) {
    const why =
      prediction.predictedHour === null || prediction.sampleCount < MIN_ORDERS_FOR_HOUR
        ? `mới ${prediction.sampleCount} đơn có giờ`
        : `giờ đặt phân tán (R=${prediction.resultantLength.toFixed(2)})`;
    return fail(
      "low_confidence",
      `Độ tin cậy ${prediction.confidence.toFixed(2)} < ${MIN_CONFIDENCE} (${why}), chưa đủ chắc để chủ động nhắn.`,
    );
  }

  // Quiet hours on the SEND time (VN local).
  const sendHour = ((prediction.predictedHour - LEAD_MINUTES / 60) % 24 + 24) % 24;
  if (sendHour < QUIET_HOURS.startHour || sendHour >= QUIET_HOURS.endHour) {
    return fail(
      "quiet_hours",
      `Giờ gửi dự kiến ${formatHourLabel(sendHour)} nằm ngoài khung ${QUIET_HOURS.startHour}:00-${QUIET_HOURS.endHour}:00.`,
    );
  }

  const daypartWord = daypartWordVi(prediction.predictedHour);
  return {
    ...base,
    shouldSend: true,
    gate: "ok",
    explanation:
      `Khách đặt ổn định vào buổi ${daypartWord}, quanh ${prediction.predictedTimeLabel}` +
      `${prediction.spreadMinutes !== null ? ` (±${prediction.spreadMinutes} phút)` : ""}, ` +
      `${prediction.sampleCount} đơn gần nhất, độ tập trung ${(prediction.resultantLength * 100).toFixed(0)}%. ` +
      `Gửi trước ${LEAD_MINUTES} phút: ${base.recommendedSendTime}.`,
  };
}

export type ReengageCustomerDecision = ReengageDecision & {
  customerId: string;
  /** Display names of the recommended items (usual first). */
  recommendedItems: string[];
  /** An applicable active voucher code to mention, if any. */
  voucherCode: string | null;
  /** Composed notification text (only when shouldSend). */
  message: string | null;
};

/** One source of truth for daypart → Vietnamese word (explanation + opener). */
function daypartWordVi(hour: number): string {
  const daypart = getDaypart(Math.round(hour) % 24);
  return daypart === "breakfast" ? "sáng" : daypart === "lunch" ? "trưa" : daypart === "afternoon" ? "chiều" : "tối";
}

function composeMessage(
  decision: ReengageDecision,
  usualName: string | null,
  voucher: { code: string; description: string } | null,
): string {
  const word = daypartWordVi(decision.prediction.predictedHour ?? 12);
  const opener = `${word.charAt(0).toUpperCase()}${word.slice(1)} nay`;
  const dish = usualName ? `${usualName} như mọi khi nhé?` : "ghé KFC một bữa nhé?";
  const voucherLine = voucher ? ` Bạn còn voucher ${voucher.code} (${voucher.description}) chưa dùng đó.` : "";
  return `${opener} 🍗 ${dish}${voucherLine} Nhắn "như cũ" là mình lên đơn liền. (Nhắn "dừng" để tắt thông báo.)`;
}

export type ReengageDecideOptions = {
  /**
   * Persist the auto-mute when the threshold is crossed. The SCANNER (real
   * clock, real send pipeline) wants this; read-only console previews must
   * pass false — a demo clock advanced +N days makes fresh notifications look
   * ignored, and a GET must never write a (future-dated!) mute onto a real
   * customer.
   */
  persistAutoMute?: boolean;
  predictor?: Predictor;
};

/**
 * Store-backed wrapper used by /api/reengage and the cron scanner. `now` is
 * injectable for the demo clock.
 */
export async function decideReengageForCustomer(
  customerId: string,
  context: OrderContext,
  now: number = Date.now(),
  options: ReengageDecideOptions = {},
): Promise<ReengageCustomerDecision> {
  const historyStore = getHistoryStore();
  const reengageStore = getReengageStore();

  const [orders, suggestions, prefs, notifications] = await Promise.all([
    historyStore.getOrders(customerId, 50),
    historyStore.getSuggestions(customerId, 50),
    reengageStore.getPrefs(customerId),
    reengageStore.getNotifications(customerId, 10),
  ]);
  const placedAtsIso = orders.map((order) => order.placedAt);

  const decision = decideReengage({
    placedAtsIso,
    context,
    prefs,
    notifications,
    now,
    predictor: options.predictor,
  });
  if (decision.autoMuted && options.persistAutoMute) {
    await reengageStore.setMuted(customerId, new Date(now).toISOString()).catch(() => null);
  }

  // Personalization from the records already in hand — no second fetch.
  const profile = deriveProfileFromRecords(orders, suggestions, customerId);
  const usualItem = profile?.usual ? getCatalogEntry(profile.usual.catalogId) : null;
  const recommendedItems = usualItem ? [usualItem.name] : [];

  let voucher: { code: string; description: string } | null = null;
  if (decision.shouldSend) {
    const vouchers = await loadVouchers().catch(() => []);
    const avgTicket = profile?.avgTicketVnd ?? 0;
    const applicable = vouchers
      .filter((rule) => rule.minimumSubtotalVnd <= Math.max(avgTicket, 60_000))
      .sort((a, b) => a.minimumSubtotalVnd - b.minimumSubtotalVnd)[0];
    if (applicable) voucher = { code: applicable.code, description: applicable.description };
  }

  return {
    ...decision,
    customerId,
    recommendedItems,
    voucherCode: voucher?.code ?? null,
    message: decision.shouldSend ? composeMessage(decision, usualItem?.name ?? null, voucher) : null,
  };
}

/** Context helper for the scanner: VN-local hour + normalized weather. */
export function vnNowContext(weather: OrderContext["weather"], now: number = Date.now()): OrderContext {
  const hour = Math.floor(vnHourOfDay(new Date(now).toISOString()));
  return normalizeContext({ weather, hour });
}
