"use client";

// Stock module — out-of-stock toggles per menu item. Posts the full OOS set to
// /api/demo (in-memory server state; the agent refuses OOS items at placement
// and offers substitutes). Menu is static catalog data, safe to import here.

import { useEffect, useState } from "react";
import { MENU_CATALOG } from "@/lib/menu";
import { vnd } from "./shared";

const CATEGORY_LABEL: Record<string, string> = {
  chicken: "Gà",
  combo: "Combo",
  burger: "Burger",
  rice: "Cơm",
  side: "Món phụ",
  drink: "Đồ uống",
  dessert: "Tráng miệng",
};

export function StockModule() {
  const [oos, setOos] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // Hydrate from the server's current OOS set on mount, so a page reload
  // doesn't show "tất cả còn hàng" while the agent is still refusing items.
  useEffect(() => {
    fetch("/api/demo")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { ok?: boolean; outOfStock?: string[] } | null) => {
        if (data?.ok && data.outOfStock?.length) setOos(new Set(data.outOfStock));
      })
      .catch(() => null);
  }, []);

  async function toggle(id: string) {
    const next = new Set(oos);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setBusy(true);
    setOos(next);
    await fetch("/api/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outOfStock: [...next] }),
    }).catch(() => null);
    setBusy(false);
  }

  const categories = [...new Set(MENU_CATALOG.map((item) => item.category))];

  return (
    <section className="ops">
      <div className="ops__head">
        <p className="rail-title">Kho, hết hàng theo món</p>
        <small className="ops__subnote">
          {oos.size ? `${oos.size} món đang đánh dấu hết` : "tất cả còn hàng"}
        </small>
      </div>
      <div className="stock-cats">
        {categories.map((cat) => (
          <div className="stock-cat" key={cat}>
            <p className="stock-cat__title">{CATEGORY_LABEL[cat] ?? cat}</p>
            <div className="stock-items">
              {MENU_CATALOG.filter((item) => item.category === cat).map((item) => {
                const out = oos.has(item.id);
                return (
                  <button
                    type="button"
                    key={item.id}
                    disabled={busy}
                    className={`stock-item ${out ? "stock-item--out" : ""}`}
                    onClick={() => toggle(item.id)}
                  >
                    <span className="stock-item__name">{item.name}</span>
                    <span className="stock-item__price">{vnd(item.priceVnd)}</span>
                    <span className="stock-item__flag">{out ? "HẾT" : "còn"}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
