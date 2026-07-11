import { getOmsStore, type OmsStage } from "@/lib/oms-store";
import { notifyStatusChange } from "@/lib/status-push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// /api/orders — backend Orders module. GET lists the OMS queue; POST advances
// an order's lifecycle stage. Same demo-gate as /api/console: order text is
// real customer data and must not be publicly readable with DEMO_CONTROLS off.

const STAGES: OmsStage[] = ["placed", "preparing", "ready", "completed", "cancelled"];

function enabled() {
  return process.env.DEMO_CONTROLS === "1" || process.env.NODE_ENV !== "production";
}

function isStage(value: unknown): value is OmsStage {
  return typeof value === "string" && (STAGES as string[]).includes(value);
}

export async function GET(request: Request) {
  if (!enabled()) return Response.json({ ok: false }, { status: 404 });
  try {
    const stageParam = new URL(request.url).searchParams.get("stage");
    const stage = isStage(stageParam) ? stageParam : undefined;
    const orders = await getOmsStore().listOrders(40, stage);
    return Response.json({ ok: true, orders });
  } catch (error) {
    return Response.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!enabled()) return Response.json({ ok: false }, { status: 404 });
  try {
    const body = (await request.json().catch(() => ({}))) as { orderId?: string; toStage?: string; note?: string };
    if (!body.orderId || !isStage(body.toStage)) {
      return Response.json({ ok: false, error: "orderId and a valid toStage are required." }, { status: 400 });
    }
    const result = await getOmsStore().advance(body.orderId, body.toStage, body.note);
    if ("error" in result) {
      return Response.json({ ok: false, error: result.error }, { status: 409 });
    }
    // Proactive: tell the customer their order moved. Real Messenger send for
    // Messenger users; the composed message is returned either way so the
    // /backend module can mirror it into the /user phone over the demo bus.
    const notice = await notifyStatusChange(result, body.toStage).catch(() => null);
    return Response.json({ ok: true, order: result, notice });
  } catch (error) {
    return Response.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
