import { getConvoStore } from "@/lib/convo-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// P2-9 — cross-device live mirror. /backend polls this to render the REAL
// Messenger conversation (transcript + order) on the projector, no
// BroadcastChannel needed. Demo-gated like /api/console (customer text).
function enabled() {
  return process.env.DEMO_CONTROLS === "1" || process.env.NODE_ENV !== "production";
}

export async function GET(request: Request) {
  if (!enabled()) return Response.json({ ok: false }, { status: 404 });

  const url = new URL(request.url);
  const convoKey = url.searchParams.get("convo");
  const store = getConvoStore();

  if (!convoKey) {
    const recent = await store.listRecent(8);
    return Response.json({
      ok: true,
      conversations: recent
        .filter((convo) => convo.id.startsWith("messenger:"))
        .map((convo) => ({
          id: convo.id,
          customerId: convo.customerId,
          stage: convo.order?.stage ?? "browsing",
          updatedAt: convo.updatedAt,
          messageCount: convo.messages.length,
        })),
    });
  }

  if (!/^messenger:[\w.-]+$/.test(convoKey)) {
    return Response.json({ ok: false, error: "invalid_convo_key" }, { status: 400 });
  }

  const convo = await store.get(convoKey);
  if (!convo) return Response.json({ ok: false, error: "not_found" }, { status: 404 });

  return Response.json({
    ok: true,
    convo: {
      id: convo.id,
      customerId: convo.customerId,
      updatedAt: convo.updatedAt,
      messages: convo.messages,
      order: convo.order,
    },
  });
}
