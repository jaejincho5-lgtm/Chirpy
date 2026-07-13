"use client";

// Orders module — the live OMS queue. Polls /api/orders every 4s and advances
// an order's lifecycle stage via POST. Buttons render only the valid next
// transitions (mirrors OMS_STAGE_FLOW server-side).

import { useCallback, useEffect, useRef, useState } from "react";
import { vnd, time, ChannelBadge, type OmsOrderRow, type OmsStage } from "./shared";
import { DEMO_BUS, type DemoBusMessage } from "../../demo-shared";

const STAGE_FLOW: Record<OmsStage, OmsStage[]> = {
  placed: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["completed"],
  completed: [],
  cancelled: [],
};

const STAGE_LABEL: Record<OmsStage, string> = {
  placed: "New",
  preparing: "Preparing",
  ready: "Ready",
  completed: "Completed",
  cancelled: "Cancelled",
};

const ACTION_LABEL: Record<OmsStage, string> = {
  placed: "Move to New",
  preparing: "Accept order",
  ready: "Ready",
  completed: "Completed",
  cancelled: "Cancel",
};

const STAGE_ORDER: OmsStage[] = ["placed", "preparing", "ready", "completed", "cancelled"];

// FNV-1a over the order id — a stable, unique-per-order hex digest so the fake
// OMS payload carries a distinct trace/signature for every order row.
function fnv1a(seed: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// The payload we "send" to the OMS dashboard. Purely presentational — the demo
// shows each order syncing over as its own unique JSON document.
function omsPayload(order: OmsOrderRow) {
  const sig = fnv1a(order.id);
  const sig2 = fnv1a(order.id + order.updatedAt);
  return {
    event: "order.sync",
    source: "kfc-ai-agent",
    target: "oms-dashboard",
    oms_order_number: order.omsOrderNumber,
    order_id: order.id,
    channel: order.channel,
    customer_id: order.customerId ?? "guest",
    stage: order.stage,
    items: order.itemsSummary && order.itemsSummary !== "—" ? order.itemsSummary.split(/,\s*/) : [],
    total_vnd: order.totalVnd,
    currency: "VND",
    placed_at: order.createdAt,
    updated_at: order.updatedAt,
    trace_id: `trc_${sig}${sig2}`,
    signature: `hmac-sha256=${sig2}${sig}`,
  };
}

export function OrdersModule() {
  const [orders, setOrders] = useState<OmsOrderRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Order ids we've just notified the customer about. This drives the
  // "customer notified" chip so the operator sees the proactive push landed.
  const [notified, setNotified] = useState<Record<string, string>>({});
  // Clicked order → JSON inspector modal ("fake" API call to the OMS dashboard).
  const [inspect, setInspect] = useState<OmsOrderRow | null>(null);
  const [syncState, setSyncState] = useState<"sending" | "copied">("sending");
  const busRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const bus = new BroadcastChannel(DEMO_BUS);
    busRef.current = bus;
    return () => {
      busRef.current = null;
      bus.close();
    };
  }, []);

  const load = useCallback(async () => {
    const res = await fetch("/api/orders").catch(() => null);
    if (!res?.ok) return;
    const json = (await res.json().catch(() => null)) as { ok: boolean; orders: OmsOrderRow[] } | null;
    if (json?.ok) setOrders(json.orders);
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [load]);

  // Inspector lifecycle: brief "sending" beat sells the fake OMS call, then
  // flips to "copied to dashboard". Escape closes; the JSON also lands on the
  // real clipboard as a bonus (best-effort, ignored if blocked).
  useEffect(() => {
    if (!inspect) return;
    setSyncState("sending");
    const beat = setTimeout(() => setSyncState("copied"), 700);
    navigator.clipboard?.writeText(JSON.stringify(omsPayload(inspect), null, 2)).catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setInspect(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(beat);
      window.removeEventListener("keydown", onKey);
    };
  }, [inspect]);

  async function advance(order: OmsOrderRow, toStage: OmsStage) {
    setBusyId(order.id);
    setError(null);
    // Optimistic: reflect the new stage immediately, revert on failure.
    setOrders((prev) => prev?.map((o) => (o.id === order.id ? { ...o, stage: toStage } : o)) ?? prev);
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: order.id, toStage }),
    }).catch(() => null);
    setBusyId(null);
    if (!res?.ok) {
      const json = (await res?.json().catch(() => null)) as { error?: string } | null;
      setError(json?.error ?? "Could not update status.");
      load(); // reconcile with server truth
      return;
    }
    // Proactive push: the server composed a customer-facing line (and already
    // sent it over Messenger for Messenger users). Mirror it into the /user
    // phone over the demo bus and flag the row as notified.
    const json = (await res.json().catch(() => null)) as { notice?: { message?: string | null } } | null;
    const message = json?.notice?.message;
    if (message) {
      busRef.current?.postMessage({
        kind: "order-status",
        customerId: order.customerId ?? "guest",
        text: message,
      } satisfies DemoBusMessage);
      setNotified((prev) => ({ ...prev, [order.id]: message }));
    }
    load();
  }

  if (!orders) {
    return (
      <section className="ops">
        <p className="rail-title">Orders, OMS queue</p>
        <p className="ops__empty">Loading...</p>
      </section>
    );
  }

  const counts = STAGE_ORDER.map((stage) => ({ stage, n: orders.filter((o) => o.stage === stage).length }));

  return (
    <section className="ops">
      <div className="ops__head">
        <p className="rail-title">Orders, OMS queue (live)</p>
        <div className="oms-counts">
          {counts.map(({ stage, n }) => (
            <span key={stage} className={`oms-count oms-count--${stage}`}>
              {STAGE_LABEL[stage]} {n}
            </span>
          ))}
        </div>
      </div>
      {error ? <p className="oms-error">{error}</p> : null}
      <div className="oms-list">
        {orders.length ? (
          orders.map((order) => (
            <div
              className={`oms-row oms-row--${order.stage} oms-row--clickable`}
              key={order.id}
              role="button"
              tabIndex={0}
              title="View JSON sent to OMS"
              onClick={() => setInspect(order)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setInspect(order);
                }
              }}
            >
              <div className="oms-row__head">
                <b className="oms-row__num">{order.omsOrderNumber}</b>
                <ChannelBadge channel={order.channel} />
                <span className={`oms-stage oms-stage--${order.stage}`}>{STAGE_LABEL[order.stage]}</span>
                <span className="oms-row__time">{time(order.createdAt)}</span>
              </div>
              <p className="oms-row__items">{order.itemsSummary || "—"}</p>
              {notified[order.id] ? (
                <p className="oms-row__notice" title={notified[order.id]}>
                  📲 Customer notified: “{notified[order.id]}”
                </p>
              ) : null}
              <div className="oms-row__foot">
                <span className="oms-row__customer">{order.customerId ?? "guest"}</span>
                <b className="oms-row__total">{vnd(order.totalVnd)}</b>
                <div className="oms-row__actions">
                  {STAGE_FLOW[order.stage].map((next) => (
                    <button
                      key={next}
                      type="button"
                      disabled={busyId === order.id}
                      className={`oms-btn oms-btn--${next}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        advance(order, next);
                      }}
                    >
                      {ACTION_LABEL[next]}
                    </button>
                  ))}
                  {STAGE_FLOW[order.stage].length === 0 ? <span className="oms-terminal">complete</span> : null}
                </div>
              </div>
            </div>
          ))
        ) : (
          <p className="ops__empty">No orders yet. Place an order in /user to see it here.</p>
        )}
      </div>
      {inspect ? (
        <div className="oms-modal-backdrop" onClick={() => setInspect(null)}>
          <div className="oms-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="oms-modal__head">
              <div>
                <b className="oms-modal__num">{inspect.omsOrderNumber}</b>
                <code className="oms-modal__endpoint">POST https://oms.kfc.vn/api/v2/orders/sync</code>
              </div>
              <button type="button" className="oms-modal__close" onClick={() => setInspect(null)} aria-label="Close">
                ✕
              </button>
            </div>
            <pre className="oms-modal__json">{JSON.stringify(omsPayload(inspect), null, 2)}</pre>
            <p className={`oms-modal__status oms-modal__status--${syncState}`}>
              {syncState === "sending" ? "⏳ Sending payload to OMS..." : "✓ Copied to OMS dashboard"}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
