import { CATALOG_VERSION, loadCatalog } from "@/lib/menu";
import { isOutOfStock } from "@/lib/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// /api/menu — read-only catalog + live out-of-stock set for the /voice visual
// menu (docs/FEATURE_ITEM_POPUPS.md §5.3). The client bundle already ships the
// static catalog; what it can't know is availability, which lives server-side
// (lib/demo.ts, toggled from /backend → Stock). Not demo-gated: this is the
// same public menu data the agent reads.

export async function GET() {
  const { catalog, source } = await loadCatalog();
  const outOfStock = catalog.filter((item) => isOutOfStock(item.id)).map((item) => item.id);
  return Response.json({ ok: true, catalog, outOfStock, catalogVersion: CATALOG_VERSION, source });
}
