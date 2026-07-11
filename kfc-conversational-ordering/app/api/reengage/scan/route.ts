import { sendChannelReply } from "@/lib/channel";
import { getConvoStore } from "@/lib/convo-store";
import { getReengageStore } from "@/lib/reengage-store";
import { LEAD_MINUTES, decideReengageForCustomer, vnHourOfDay, vnNowContext } from "@/lib/reengage";
import { isSyntheticCustomer } from "@/lib/synthetic";
import { logTurn } from "@/lib/turn-log";
import { getWorldState } from "@/lib/worldstate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReengageScanResult = { convoKey: string; sent: boolean; reason?: string };

const WINDOW_MAX_HOURS = 23;

/**
 * A coarse (Hobby-tier: daily) cron must not drop a customer whose personal
 * moment just slipped past — a nudge 45 minutes late still beats never, so
 * the due window runs [send - 30min, predicted + 45min].
 */
const DUE_GRACE_HOURS = 0.75;

/** Mid-funnel conversations belong to the ghost-followup sweep (lib/followup.ts);
 * re-engaging them here would double-contact the customer in one Messenger window. */
const MID_FUNNEL_STAGES = new Set(["cart", "quoted", "otp_requested"]);

function inDueWindow(currentHour: number, sendHour: number, predictedHour: number) {
  const start = ((sendHour - 0.5) % 24 + 24) % 24;
  const end = (((predictedHour + DUE_GRACE_HOURS) % 24) + 24) % 24;
  const current = ((currentHour % 24) + 24) % 24;
  if (start <= end) return current >= start && current <= end;
  return current >= start || current <= end;
}

// Vercel Hobby supports daily cron only. Production-grade "10 minutes before
// each customer personal time" needs Pro-tier minute-level cron, for example */15.
export async function GET() {
  const sweptAt = new Date().toISOString();
  const results: ReengageScanResult[] = [];
  const store = getConvoStore();
  const reengageStore = getReengageStore();
  const world = await getWorldState();
  const now = Date.now();
  const currentVnHour = vnHourOfDay(sweptAt);
  const context = vnNowContext(world.weather, now);
  const recent = await store.listRecent(50);

  for (const convo of recent) {
    if (!convo.id.startsWith("messenger:")) continue;
    if (isSyntheticCustomer(convo.customerId)) continue;

    // Messenger's standard messaging window is 24h; use 23h to leave send slack.
    const ageHours = (now - Date.parse(convo.updatedAt)) / 3_600_000;
    if (!Number.isFinite(ageHours) || ageHours > WINDOW_MAX_HOURS) continue;

    // An open cart/OTP means the followup sweep already owns this customer.
    if (MID_FUNNEL_STAGES.has(convo.order?.stage ?? "")) {
      results.push({ convoKey: convo.id, sent: false, reason: "mid_funnel_followup_owns" });
      continue;
    }

    try {
      const decision = await decideReengageForCustomer(convo.customerId, context, now, {
        persistAutoMute: true,
      });
      if (!decision.shouldSend) {
        results.push({ convoKey: convo.id, sent: false, reason: decision.gate });
        continue;
      }
      if (!decision.message) {
        results.push({ convoKey: convo.id, sent: false, reason: "no_message" });
        continue;
      }
      if (decision.prediction.predictedHour === null) {
        results.push({ convoKey: convo.id, sent: false, reason: "no_prediction" });
        continue;
      }

      const predictedHour = decision.prediction.predictedHour;
      const sendHour = ((predictedHour - LEAD_MINUTES / 60) % 24 + 24) % 24;
      if (!inDueWindow(currentVnHour, sendHour, predictedHour)) {
        results.push({ convoKey: convo.id, sent: false, reason: "not_due" });
        continue;
      }

      const senderId = convo.id.slice("messenger:".length);
      const message = decision.message;
      const delivery = await sendChannelReply("messenger", senderId, message);
      results.push({ convoKey: convo.id, sent: delivery.sent, reason: delivery.reason });

      if (delivery.sent) {
        await reengageStore.recordNotification({
          customerId: convo.customerId,
          channel: "messenger",
          message,
          predictedFor: decision.predictedOrderTime,
          confidence: decision.confidence,
          sentAt: new Date().toISOString(),
        }).catch(() => null);
        await store
          .save({ ...convo, messages: [...convo.messages, { role: "assistant", content: message }] })
          .catch(() => null);
        void logTurn({
          convoKey: convo.id,
          customerId: convo.customerId,
          channel: "messenger",
          model: "reengage-scan",
          userText: "(no reply - predictive re-engagement)",
          replyText: message,
          toolCalls: ["reengage-scan"],
          inputTokens: 0,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 0,
          latencyMs: 0,
        });
      }
    } catch (error) {
      results.push({ convoKey: convo.id, sent: false, reason: (error as Error).message });
    }
  }

  return Response.json({ ok: true, results, sweptAt });
}
