// Durable per-turn agent log → kfc_agent_turns. Every real conversation turn
// (web stage + channel webhooks) is stored with its tools, token buckets, and
// latency so nothing is lost to serverless instance churn. Reuse targets:
// /api/stats aggregates, E15 demo replay material, eval-case seeds from real
// transcripts, and post-hoc cost reconciliation against the gateway dashboard.
//
// Writes are strictly fire-and-forget: a logging failure must never break a
// customer turn, so callers use `void logTurn(...)` and errors only warn.

import { supabaseAdmin } from "./supabase";

export type TurnLog = {
  /** kfc_conversations key for channel turns (e.g. "messenger:<psid>"); null for the web stage. */
  convoKey: string | null;
  customerId: string;
  channel: "web" | "messenger";
  model: string;
  userText: string;
  replyText: string;
  toolCalls: string[];
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  latencyMs: number;
};

export async function logTurn(turn: TurnLog): Promise<void> {
  try {
    const { error } = await supabaseAdmin().from("kfc_agent_turns").insert({
      convo_key: turn.convoKey,
      customer_id: turn.customerId,
      channel: turn.channel,
      model: turn.model,
      user_text: turn.userText,
      reply_text: turn.replyText,
      tool_calls: turn.toolCalls,
      input_tokens: turn.inputTokens,
      cached_input_tokens: turn.cachedInputTokens,
      cache_write_tokens: turn.cacheWriteTokens,
      output_tokens: turn.outputTokens,
      latency_ms: turn.latencyMs,
    });
    if (error) console.warn(`turn-log insert failed: ${error.message}`);
  } catch (error) {
    console.warn(`turn-log unavailable: ${(error as Error).message}`);
  }
}
