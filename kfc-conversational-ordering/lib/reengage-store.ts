// Durable state for the re-engagement engine (lib/reengage.ts): per-customer
// prefs (explicit opt-out, auto-mute) and the notification send log that
// powers the cooldown gate, the auto-mute counter, and the /backend history
// panel. Same env-gated Supabase/in-memory split as history-store.ts.
//
// Deliberately NO "opened" tracking: Messenger gives no honest open signal,
// so the only outcomes we record are ones we can observe — a send, and
// whether an order followed it (derived from kfc_customer_history at read
// time, never stored as a guess).

import { createClient } from "@supabase/supabase-js";

export type ReengagePrefs = {
  customerId: string;
  /** Customer said "stop notifications": hard stop until they opt back in. */
  optedOut: boolean;
  /** Set by the auto-mute rule (2 consecutive ignored sends); null = active. */
  mutedAt: string | null;
};

export type ReengageNotification = {
  customerId: string;
  channel: "messenger" | "web";
  message: string;
  /** "HH:MM" VN-local predicted order time this send targeted. */
  predictedFor: string | null;
  confidence: number;
  sentAt: string;
};

export interface ReengageStore {
  getPrefs(customerId: string): Promise<ReengagePrefs>;
  setOptOut(customerId: string, optedOut: boolean): Promise<void>;
  setMuted(customerId: string, mutedAt: string | null): Promise<void>;
  recordNotification(notification: ReengageNotification): Promise<void>;
  getNotifications(customerId: string, limit?: number): Promise<ReengageNotification[]>;
}

const defaultPrefs = (customerId: string): ReengagePrefs => ({
  customerId,
  optedOut: false,
  mutedAt: null,
});

class InMemoryReengageStore implements ReengageStore {
  private prefs = new Map<string, ReengagePrefs>();
  private notifications = new Map<string, ReengageNotification[]>();

  async getPrefs(customerId: string) {
    return this.prefs.get(customerId) ?? defaultPrefs(customerId);
  }

  async setOptOut(customerId: string, optedOut: boolean) {
    const current = await this.getPrefs(customerId);
    this.prefs.set(customerId, { ...current, optedOut });
  }

  async setMuted(customerId: string, mutedAt: string | null) {
    const current = await this.getPrefs(customerId);
    this.prefs.set(customerId, { ...current, mutedAt });
  }

  async recordNotification(notification: ReengageNotification) {
    const list = this.notifications.get(notification.customerId) ?? [];
    list.unshift(notification);
    this.notifications.set(notification.customerId, list);
  }

  async getNotifications(customerId: string, limit = 10) {
    return [...(this.notifications.get(customerId) ?? [])]
      .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt))
      .slice(0, limit);
  }

  reset() {
    this.prefs.clear();
    this.notifications.clear();
  }
}

class SupabaseReengageStore implements ReengageStore {
  private client = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    { auth: { persistSession: false } },
  );

  async getPrefs(customerId: string) {
    const { data, error } = await this.client
      .from("kfc_reengage_prefs")
      .select("customer_id, opted_out, muted_at")
      .eq("customer_id", customerId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return defaultPrefs(customerId);
    return {
      customerId: data.customer_id as string,
      optedOut: Boolean(data.opted_out),
      mutedAt: (data.muted_at as string | null) ?? null,
    };
  }

  async setOptOut(customerId: string, optedOut: boolean) {
    const { error } = await this.client.from("kfc_reengage_prefs").upsert({
      customer_id: customerId,
      opted_out: optedOut,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  }

  async setMuted(customerId: string, mutedAt: string | null) {
    const { error } = await this.client.from("kfc_reengage_prefs").upsert({
      customer_id: customerId,
      muted_at: mutedAt,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  }

  async recordNotification(notification: ReengageNotification) {
    const { error } = await this.client.from("kfc_reengage_notifications").insert({
      customer_id: notification.customerId,
      channel: notification.channel,
      message: notification.message,
      predicted_for: notification.predictedFor,
      confidence: notification.confidence,
      sent_at: notification.sentAt,
    });
    if (error) throw error;
  }

  async getNotifications(customerId: string, limit = 10) {
    const { data, error } = await this.client
      .from("kfc_reengage_notifications")
      .select("customer_id, channel, message, predicted_for, confidence, sent_at")
      .eq("customer_id", customerId)
      .order("sent_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((row) => ({
      customerId: row.customer_id as string,
      channel: (row.channel as "messenger" | "web") ?? "messenger",
      message: row.message as string,
      predictedFor: (row.predicted_for as string | null) ?? null,
      confidence: Number(row.confidence ?? 0),
      sentAt: row.sent_at as string,
    }));
  }
}

const inMemoryStore = new InMemoryReengageStore();

function hasSupabaseEnv() {
  return Boolean(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function getReengageStore(): ReengageStore {
  return hasSupabaseEnv() ? new SupabaseReengageStore() : inMemoryStore;
}

export function resetInMemoryReengage() {
  inMemoryStore.reset();
}
