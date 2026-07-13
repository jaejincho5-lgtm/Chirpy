import { z } from "zod";
import { deriveProfile } from "@/lib/profile";
import { decideNudgeForCustomer } from "@/lib/nudge";
import { getCatalogEntry, formatVnd } from "@/lib/menu";
import { suggestAddons } from "@/lib/reco/suggest";
import { normalizeContext } from "@/lib/reco/context";
import { getWorldState } from "@/lib/worldstate";

export const runtime = "nodejs";

// Proactive re-order nudge (demo trigger). The message is composed
// DETERMINISTICALLY from the customer's own history + context — no LLM — so
// the "trigger engine" story is honest: statistics decide, templates speak.
// In production this fires from a scheduler behind opt-in, frequency caps,
// quiet hours, and auto-mute; here /backend's demo clock pulls the trigger.

const bodySchema = z.object({
  customerId: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  context: z
    .object({
      weather: z.enum(["clear", "rainy", "hot"]).optional(),
      hour: z.number().int().min(0).max(23).optional(),
      daysAhead: z.number().int().min(0).max(30).optional(),
    })
    .optional(),
});

function demoEnabled() {
  return process.env.NODE_ENV !== "production" || process.env.DEMO_CONTROLS === "1";
}

export async function POST(request: Request) {
  if (!demoEnabled()) return Response.json({ ok: false, error: "not_found" }, { status: 404 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ ok: false, error: "invalid_body" }, { status: 400 });

  const { customerId } = parsed.data;
  // Operator toggle wins; otherwise use today's real HCMC weather.
  const weather = parsed.data.context?.weather ?? (await getWorldState()).weather;
  const hour = parsed.data.context?.hour ?? 19;
  const daysAhead = parsed.data.context?.daysAhead ?? 1;

  const profile = await deriveProfile(customerId).catch(() => null);
  if (!profile || profile.orderCount === 0 || !profile.usual) {
    return Response.json({
      ok: false,
      reason: "no_history",
      message: "This customer has no order history yet. Nudges are only sent to opted-in returning customers.",
    });
  }

  const usualItem = getCatalogEntry(profile.usual.catalogId);
  if (!usualItem) return Response.json({ ok: false, reason: "usual_missing" });

  // The real trigger: per-customer median-reorder-gap forecast + context
  // window (lib/nudge.ts, precision measured in eval/nudge.ts). The demo
  // clock advances `now` via daysAhead; the decision math is returned
  // verbatim so /backend can show WHY it fired — or why it held.
  const decision = await decideNudgeForCustomer(
    customerId,
    { weather, hour },
    Date.now() + daysAhead * 86_400_000,
  );
  const daysSince = Math.max(1, Math.round(decision.elapsedDays));

  const spice = profile.spice === "spicy" ? " spicy" : "";
  const context = normalizeContext({ weather, hour });
  const addon = suggestAddons([{ catalogId: profile.usual.catalogId, quantity: 1 }], context, profile);

  const opener =
    weather === "rainy"
      ? "Rainy day"
      : weather === "hot"
        ? "Hot day, something cold sounds good"
        : context.daypart === "evening"
          ? "This evening"
          : "Lunch today";
  const gap = daysSince <= 1 ? "You ordered yesterday" : `It has been ${daysSince} days since your last order`;
  const addonLine =
    addon.decision === "suggest" && addon.suggestion
      ? ` Add ${addon.suggestion.name} (${addon.suggestion.displayPrice}) like usual?`
      : "";

  const message =
    `${opener}, want KFC? ${gap}. Your usual is ${usualItem.name}${spice} (${formatVnd(usualItem.priceVnd)}).` +
    `${addonLine} Reply "usual" and I will build the order. Reply "stop" to turn off reminders.`;

  return Response.json({
    ok: true,
    message,
    // `wouldFire` is the honest scheduler decision; the demo button delivers
    // the message regardless (it IS the simulated right-moment), but the
    // console can display the real math next to it.
    wouldFire: decision.fire,
    trigger: {
      decision: decision.reason,
      daysSinceLastOrder: daysSince,
      medianReorderGapDays: decision.medianGapDays,
      overdueThresholdDays: decision.overdueThresholdDays,
      contextMatch: decision.contextMatch,
      usual: profile.usual.catalogId,
      weather,
      daypart: context.daypart,
      guardrails: "opt-in · max 1/week · auto-mute after 2 ignores",
    },
  });
}
