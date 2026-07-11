import { createClient } from "@supabase/supabase-js";
import type { OrderContext } from "./reco/context";

export type CompletedOrderRecord = {
  customerId: string;
  orderId: string;
  placedAt: string;
  context: OrderContext;
  lines: Array<{ catalogId: string; quantity: number; optionIds: string[] }>;
  totalVnd: number;
};

export type SuggestionEvent = {
  customerId: string;
  catalogId: string;
  action: "accepted" | "declined";
  at: string;
};

export interface HistoryStore {
  recordOrder(rec: CompletedOrderRecord): Promise<void>;
  recordSuggestion(ev: SuggestionEvent): Promise<void>;
  getOrders(customerId: string, limit?: number): Promise<CompletedOrderRecord[]>;
  getSuggestions(customerId: string, limit?: number): Promise<SuggestionEvent[]>;
}

class InMemoryHistoryStore implements HistoryStore {
  private orders = new Map<string, CompletedOrderRecord[]>();
  private suggestions = new Map<string, SuggestionEvent[]>();

  async recordOrder(rec: CompletedOrderRecord) {
    const records = this.orders.get(rec.customerId) ?? [];
    records.unshift(rec);
    this.orders.set(rec.customerId, records);
  }

  async recordSuggestion(ev: SuggestionEvent) {
    const events = this.suggestions.get(ev.customerId) ?? [];
    events.unshift(ev);
    this.suggestions.set(ev.customerId, events);
  }

  async getOrders(customerId: string, limit = 25) {
    return [...(this.orders.get(customerId) ?? [])]
      .sort((a, b) => Date.parse(b.placedAt) - Date.parse(a.placedAt))
      .slice(0, limit);
  }

  async getSuggestions(customerId: string, limit = 50) {
    return [...(this.suggestions.get(customerId) ?? [])]
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, limit);
  }

  reset() {
    this.orders.clear();
    this.suggestions.clear();
  }
}

class SupabaseHistoryStore implements HistoryStore {
  private client = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    { auth: { persistSession: false } },
  );

  async recordOrder(rec: CompletedOrderRecord) {
    const { error } = await this.client.from("kfc_customer_history").insert({
      customer_id: rec.customerId,
      order_id: rec.orderId,
      context: rec.context,
      lines: rec.lines,
      total_vnd: rec.totalVnd,
      created_at: rec.placedAt,
    });
    if (error) throw error;
  }

  async recordSuggestion(ev: SuggestionEvent) {
    const { error } = await this.client.from("kfc_suggestion_events").insert({
      customer_id: ev.customerId,
      catalog_id: ev.catalogId,
      action: ev.action,
      created_at: ev.at,
    });
    if (error) throw error;
  }

  async getOrders(customerId: string, limit = 25) {
    const { data, error } = await this.client
      .from("kfc_customer_history")
      .select("customer_id, order_id, context, lines, total_vnd, created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((row) => ({
      customerId: row.customer_id,
      orderId: row.order_id,
      placedAt: row.created_at,
      context: row.context as OrderContext,
      lines: row.lines as CompletedOrderRecord["lines"],
      totalVnd: row.total_vnd,
    }));
  }

  async getSuggestions(customerId: string, limit = 50) {
    const { data, error } = await this.client
      .from("kfc_suggestion_events")
      .select("customer_id, catalog_id, action, created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((row) => ({
      customerId: row.customer_id,
      catalogId: row.catalog_id,
      action: row.action as SuggestionEvent["action"],
      at: row.created_at,
    }));
  }
}

const inMemoryStore = new InMemoryHistoryStore();

function hasSupabaseHistoryEnv() {
  return Boolean(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function getHistoryStore(): HistoryStore {
  return hasSupabaseHistoryEnv() ? new SupabaseHistoryStore() : inMemoryStore;
}

export function resetInMemoryHistory() {
  inMemoryStore.reset();
}
