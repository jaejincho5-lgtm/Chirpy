import { getLoyaltyStore } from "@/lib/loyalty";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// /api/loyalty — backend Customers module. Lists loyalty members (the account
// IS the messaging identity: msgr_<psid> or the web persona id). Demo-gated
// like /api/console — balances are per-customer data.

function enabled() {
  return process.env.DEMO_CONTROLS === "1" || process.env.NODE_ENV !== "production";
}

export async function GET() {
  if (!enabled()) return Response.json({ ok: false }, { status: 404 });
  try {
    const members = await getLoyaltyStore().listMembers(50);
    return Response.json({ ok: true, members });
  } catch (error) {
    return Response.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
