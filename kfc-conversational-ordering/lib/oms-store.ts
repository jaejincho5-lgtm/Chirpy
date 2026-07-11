// OMS order lifecycle store. place_order used to fabricate an order number and
// forget it — kfc_orders / kfc_order_events existed in the schema with no
// writer. This store makes placement durable and gives orders a real lifecycle:
//
//   placed → preparing → ready → completed
//                └────────┴──→ cancelled (from placed/preparing only)
//
// Every transition appends a kfc_order_events row, so /backend's Orders module
// and the check_order_status agent tool read the same timeline the kitchen
// advances. Same Supabase/in-memory dual pattern as history-store.ts.

import { createClient } from "@supabase/supabase-js";
import type { Order } from "./order";

export type OmsStage = "placed" | "preparing" | "ready" | "completed" | "cancelled";

export const OMS_STAGE_FLOW: Record<OmsStage, OmsStage[]> = {
  placed: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["completed"],
  completed: [],
  cancelled: [],
};

// Rough kitchen ETA per stage, for customer-facing status answers.
export const OMS_STAGE_LABEL: Record<OmsStage, { vi: string; etaHint: string | null }> = {
  placed: { vi: "Đã nhận đơn", etaHint: "bếp sẽ nhận trong ít phút" },
  preparing: { vi: "Đang chuẩn bị", etaHint: "khoảng 10-15 phút nữa" },
  ready: { vi: "Sẵn sàng / đang giao", etaHint: "sắp tới nơi" },
  completed: { vi: "Hoàn tất", etaHint: null },
  cancelled: { vi: "Đã hủy", etaHint: null },
};

export type OmsOrderRecord = {
  id: string;
  channel: "web" | "messenger";
  customerId: string | null;
  stage: OmsStage;
  omsOrderNumber: string;
  totalVnd: number;
  itemsSummary: string;
  createdAt: string;
  updatedAt: string;
};

export type OmsOrderEvent = {
  orderId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export interface OmsStore {
  createOrder(order: Order, omsOrderNumber: string): Promise<void>;
  getByOrderNumber(omsOrderNumber: string): Promise<OmsOrderRecord | null>;
  latestForCustomer(customerId: string): Promise<OmsOrderRecord | null>;
  listOrders(limit?: number, stage?: OmsStage): Promise<OmsOrderRecord[]>;
  advance(id: string, toStage: OmsStage, note?: string): Promise<OmsOrderRecord | { error: string }>;
  getEvents(orderId: string, limit?: number): Promise<OmsOrderEvent[]>;
}

function itemsSummary(order: Order) {
  return order.cart.map((line) => `${line.quantity}x ${line.vietnameseName || line.name}`).join(", ");
}

function toRecord(order: Order, omsOrderNumber: string, now: string): OmsOrderRecord {
  return {
    id: order.orderId,
    channel: order.channel,
    customerId: order.customerId ?? null,
    stage: "placed",
    omsOrderNumber,
    totalVnd: order.totals.totalVnd,
    itemsSummary: itemsSummary(order),
    createdAt: now,
    updatedAt: now,
  };
}

function transitionError(from: OmsStage, to: OmsStage) {
  return `Cannot move an order from '${from}' to '${to}'. Allowed: ${OMS_STAGE_FLOW[from].join(", ") || "none"}.`;
}

class InMemoryOmsStore implements OmsStore {
  private orders = new Map<string, OmsOrderRecord & { payload: Order }>();
  private events: OmsOrderEvent[] = [];

  async createOrder(order: Order, omsOrderNumber: string) {
    const now = new Date().toISOString();
    this.orders.set(order.orderId, { ...toRecord(order, omsOrderNumber, now), payload: order });
    this.events.push({
      orderId: order.orderId,
      eventType: "placed",
      payload: { omsOrderNumber, totalVnd: order.totals.totalVnd },
      createdAt: now,
    });
  }

  async getByOrderNumber(omsOrderNumber: string) {
    for (const record of this.orders.values()) {
      if (record.omsOrderNumber === omsOrderNumber) return record;
    }
    return null;
  }

  async latestForCustomer(customerId: string) {
    return (
      [...this.orders.values()]
        .filter((record) => record.customerId === customerId)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null
    );
  }

  async listOrders(limit = 30, stage?: OmsStage) {
    return [...this.orders.values()]
      .filter((record) => !stage || record.stage === stage)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit);
  }

  async advance(id: string, toStage: OmsStage, note?: string) {
    const record = this.orders.get(id);
    if (!record) return { error: "Order not found." };
    if (!OMS_STAGE_FLOW[record.stage].includes(toStage)) {
      return { error: transitionError(record.stage, toStage) };
    }
    const now = new Date().toISOString();
    record.stage = toStage;
    record.updatedAt = now;
    this.events.push({ orderId: id, eventType: toStage, payload: note ? { note } : {}, createdAt: now });
    return record;
  }

  async getEvents(orderId: string, limit = 20) {
    return this.events.filter((event) => event.orderId === orderId).slice(-limit);
  }

  reset() {
    this.orders.clear();
    this.events = [];
  }
}

class SupabaseOmsStore implements OmsStore {
  private client = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    { auth: { persistSession: false } },
  );

  private fromRow(row: Record<string, unknown>): OmsOrderRecord {
    const payload = (row.order_payload ?? {}) as Order;
    return {
      id: row.id as string,
      channel: row.channel as "web" | "messenger",
      customerId: (row.customer_id as string | null) ?? null,
      stage: row.stage as OmsStage,
      omsOrderNumber: (row.oms_order_number as string) ?? "",
      totalVnd: (row.total_vnd as number) ?? 0,
      itemsSummary: payload.cart ? itemsSummary(payload) : "",
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  async createOrder(order: Order, omsOrderNumber: string) {
    const now = new Date().toISOString();
    const { error } = await this.client.from("kfc_orders").insert({
      id: order.orderId,
      channel: order.channel,
      customer_id: order.customerId ?? null,
      stage: "placed",
      order_payload: order,
      oms_order_number: omsOrderNumber,
      total_vnd: order.totals.totalVnd,
      created_at: now,
      updated_at: now,
    });
    if (error) throw error;
    await this.client.from("kfc_order_events").insert({
      order_id: order.orderId,
      event_type: "placed",
      event_payload: { omsOrderNumber, totalVnd: order.totals.totalVnd },
    });
  }

  async getByOrderNumber(omsOrderNumber: string) {
    const { data } = await this.client
      .from("kfc_orders")
      .select("*")
      .eq("oms_order_number", omsOrderNumber)
      .maybeSingle();
    return data ? this.fromRow(data) : null;
  }

  async latestForCustomer(customerId: string) {
    const { data } = await this.client
      .from("kfc_orders")
      .select("*")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ? this.fromRow(data) : null;
  }

  async listOrders(limit = 30, stage?: OmsStage) {
    let query = this.client.from("kfc_orders").select("*").order("created_at", { ascending: false }).limit(limit);
    if (stage) query = query.eq("stage", stage);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((row) => this.fromRow(row));
  }

  async advance(id: string, toStage: OmsStage, note?: string) {
    const { data } = await this.client.from("kfc_orders").select("*").eq("id", id).maybeSingle();
    if (!data) return { error: "Order not found." };
    const record = this.fromRow(data);
    if (!OMS_STAGE_FLOW[record.stage].includes(toStage)) {
      return { error: transitionError(record.stage, toStage) };
    }
    const now = new Date().toISOString();
    const { error } = await this.client
      .from("kfc_orders")
      .update({ stage: toStage, updated_at: now })
      .eq("id", id)
      .eq("stage", record.stage); // optimistic: a concurrent transition loses
    if (error) throw error;
    await this.client.from("kfc_order_events").insert({
      order_id: id,
      event_type: toStage,
      event_payload: note ? { note } : {},
    });
    return { ...record, stage: toStage, updatedAt: now };
  }

  async getEvents(orderId: string, limit = 20) {
    const { data } = await this.client
      .from("kfc_order_events")
      .select("order_id, event_type, event_payload, created_at")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true })
      .limit(limit);
    return (data ?? []).map((row) => ({
      orderId: row.order_id as string,
      eventType: row.event_type as string,
      payload: (row.event_payload ?? {}) as Record<string, unknown>,
      createdAt: row.created_at as string,
    }));
  }
}

const inMemoryOmsStore = new InMemoryOmsStore();

function hasSupabaseEnv() {
  return Boolean(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function getOmsStore(): OmsStore {
  return hasSupabaseEnv() ? new SupabaseOmsStore() : inMemoryOmsStore;
}

export function resetInMemoryOms() {
  inMemoryOmsStore.reset();
}
