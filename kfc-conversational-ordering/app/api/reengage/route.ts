import { z } from "zod";
import {
  CircularMeanPredictor,
  LEAD_MINUTES,
  MIN_CONFIDENCE,
  circularHourDistance,
  decideReengageForCustomer,
  formatHourLabel,
  vnHourOfDay,
  vnNowContext,
} from "@/lib/reengage";
import { getReengageStore } from "@/lib/reengage-store";
import { getHistoryStore } from "@/lib/history-store";
import { seededRandom } from "@/lib/reco/pos-sim";
import { getWorldState } from "@/lib/worldstate";
import type { WeatherSignal } from "@/lib/reco/context";

export const runtime = "nodejs";

const customerIdSchema = z.string().regex(/^[a-z0-9_-]{1,40}$/);
const weatherSchema = z.enum(["clear", "rainy", "hot"]);

const querySchema = z.object({
  customerId: customerIdSchema,
  hour: z.coerce.number().int().min(0).max(23).optional(),
  weather: weatherSchema.optional(),
  daysAhead: z.coerce.number().int().min(0).max(30).optional(),
});

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("optOut"),
    customerId: customerIdSchema,
    optedOut: z.boolean(),
  }),
  z.object({
    action: z.literal("unmute"),
    customerId: customerIdSchema,
  }),
  z.object({
    action: z.literal("simulate"),
    seed: z.number().int().optional().default(4207),
    // Ranges must match what the /backend sim controls allow (days 2-30,
    // noise 0-180) — a stricter cap here made valid-looking inputs 400.
    days: z.number().int().min(2).max(30).optional().default(8),
    trueHour: z.number().min(0).max(24).optional().default(11.5),
    noiseMinutes: z.number().int().min(0).max(180).optional().default(25),
    gapDays: z.number().min(0.5).max(7).optional().default(1),
  }),
]);

function demoEnabled() {
  return process.env.NODE_ENV !== "production" || process.env.DEMO_CONTROLS === "1";
}

function queryFromUrl(request: Request) {
  const params = new URL(request.url).searchParams;
  return {
    customerId: params.get("customerId") ?? undefined,
    hour: params.get("hour") ?? undefined,
    weather: params.get("weather") ?? undefined,
    daysAhead: params.get("daysAhead") ?? undefined,
  };
}

function vnLocalOrderIso(dayIndex: number, gapDays: number, vnHour: number): string {
  const localAsUtcMs = Date.UTC(2026, 0, 1) + dayIndex * gapDays * 86_400_000 + vnHour * 3_600_000;
  return new Date(localAsUtcMs - 7 * 3_600_000).toISOString();
}

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(queryFromUrl(request));
  if (!parsed.success) return Response.json({ ok: false, error: "invalid_query" }, { status: 400 });

  const { customerId } = parsed.data;
  const now = Date.now() + (parsed.data.daysAhead ?? 0) * 86_400_000;
  const weather: WeatherSignal = parsed.data.weather ?? (await getWorldState()).weather;
  const currentContext = vnNowContext(weather, now);
  const context = { weather, hour: parsed.data.hour ?? currentContext.hour };
  const reengageStore = getReengageStore();

  // Decision first (it never persists anything here: persistAutoMute defaults
  // off, so a demo-clock preview can't mute a real customer), THEN the reads —
  // racing them returned prefs that contradicted the decision's gate.
  const decision = await decideReengageForCustomer(customerId, context, now);
  const [orders, notifications, prefs] = await Promise.all([
    getHistoryStore().getOrders(customerId, 25),
    reengageStore.getNotifications(customerId),
    reengageStore.getPrefs(customerId),
  ]);

  const timeline = orders.map((order) => {
    const vnHour = vnHourOfDay(order.placedAt);
    return {
      placedAt: order.placedAt,
      vnHour,
      label: formatHourLabel(vnHour),
      totalVnd: order.totalVnd,
    };
  });

  return Response.json({ ok: true, decision, timeline, notifications, prefs });
}

export async function POST(request: Request) {
  if (!demoEnabled()) return Response.json({ ok: false, error: "not_found" }, { status: 404 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ ok: false, error: "invalid_body" }, { status: 400 });

  const store = getReengageStore();
  const body = parsed.data;

  if (body.action === "optOut") {
    await store.setOptOut(body.customerId, body.optedOut);
    return Response.json({ ok: true });
  }

  if (body.action === "unmute") {
    await store.setMuted(body.customerId, null);
    return Response.json({ ok: true });
  }

  const random = seededRandom(body.seed);
  const predictor = new CircularMeanPredictor();
  const timestamps: string[] = [];
  const rows = [];

  for (let day = 1; day <= body.days; day += 1) {
    const noise = (random() - 0.5 + random() - 0.5 + random() - 0.5) * (body.noiseMinutes / 60);
    const orderHour = body.trueHour + noise;
    const placedAt = vnLocalOrderIso(day, body.gapDays, orderHour);
    timestamps.push(placedAt);

    const prediction = predictor.predictOrderHour(timestamps);
    rows.push({
      day,
      orderTimeLabel: formatHourLabel(vnHourOfDay(placedAt)),
      predictedTimeLabel: prediction.predictedTimeLabel,
      sendTimeLabel:
        prediction.predictedHour === null ? null : formatHourLabel(prediction.predictedHour - LEAD_MINUTES / 60),
      confidence: prediction.confidence,
      sampleCount: prediction.sampleCount,
      resultantLength: prediction.resultantLength,
      spreadMinutes: prediction.spreadMinutes,
      errorMinutes:
        prediction.predictedHour === null
          ? null
          : Math.round(circularHourDistance(prediction.predictedHour, body.trueHour) * 60),
      genericErrorMinutes: Math.round(circularHourDistance(12, body.trueHour) * 60),
    });
  }

  return Response.json({
    ok: true,
    trueHourLabel: formatHourLabel(body.trueHour),
    noiseMinutes: body.noiseMinutes,
    seed: body.seed,
    days: rows,
    minConfidence: MIN_CONFIDENCE,
  });
}
