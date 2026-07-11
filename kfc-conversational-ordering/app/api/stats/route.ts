// C10 — morning-of-demo numbers pulled from real Supabase rows, not invented.
// Aggregates order history + suggestion events, excluding synthetic traffic
// (eval runners, viz personas, webhook flow tests). Demo-guarded like /api/demo.

import { createClient } from "@supabase/supabase-js";
import { getCatalogEntry } from "@/lib/menu";
import { isSyntheticCustomer } from "@/lib/synthetic";

function enabled() {
  return process.env.DEMO_CONTROLS === "1" || process.env.NODE_ENV !== "production";
}

export async function GET() {
  if (!enabled()) return Response.json({ ok: false }, { status: 404 });

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return Response.json({ ok: false, message: "Supabase env not configured (in-memory mode has no durable stats)." }, { status: 503 });
  }
  const client = createClient(url, key, { auth: { persistSession: false } });

  const [ordersRes, suggestionsRes] = await Promise.all([
    client.from("kfc_customer_history").select("customer_id, total_vnd, created_at").limit(2000),
    client.from("kfc_suggestion_events").select("customer_id, catalog_id, action").limit(2000),
  ]);
  if (ordersRes.error) return Response.json({ ok: false, message: ordersRes.error.message }, { status: 500 });
  if (suggestionsRes.error) return Response.json({ ok: false, message: suggestionsRes.error.message }, { status: 500 });

  const orders = (ordersRes.data ?? []).filter((row) => !isSyntheticCustomer(row.customer_id));
  const suggestions = (suggestionsRes.data ?? []).filter((row) => !isSyntheticCustomer(row.customer_id));

  const accepted = suggestions.filter((event) => event.action === "accepted");
  const declined = suggestions.filter((event) => event.action === "declined");
  const acceptedRevenueVnd = accepted.reduce(
    (sum, event) => sum + (getCatalogEntry(event.catalog_id)?.priceVnd ?? 0),
    0,
  );

  // AOV split: customers who accepted ≥1 suggestion vs those who never did.
  const acceptingCustomers = new Set(accepted.map((event) => event.customer_id));
  const avg = (values: number[]) =>
    values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  const aovWithSuggestion = avg(orders.filter((o) => acceptingCustomers.has(o.customer_id)).map((o) => o.total_vnd));
  const aovWithout = avg(orders.filter((o) => !acceptingCustomers.has(o.customer_id)).map((o) => o.total_vnd));

  return Response.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    orders: {
      placed: orders.length,
      distinctCustomers: new Set(orders.map((order) => order.customer_id)).size,
      aovVnd: avg(orders.map((order) => order.total_vnd)),
      aovWithAcceptedSuggestionVnd: aovWithSuggestion,
      aovWithoutVnd: aovWithout,
    },
    suggestions: {
      accepted: accepted.length,
      declined: declined.length,
      takeRate: accepted.length + declined.length ? accepted.length / (accepted.length + declined.length) : null,
      acceptedRevenueVnd,
    },
    note: "Synthetic traffic (eval/viz/flow-test customers) excluded. Handoffs are in-memory tickets — not aggregated here.",
  });
}
