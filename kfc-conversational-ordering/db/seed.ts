import { MENU_CATALOG } from "../lib/menu";
import { COMBO_CONTENTS } from "../lib/combos";
import { supabaseAdmin } from "../lib/supabase";

const vouchers = [
  {
    code: "KFC20",
    description: "20% off chicken and combo orders, capped at 60,000 VND",
    minimum_subtotal_vnd: 80000,
    discount_type: "percent",
    discount_value: 20,
    max_discount_vnd: 60000,
    is_active: true,
  },
  {
    code: "FREESHIP",
    description: "Free delivery fee for delivery orders",
    minimum_subtotal_vnd: 100000,
    discount_type: "free_delivery",
    discount_value: 0,
    max_discount_vnd: null,
    is_active: true,
  },
  {
    code: "LUNCH50",
    description: "50,000 VND off lunch baskets from 180,000 VND",
    minimum_subtotal_vnd: 180000,
    discount_type: "fixed",
    discount_value: 50000,
    max_discount_vnd: 50000,
    is_active: true,
  },
];

const menuRows = MENU_CATALOG.map((item) => ({
  id: item.id,
  sku: item.sku,
  name: item.name,
  vietnamese_name: item.vietnameseName,
  category: item.category,
  description: item.description,
  price_vnd: item.priceVnd,
  tags: item.tags,
  options: item.options,
  is_active: item.available,
}));

const comboRows = MENU_CATALOG.filter((item) => item.category === "combo").map((item) => ({
  id: item.id,
  serves: item.id.includes("family-4") ? 4 : item.id.includes("party-6") ? 6 : 1,
  headline: item.description,
  included_items: COMBO_CONTENTS[item.id]?.map((slot) => slot.accepts) ?? [],
}));

async function main() {
  const supabase = supabaseAdmin();

  const { error: menuError } = await supabase.from("kfc_menu").upsert(menuRows, { onConflict: "id" });
  if (menuError) throw menuError;

  const { error: comboError } = await supabase.from("kfc_combos").upsert(comboRows, { onConflict: "id" });
  if (comboError) throw comboError;

  const { error: voucherError } = await supabase.from("kfc_vouchers").upsert(vouchers, { onConflict: "code" });
  if (voucherError) throw voucherError;

  console.log(`Seeded ${menuRows.length} KFC menu rows, ${comboRows.length} combos, ${vouchers.length} vouchers.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
