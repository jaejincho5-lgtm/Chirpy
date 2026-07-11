// A1/A4/C9 — the /backend console's data feed: live taste profile, suggestion
// take-rate (real accept/decline events), and AI cost so far. Read-only and
// demo-guarded like /api/demo: enabled outside production or with DEMO_CONTROLS=1.

import { z } from "zod";
import { deriveProfile } from "@/lib/profile";
import { getHistoryStore } from "@/lib/history-store";
import { getCatalogEntry } from "@/lib/menu";
import { usageSummary } from "@/lib/usage-ledger";

const querySchema = z.object({
  customerId: z.string().regex(/^[a-z0-9_:-]{1,64}$/i),
});

function enabled() {
  return process.env.DEMO_CONTROLS === "1" || process.env.NODE_ENV !== "production";
}

export async function GET(req: Request) {
  if (!enabled()) return Response.json({ ok: false }, { status: 404 });

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ customerId: url.searchParams.get("customerId") ?? "" });
  if (!parsed.success) {
    return Response.json({ ok: false, message: "Invalid customerId." }, { status: 400 });
  }
  const { customerId } = parsed.data;

  const [profile, suggestionEvents] = await Promise.all([
    deriveProfile(customerId),
    getHistoryStore().getSuggestions(customerId, 100),
  ]);

  // A4 — take-rate from real persisted accept/decline events, revenue = sum of
  // accepted suggestions' catalog prices (catalog is the source of truth).
  const accepted = suggestionEvents.filter((event) => event.action === "accepted");
  const declined = suggestionEvents.filter((event) => event.action === "declined");
  const acceptedRevenueVnd = accepted.reduce(
    (sum, event) => sum + (getCatalogEntry(event.catalogId)?.priceVnd ?? 0),
    0,
  );

  // Resolve display names server-side so the panel never guesses at the catalog.
  const usualItem = profile.usual ? getCatalogEntry(profile.usual.catalogId) : null;
  const attachRates = Object.entries(profile.attachRates)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([catalogId, rate]) => ({
      catalogId,
      name: getCatalogEntry(catalogId)?.name ?? catalogId,
      rate,
    }));

  return Response.json({
    ok: true,
    profile: {
      customerId: profile.customerId,
      orderCount: profile.orderCount,
      usual: profile.usual
        ? { ...profile.usual, name: usualItem?.name ?? profile.usual.catalogId }
        : null,
      spice: profile.spice,
      attachRates,
      declined: profile.declinedRecently.map((catalogId) => ({
        catalogId,
        name: getCatalogEntry(catalogId)?.name ?? catalogId,
      })),
      avgTicketVnd: profile.avgTicketVnd,
    },
    suggestions: {
      accepted: accepted.length,
      declined: declined.length,
      takeRate: accepted.length + declined.length
        ? accepted.length / (accepted.length + declined.length)
        : null,
      acceptedRevenueVnd,
    },
    cost: usageSummary(customerId),
  });
}
