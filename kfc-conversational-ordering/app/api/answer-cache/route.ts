import { getAnswerCacheStats } from "@/lib/answer-cache";

// Ops feed for the /backend shared-answer-memory card: entries, hits,
// hit-rate, and the most-hit questions. Never throws to the client — a store
// hiccup returns an all-zero shape so the panel still renders.
export async function GET() {
  try {
    const stats = await getAnswerCacheStats();
    return Response.json({ ok: true, ...stats });
  } catch {
    return Response.json({ ok: false, lookups: 0, hits: 0, entries: 0, hitRate: 0, topQuestions: [] });
  }
}
