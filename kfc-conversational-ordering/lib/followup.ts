// Ghosted-conversation follow-up: a customer built a cart (or was mid-OTP),
// the agent asked a question, and they went silent — exactly the 2026-07-06
// real-phone session shape. One deterministic, zero-LLM re-engagement message
// per conversation per 24h, only inside Messenger's messaging window.
//
// Guardrails: mid-funnel stages only (cart/quote/otp), last speaker was the
// agent, ghost gap ≥ GHOST_AFTER_MIN, conversation younger than 23h (the
// send must stay inside Messenger's 24h window), and the kfc_followups row
// makes each conversation eligible at most once per day.

import { getConvoStore } from "./convo-store";
import { sendChannelReply } from "./channel";
import { supabaseAdmin } from "./supabase";
import { logTurn } from "./turn-log";
import { isSyntheticCustomer } from "./synthetic";

const GHOST_AFTER_MIN = 10;
const WINDOW_MAX_HOURS = 23;
const MID_FUNNEL_STAGES = new Set(["cart", "quoted", "otp_requested"]);

export type FollowupResult = { convoKey: string; sent: boolean; reason?: string };

function composeFollowup(itemCount: number, total: string | null): string {
  const cartLine = itemCount
    ? `Giỏ của bạn vẫn còn ${itemCount} món${total ? ` (${total})` : ""} nhé.`
    : "Đơn của bạn vẫn đang mở nhé.";
  return `Bạn còn đó không? ${cartLine} Nhắn tiếp để mình hoàn tất đơn, hoặc "hủy" nếu bạn đổi ý 😊`;
}

/**
 * Sweep recent Messenger conversations and send at most one follow-up each.
 * Deterministic and idempotent — safe to call from a cron AND opportunistically.
 */
export async function sweepGhostedConversations(): Promise<FollowupResult[]> {
  const results: FollowupResult[] = [];
  const store = getConvoStore();
  const supa = supabaseAdmin();
  const now = Date.now();

  const recent = await store.listRecent(20);
  for (const convo of recent) {
    if (!convo.id.startsWith("messenger:")) continue;
    // Never follow up eval/probe/flow-test conversations.
    if (isSyntheticCustomer(convo.customerId)) continue;

    const ageMin = (now - Date.parse(convo.updatedAt)) / 60_000;
    if (ageMin < GHOST_AFTER_MIN || ageMin > WINDOW_MAX_HOURS * 60) continue;

    const stage = convo.order?.stage ?? "browsing";
    if (!MID_FUNNEL_STAGES.has(stage)) continue;

    const lastMessage = convo.messages[convo.messages.length - 1];
    if (!lastMessage || lastMessage.role !== "assistant") continue;

    // At most one follow-up per conversation per 24h — the insert is the lock;
    // a stale lock (>24h) is reclaimed by updating it.
    const { error: lockError } = await supa
      .from("kfc_followups")
      .insert({ convo_key: convo.id, sent_at: new Date().toISOString() });
    if (lockError) {
      const { data: existing } = await supa
        .from("kfc_followups")
        .select("sent_at")
        .eq("convo_key", convo.id)
        .maybeSingle();
      const lockAgeMs = existing ? now - Date.parse(existing.sent_at) : 0;
      if (!existing || lockAgeMs < 24 * 3_600_000) continue;
      await supa
        .from("kfc_followups")
        .update({ sent_at: new Date().toISOString() })
        .eq("convo_key", convo.id);
    }

    const senderId = convo.id.slice("messenger:".length);
    const itemCount = convo.order?.cart.reduce((sum, line) => sum + line.quantity, 0) ?? 0;
    const total = convo.order?.totals?.displayTotal ?? null;
    const message = composeFollowup(itemCount, total);

    const delivery = await sendChannelReply("messenger", senderId, message);
    results.push({ convoKey: convo.id, sent: delivery.sent, reason: delivery.reason });

    if (delivery.sent) {
      // Keep the transcript coherent for the next turn + visible on /backend.
      await store
        .save({ ...convo, messages: [...convo.messages, { role: "assistant", content: message }] })
        .catch(() => null);
      void logTurn({
        convoKey: convo.id,
        customerId: convo.customerId,
        channel: "messenger",
        model: "followup-template",
        userText: "(no reply, ghost follow-up trigger)",
        replyText: message,
        toolCalls: ["followup"],
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
      });
    } else {
      // Delivery failed — release the lock so a later sweep can retry.
      await supa.from("kfc_followups").delete().eq("convo_key", convo.id);
    }
  }

  return results;
}
