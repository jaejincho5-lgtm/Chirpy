import { broadcastPromo } from "@/lib/broadcast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// /api/broadcast — staff promo blast. Same demo-gate as /api/orders: this
// writes to real customer channels, so it must not be publicly callable with
// DEMO_CONTROLS off in production.

function enabled() {
  return process.env.DEMO_CONTROLS === "1" || process.env.NODE_ENV !== "production";
}

export async function POST(request: Request) {
  if (!enabled()) return Response.json({ ok: false }, { status: 404 });
  try {
    const body = (await request.json().catch(() => ({}))) as { message?: string };
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) {
      return Response.json({ ok: false, error: "message is required." }, { status: 400 });
    }
    if (message.length > 1800) {
      return Response.json({ ok: false, error: "message exceeds 1800 characters." }, { status: 400 });
    }
    const result = await broadcastPromo(message);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
