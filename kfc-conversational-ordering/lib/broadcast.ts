// Staff promotion broadcast: a KFC operator composes a promo in /backend and
// blasts it to customers on the channel they already use. The judge's ask —
// "let staff upload a promotion and it sends itself out" — realized as a
// deterministic fan-out over the persisted Messenger conversations.
//
// Guardrails mirror lib/followup.ts: Messenger conversations only, never
// synthetic (eval/probe) customers, and only inside Messenger's 24h standard
// messaging window (outside it, a promo needs a paid message tag — out of scope
// for the demo, so we simply skip those and report the count).

import { getConvoStore } from "./convo-store";
import { sendChannelReply } from "./channel";
import { isSyntheticCustomer } from "./synthetic";
import { logTurn } from "./turn-log";

/** Stay inside Messenger's 24h standard-messaging window (23h for send slack). */
const WINDOW_MAX_HOURS = 23;

export type BroadcastResult = {
  /** Conversations that matched the window + channel guards and were attempted. */
  attempted: number;
  /** Attempts that the channel API actually accepted. */
  sent: number;
  results: Array<{ convoKey: string; sent: boolean; reason?: string }>;
};

/**
 * Fan a promo message out to eligible recent Messenger conversations. Real send
 * requires MESSENGER_TOKEN (sendChannelReply no-ops without it), so on a
 * token-less local/demo run this reports attempted:0..N, sent:0 — the /backend
 * module's demo-bus mirror is what makes the blast visible on stage.
 */
export async function broadcastPromo(message: string, limit = 50): Promise<BroadcastResult> {
  const store = getConvoStore();
  const now = Date.now();
  const recent = await store.listRecent(limit);
  const results: BroadcastResult["results"] = [];
  let sent = 0;

  for (const convo of recent) {
    if (!convo.id.startsWith("messenger:")) continue;
    if (isSyntheticCustomer(convo.customerId)) continue;
    const ageHours = (now - Date.parse(convo.updatedAt)) / 3_600_000;
    if (!Number.isFinite(ageHours) || ageHours > WINDOW_MAX_HOURS) continue;

    const senderId = convo.id.slice("messenger:".length);
    const delivery = await sendChannelReply("messenger", senderId, message);
    results.push({ convoKey: convo.id, sent: delivery.sent, reason: delivery.reason });

    if (delivery.sent) {
      sent += 1;
      await store
        .save({ ...convo, messages: [...convo.messages, { role: "assistant", content: message }] })
        .catch(() => null);
      void logTurn({
        convoKey: convo.id,
        customerId: convo.customerId,
        channel: "messenger",
        model: "promo-broadcast",
        userText: "(no reply — staff promo broadcast)",
        replyText: message,
        toolCalls: ["broadcast"],
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
      });
    }
  }

  return { attempted: results.length, sent, results };
}
