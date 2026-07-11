"use client";

// Floating item cards over the /voice stage (docs/FEATURE_ITEM_POPUPS.md §3.1).
// When the ambassador's latest turn surfaced menu items, they spring in as a
// small cluster low over the avatar; tapping one routes the add through the
// agent (quickAdd → submit → add_to_cart) — never a client-side cart mutation.
// The layer itself is pointer-events:none so it can never block the avatar's
// tap-to-repeat hit area; only the cards are interactive.

import { useEffect, useMemo, useRef, useState } from "react";
import type { MenuMatch } from "@/lib/menu";
import { lastAssistantId, surfacedItems, type VoiceMessage } from "@/lib/voice-items";

const MAX_CARDS = 4;
// 20s, not the spec's ~12s: the countdown only starts at turn completion, but
// the chicken then SPEAKS the line for ~4-6s — 12s left too little quiet time
// to actually read and tap a card (verified live).
const AUTO_DISMISS_MS = 20_000;

type Props = {
  messages: VoiceMessage[];
  isBusy: boolean;
  outOfStock: Set<string>;
  onAdd: (match: MenuMatch) => void;
  onOpenMenu: () => void;
};

export default function ItemPopups({ messages, isBusy, outOfStock, onAdd, onOpenMenu }: Props) {
  const turnKey = lastAssistantId(messages);
  // Uncapped pull so the "+N nữa" overflow count is honest; capped for render.
  const all = useMemo(() => surfacedItems(messages, 99), [messages]);
  const items = all.slice(0, MAX_CARDS);
  const overflow = all.length - items.length;

  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [expired, setExpired] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoveredRef = useRef(false);

  function clearTimer() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function armTimer() {
    clearTimer();
    timerRef.current = setTimeout(() => {
      // A held/hovered card never times out (§3.1) — re-arm and check later.
      if (hoveredRef.current) armTimer();
      else setExpired(true);
    }, AUTO_DISMISS_MS);
  }

  // A genuinely new assistant turn resets the cluster.
  useEffect(() => {
    setDismissed(new Set());
    setExpired(false);
    setAddingId(null);
  }, [turnKey]);

  // The dismiss timer only starts once the turn has COMPLETED (§3.1: cards
  // appear "the same moment the page speaks it"). The assistant message id —
  // and therefore turnKey — exists from the first streamed token, so arming on
  // turnKey alone burned most of the 12s while the agent was still composing.
  useEffect(() => {
    if (!turnKey || isBusy) return;
    armTimer();
    return clearTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnKey, isBusy]);

  const visible = items.filter((item) => !dismissed.has(item.catalogId));
  if (!turnKey || expired || visible.length === 0) return null;
  // While the agent composes: hide the cluster (stale turn's items) — except a
  // just-tapped card, which stays as the "Đang thêm…" optimistic anchor.
  const shown = isBusy ? visible.filter((item) => item.catalogId === addingId) : visible;
  if (shown.length === 0) return null;

  function dismiss(catalogId: string) {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(catalogId);
      return next;
    });
  }

  function handleAdd(item: MenuMatch) {
    if (isBusy || addingId || outOfStock.has(item.catalogId)) return;
    setAddingId(item.catalogId);
    onAdd(item);
  }

  return (
    <div
      className="voice-popups"
      onMouseEnter={() => {
        hoveredRef.current = true;
      }}
      onMouseLeave={() => {
        hoveredRef.current = false;
      }}
    >
      {shown.map((item, index) => {
        const oos = outOfStock.has(item.catalogId);
        const adding = addingId === item.catalogId;
        return (
          <div
            key={`${turnKey}-${item.catalogId}`}
            className={`voice-popup ${oos ? "is-oos" : ""} ${adding ? "is-adding" : ""}`}
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <button
              type="button"
              className="voice-popup__dismiss"
              aria-label={`Ẩn ${item.name}`}
              onClick={() => dismiss(item.catalogId)}
            >
              ×
            </button>
            <button
              type="button"
              className="voice-popup__body"
              aria-label={oos ? `${item.name} tạm hết hàng` : `Thêm ${item.name} vào giỏ — ${item.displayPrice}`}
              disabled={isBusy || oos || addingId !== null}
              onClick={() => handleAdd(item)}
            >
              <span className="voice-popup__cat">{item.category}</span>
              <b className="voice-popup__name">{item.name}</b>
              <span className="voice-popup__desc">{item.description}</span>
              <span className="voice-popup__price">{item.displayPrice}</span>
              {oos ? <span className="voice-popup__ribbon">tạm hết</span> : null}
              {adding ? (
                <span className="voice-popup__state">{isBusy ? "Đang thêm…" : "✓ Đã thêm"}</span>
              ) : null}
            </button>
          </div>
        );
      })}
      {overflow > 0 ? (
        <button type="button" className="voice-popup voice-popup--more" onClick={onOpenMenu}>
          +{overflow} nữa
        </button>
      ) : null}
    </div>
  );
}
