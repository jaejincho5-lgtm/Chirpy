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
  placed: "Mới",
  preparing: "Đang chuẩn bị",
  ready: "Sẵn sàng",
  completed: "Hoàn tất",
  cancelled: "Đã hủy",
};

const ACTION_LABEL: Record<OmsStage, string> = {
  placed: "Đưa về Mới",
  preparing: "Nhận đơn",
  ready: "Sẵn sàng",
  completed: "Hoàn tất",
  cancelled: "Hủy",
};

const STAGE_ORDER: OmsStage[] = ["placed", "preparing", "ready", "completed", "cancelled"];

export function OrdersModule() {
  const [orders, setOrders] = useState<OmsOrderRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Order ids we've just notified the customer about — drives the "đã nhắn
  // khách" chip so the operator sees the proactive push landed.
  const [notified, setNotified] = useState<Record<string, string>>({});
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
      setError(json?.error ?? "Không cập nhật được trạng thái.");
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
        <p className="rail-title">Đơn hàng, hàng đợi OMS</p>
        <p className="ops__empty">Đang tải…</p>
      </section>
    );
  }

  const counts = STAGE_ORDER.map((stage) => ({ stage, n: orders.filter((o) => o.stage === stage).length }));

  return (
    <section className="ops">
      <div className="ops__head">
        <p className="rail-title">Đơn hàng, hàng đợi OMS (live)</p>
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
            <div className={`oms-row oms-row--${order.stage}`} key={order.id}>
              <div className="oms-row__head">
                <b className="oms-row__num">{order.omsOrderNumber}</b>
                <ChannelBadge channel={order.channel} />
                <span className={`oms-stage oms-stage--${order.stage}`}>{STAGE_LABEL[order.stage]}</span>
                <span className="oms-row__time">{time(order.createdAt)}</span>
              </div>
              <p className="oms-row__items">{order.itemsSummary || "—"}</p>
              {notified[order.id] ? (
                <p className="oms-row__notice" title={notified[order.id]}>
                  📲 Đã nhắn khách: “{notified[order.id]}”
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
                      onClick={() => advance(order, next)}
                    >
                      {ACTION_LABEL[next]}
                    </button>
                  ))}
                  {STAGE_FLOW[order.stage].length === 0 ? <span className="oms-terminal">,  kết thúc , </span> : null}
                </div>
              </div>
            </div>
          ))
        ) : (
          <p className="ops__empty">Chưa có đơn nào. Đặt một đơn ở /user để thấy nó xuất hiện ở đây.</p>
        )}
      </div>
    </section>
  );
}
