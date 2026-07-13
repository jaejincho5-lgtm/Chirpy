"use client";

// The always-available visual menu for /voice (docs/FEATURE_ITEM_POPUPS.md
// §3.3): a collapsible panel docked to the right edge of the phone frame,
// collapsed by default behind a slim "Menu" handle. Every row adds through
// the same agent-guarded quickAdd path as the popups. The catalog comes from
// the page's one /api/menu fetch — the AGENT's live view (Supabase when
// configured), so the panel never offers an item the agent can't match; the
// static MENU_CATALOG is only the fallback while that fetch is pending/failed.

import { useMemo, useState } from "react";
import { MENU_CATALOG, normalizeText, formatVnd, toMenuMatch, type MenuCategory, type MenuItem, type MenuMatch } from "@/lib/menu";
import type { Order } from "@/lib/order";

const CATEGORY_LABELS: Record<MenuCategory, string> = {
  chicken: "Chicken",
  combo: "Combo",
  burger: "Burger",
  rice: "Rice & Pasta",
  side: "Sides",
  drink: "Drinks",
  dessert: "Dessert",
};
const CATEGORY_ORDER: MenuCategory[] = ["combo", "chicken", "burger", "rice", "side", "drink", "dessert"];

type Props = {
  open: boolean;
  onToggle: (open: boolean) => void;
  isBusy: boolean;
  outOfStock: Set<string>;
  latestOrder: Order | undefined;
  onAdd: (match: MenuMatch) => void;
  catalog: MenuItem[] | null;
};

export default function MenuPanel({ open, onToggle, isBusy, outOfStock, latestOrder, onAdd, catalog }: Props) {
  const [query, setQuery] = useState("");

  const items = catalog && catalog.length > 0 ? catalog : MENU_CATALOG;
  const groups = useMemo(() => {
    const needle = normalizeText(query);
    const rows = items.filter((item) => {
      if (!needle) return true;
      return normalizeText([item.name, item.vietnameseName, ...item.tags].join(" ")).includes(needle);
    });
    return CATEGORY_ORDER.map((category) => ({
      category,
      label: CATEGORY_LABELS[category],
      items: rows.filter((item) => item.category === category),
    })).filter((group) => group.items.length > 0);
  }, [query, items]);

  function handleAdd(item: MenuItem) {
    if (isBusy || outOfStock.has(item.id)) return;
    onAdd(toMenuMatch(item));
  }

  return (
    <aside className={`voice-menu ${open ? "is-open" : ""}`} aria-label="Menu KFC">
      <button
        type="button"
        className="voice-menu__handle"
        aria-expanded={open}
        onClick={() => onToggle(!open)}
      >
        <span aria-hidden>🍗</span> Menu
      </button>

      <div className="voice-menu__sheet" aria-hidden={!open}>
        <div className="voice-menu__head">
          <b>Menu</b>
          <button type="button" className="voice-menu__close" aria-label="Close menu" onClick={() => onToggle(false)}>
            ×
          </button>
        </div>
        <input
          className="voice-menu__search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search menu..."
          type="search"
          tabIndex={open ? 0 : -1}
        />
        <div className="voice-menu__list">
          {groups.length === 0 ? <p className="voice-menu__empty">No items found.</p> : null}
          {groups.map((group) => (
            <section key={group.category} className="voice-menu__group">
              <h4 className="voice-menu__group-title">{group.label}</h4>
              {group.items.map((item) => {
                const oos = outOfStock.has(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`voice-menu__row ${oos ? "is-oos" : ""}`}
                    disabled={isBusy || oos}
                    aria-label={oos ? `${item.name} temporarily out of stock` : `Add ${item.name} to cart, ${formatVnd(item.priceVnd)}`}
                    onClick={() => handleAdd(item)}
                    tabIndex={open ? 0 : -1}
                  >
                    <span className="voice-menu__row-main">
                      <b>{item.name}</b>
                      <small>
                        {item.description}
                        {item.popular ? <em className="voice-menu__hot"> 🔥 Popular</em> : null}
                        {oos ? <em className="voice-menu__oos-tag"> · unavailable</em> : null}
                      </small>
                    </span>
                    <span className="voice-menu__row-price">{formatVnd(item.priceVnd)}</span>
                  </button>
                );
              })}
            </section>
          ))}
        </div>
        {latestOrder && latestOrder.cart.length > 0 ? (
          <footer className="voice-menu__cart">
            {latestOrder.cart.length} items · <b>{latestOrder.totals.displayTotal}</b>
          </footer>
        ) : null}
      </div>
    </aside>
  );
}
