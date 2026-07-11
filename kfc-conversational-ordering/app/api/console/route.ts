import { supabaseAdmin } from "@/lib/supabase";
import { estimateCostUsd, usdToVnd } from "@/lib/usage-ledger";
import { isSyntheticCustomer } from "@/lib/synthetic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// /api/console — the ops feed behind /backend's "transactions & analysis"
// section. Aggregates DURABLE rows (kfc_agent_turns, kfc_customer_history,
// kfc_suggestion_events) so every channel shows up — the web stage, real
// Messenger traffic, everything — regardless of which serverless instance
// served it. Synthetic traffic (evals, probes, flow tests) is shown in the
// feed flagged `synthetic:true` but excluded from every KPI.

type TurnRow = {
  created_at: string;
  convo_key: string | null;
  customer_id: string;
  channel: "web" | "messenger";
  model: string;
  user_text: string;
  reply_text: string;
  tool_calls: string[];
  input_tokens: number;
  cached_input_tokens: number;
  cache_write_tokens: number;
  output_tokens: number;
  latency_ms: number;
};

type HistoryRow = {
  created_at: string;
  customer_id: string;
  order_id: string;
  total_vnd: number;
  lines: Array<{ catalogId: string; quantity: number }>;
};

function percentile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

// Same demo-gate as /api/stats: the feed contains real customer chat text, so
// it must never be publicly readable on a deployment with DEMO_CONTROLS off.
function enabled() {
  return process.env.DEMO_CONTROLS === "1" || process.env.NODE_ENV !== "production";
}

// Opportunistic ghost-follow-up sweep: Vercel Hobby crons are daily at best,
// but /backend polls this route every 4s while open — throttle to one sweep
// per 2 minutes per warm instance. Fire-and-forget; never delays the feed.
let lastSweepAt = 0;
function maybeSweepFollowups() {
  const now = Date.now();
  if (now - lastSweepAt < 120_000) return;
  lastSweepAt = now;
  void import("@/lib/followup")
    .then((mod) => mod.sweepGhostedConversations())
    .catch(() => null);
}

export async function GET() {
  if (!enabled()) return Response.json({ ok: false }, { status: 404 });
  maybeSweepFollowups();
  try {
    const supa = supabaseAdmin();
    const [turnsRes, ordersRes, suggestionsRes] = await Promise.all([
      supa
        .from("kfc_agent_turns")
        .select(
          "created_at, convo_key, customer_id, channel, model, user_text, reply_text, tool_calls, input_tokens, cached_input_tokens, cache_write_tokens, output_tokens, latency_ms",
        )
        .order("created_at", { ascending: false })
        .limit(60),
      supa
        .from("kfc_customer_history")
        .select("created_at, customer_id, order_id, total_vnd, lines")
        .order("created_at", { ascending: false })
        .limit(200),
      supa.from("kfc_suggestion_events").select("customer_id, action, created_at"),
    ]);

    const turns = (turnsRes.data ?? []) as TurnRow[];
    const historyOrders = (ordersRes.data ?? []) as HistoryRow[];
    const suggestionEvents = (suggestionsRes.data ?? []) as Array<{
      customer_id: string;
      action: "accepted" | "declined";
    }>;

    // ── Transactions feed (all channels, synthetic flagged) ────────────────
    const feed = turns.map((turn) => {
      const buckets = {
        inputTokens: turn.input_tokens,
        cachedInputTokens: turn.cached_input_tokens,
        cacheWriteTokens: turn.cache_write_tokens,
        outputTokens: turn.output_tokens,
      };
      const costUsd = estimateCostUsd(turn.model, buckets);
      return {
        at: turn.created_at,
        channel: turn.channel,
        customerId: turn.customer_id,
        synthetic: isSyntheticCustomer(turn.customer_id),
        userText: turn.user_text.slice(0, 160),
        replyText: turn.reply_text.slice(0, 200),
        tools: turn.tool_calls ?? [],
        model: turn.model,
        tokens: {
          input: turn.input_tokens,
          reads: turn.cached_input_tokens,
          writes: turn.cache_write_tokens,
          output: turn.output_tokens,
        },
        latencyMs: turn.latency_ms,
        costVnd: costUsd === null ? null : usdToVnd(costUsd),
        placedOrder: (turn.tool_calls ?? []).includes("place_order"),
      };
    });

    // ── KPIs over REAL traffic only ─────────────────────────────────────────
    const realTurns = turns.filter((turn) => !isSyntheticCustomer(turn.customer_id));
    const totals = { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
    let costUsdTotal = 0;
    let costKnown = 0;
    const channelCounts: Record<string, number> = { web: 0, messenger: 0 };
    for (const turn of realTurns) {
      totals.inputTokens += turn.input_tokens;
      totals.cachedInputTokens += turn.cached_input_tokens;
      totals.cacheWriteTokens += turn.cache_write_tokens;
      totals.outputTokens += turn.output_tokens;
      channelCounts[turn.channel] = (channelCounts[turn.channel] ?? 0) + 1;
      const usd = estimateCostUsd(turn.model, {
        inputTokens: turn.input_tokens,
        cachedInputTokens: turn.cached_input_tokens,
        cacheWriteTokens: turn.cache_write_tokens,
        outputTokens: turn.output_tokens,
      });
      if (usd !== null) {
        costUsdTotal += usd;
        costKnown += 1;
      }
    }
    const latencies = realTurns.map((turn) => turn.latency_ms).sort((a, b) => a - b);

    const realOrders = historyOrders.filter((order) => !isSyntheticCustomer(order.customer_id));
    const orderTotal = realOrders.reduce((sum, order) => sum + order.total_vnd, 0);

    const realSuggestions = suggestionEvents.filter((event) => !isSyntheticCustomer(event.customer_id));
    const accepted = realSuggestions.filter((event) => event.action === "accepted").length;
    const declined = realSuggestions.filter((event) => event.action === "declined").length;

    return Response.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      kpis: {
        orders: realOrders.length,
        distinctCustomers: new Set(realOrders.map((order) => order.customer_id)).size,
        aovVnd: realOrders.length ? Math.round(orderTotal / realOrders.length) : null,
        suggestions: {
          accepted,
          declined,
          takeRate: accepted + declined ? accepted / (accepted + declined) : null,
        },
        turns: realTurns.length,
        channels: channelCounts,
        latency: { p50Ms: percentile(latencies, 0.5), p95Ms: percentile(latencies, 0.95) },
        tokens: totals,
        aiCost: {
          usd: costKnown ? Number(costUsdTotal.toFixed(4)) : null,
          vnd: costKnown ? usdToVnd(costUsdTotal) : null,
          coveredTurns: costKnown,
        },
      },
      orders: realOrders.slice(0, 12).map((order) => ({
        at: order.created_at,
        customerId: order.customer_id,
        orderId: order.order_id,
        totalVnd: order.total_vnd,
        itemCount: (order.lines ?? []).reduce((sum, line) => sum + (line.quantity ?? 1), 0),
        channel: order.customer_id.startsWith("msgr_") ? "messenger" : "web",
      })),
      turns: feed,
      note: "KPIs exclude synthetic traffic (evals/probes/flow tests); the feed shows it flagged. Cost is estimated from stored token buckets — the AI Gateway dashboard is authoritative.",
    });
  } catch (error) {
    return Response.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
