import { sweepGhostedConversations } from "@/lib/followup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ghost-follow-up sweep. Idempotent and internally guarded (mid-funnel stages
// only, ≥10-min silence, one send per convo per 24h via kfc_followups), so a
// stray public GET can at worst trigger a legitimate follow-up early.
// Called by the Vercel cron (vercel.json) and opportunistically by /api/console.
export async function GET() {
  const results = await sweepGhostedConversations().catch((error: Error) => ({ error: error.message }));
  return Response.json({ ok: true, results, sweptAt: new Date().toISOString() });
}
