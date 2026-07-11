import { supabaseAdmin } from "@/lib/supabase";
import { VOUCHERS, invalidateVoucherCache, type VoucherDiscountType } from "@/lib/vouchers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// /api/vouchers — backend Vouchers module. GET lists all rules (active +
// inactive) from kfc_vouchers; POST creates or toggles a rule and invalidates
// the runtime cache. Falls back to the hardcoded VOUCHERS when keyless.
// Demo-gated like /api/console.

const DISCOUNT_TYPES: VoucherDiscountType[] = ["percent", "fixed", "free_delivery"];

function enabled() {
  return process.env.DEMO_CONTROLS === "1" || process.env.NODE_ENV !== "production";
}

function hasSupabase() {
  return Boolean(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

// Shape returned to the UI — one row per rule regardless of source.
function fallbackRows() {
  return VOUCHERS.map((v) => ({
    code: v.code,
    description: v.description,
    minimum_subtotal_vnd: v.minimumSubtotalVnd,
    discount_type: v.discountType,
    discount_value: v.percent ?? v.fixedVnd ?? 0,
    max_discount_vnd: v.maxDiscountVnd ?? null,
    is_active: true,
  }));
}

export async function GET() {
  if (!enabled()) return Response.json({ ok: false }, { status: 404 });
  if (!hasSupabase()) return Response.json({ ok: true, vouchers: fallbackRows(), source: "fallback" });
  try {
    const { data, error } = await supabaseAdmin()
      .from("kfc_vouchers")
      .select("code, description, minimum_subtotal_vnd, discount_type, discount_value, max_discount_vnd, is_active")
      .order("code", { ascending: true });
    if (error) throw error;
    return Response.json({ ok: true, vouchers: data ?? [], source: "db" });
  } catch (error) {
    return Response.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!enabled()) return Response.json({ ok: false }, { status: 404 });
  if (!hasSupabase()) {
    return Response.json({ ok: false, error: "Voucher management requires Supabase configuration." }, { status: 503 });
  }
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = body.action;
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    if (!code) return Response.json({ ok: false, error: "code is required." }, { status: 400 });

    const supa = supabaseAdmin();

    if (action === "toggle") {
      const isActive = Boolean(body.isActive);
      const { data, error } = await supa
        .from("kfc_vouchers")
        .update({ is_active: isActive, updated_at: new Date().toISOString() })
        .eq("code", code)
        .select()
        .maybeSingle();
      if (error) throw error;
      if (!data) return Response.json({ ok: false, error: "Voucher not found." }, { status: 404 });
      invalidateVoucherCache();
      return Response.json({ ok: true, voucher: data });
    }

    if (action === "create") {
      const discountType = body.discountType as VoucherDiscountType;
      if (!DISCOUNT_TYPES.includes(discountType)) {
        return Response.json({ ok: false, error: "Invalid discountType." }, { status: 400 });
      }
      const row = {
        code,
        description: typeof body.description === "string" ? body.description : code,
        minimum_subtotal_vnd: Math.max(0, Number(body.minimumSubtotalVnd) || 0),
        discount_type: discountType,
        discount_value: Math.max(0, Number(body.discountValue) || 0),
        max_discount_vnd:
          body.maxDiscountVnd === null || body.maxDiscountVnd === undefined
            ? null
            : Math.max(0, Number(body.maxDiscountVnd)),
        is_active: true,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await supa.from("kfc_vouchers").upsert(row).select().maybeSingle();
      if (error) throw error;
      invalidateVoucherCache();
      return Response.json({ ok: true, voucher: data });
    }

    return Response.json({ ok: false, error: "Unknown action (expected 'create' or 'toggle')." }, { status: 400 });
  } catch (error) {
    return Response.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
