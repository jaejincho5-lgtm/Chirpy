// Server-side conversation state for channel (Messenger) sessions.
//
// The web chat resends its full message history every turn, but a channel
// webhook delivers exactly one inbound message — so cart continuity and chat
// history must live server-side, keyed by "channel:senderId". Supabase-backed
// when configured, in-memory otherwise (same env-gating as history-store).

import { supabaseAdmin } from "./supabase";
import type { Order } from "./order";

export type ConvoMessage = { role: "user" | "assistant"; content: string };

export type ConvoRecord = {
  id: string; // `${channel}:${senderId}`
  customerId: string;
  order: Order | null;
  messages: ConvoMessage[];
  updatedAt: string;
};

export interface ConvoStore {
  get(id: string): Promise<ConvoRecord | null>;
  save(rec: ConvoRecord): Promise<void>;
  clear(id: string): Promise<void>;
  /** Most-recently-active conversations (live mirror + ghost-follow-up sweep). */
  listRecent(limit?: number): Promise<ConvoRecord[]>;
}

/** Keep prompts bounded: the newest turns matter, the cart lives in `order`. */
export const CONVO_MESSAGE_CAP = 24;

export function convoId(channel: "messenger", senderId: string) {
  return `${channel}:${senderId}`;
}

/** Stable, route-regex-safe customer id so taste memory accrues per real user. */
export function channelCustomerId(channel: "messenger", senderId: string) {
  const safe = senderId.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  return `msgr_${safe}`.slice(0, 40);
}

class InMemoryConvoStore implements ConvoStore {
  private convos = new Map<string, ConvoRecord>();

  async get(id: string) {
    return this.convos.get(id) ?? null;
  }

  async save(rec: ConvoRecord) {
    this.convos.set(rec.id, rec);
  }

  async clear(id: string) {
    this.convos.delete(id);
  }

  async listRecent(limit = 10) {
    return [...this.convos.values()]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, limit);
  }

  reset() {
    this.convos.clear();
  }
}

class SupabaseConvoStore implements ConvoStore {
  private client = supabaseAdmin();

  async get(id: string): Promise<ConvoRecord | null> {
    const { data, error } = await this.client
      .from("kfc_conversations")
      .select("id, customer_id, order_payload, messages, updated_at")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    return {
      id: data.id,
      customerId: data.customer_id,
      order: (data.order_payload as Order | null) ?? null,
      messages: (data.messages as ConvoMessage[]) ?? [],
      updatedAt: data.updated_at,
    };
  }

  async save(rec: ConvoRecord): Promise<void> {
    await this.client.from("kfc_conversations").upsert({
      id: rec.id,
      customer_id: rec.customerId,
      order_payload: rec.order,
      messages: rec.messages.slice(-CONVO_MESSAGE_CAP),
      updated_at: new Date().toISOString(),
    });
  }

  async clear(id: string): Promise<void> {
    await this.client.from("kfc_conversations").delete().eq("id", id);
  }

  async listRecent(limit = 10): Promise<ConvoRecord[]> {
    const { data, error } = await this.client
      .from("kfc_conversations")
      .select("id, customer_id, order_payload, messages, updated_at")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.map((row) => ({
      id: row.id,
      customerId: row.customer_id,
      order: (row.order_payload as Order | null) ?? null,
      messages: (row.messages as ConvoMessage[]) ?? [],
      updatedAt: row.updated_at,
    }));
  }
}

const memoryStore = new InMemoryConvoStore();
let supabaseStore: SupabaseConvoStore | null = null;

export function getConvoStore(): ConvoStore {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    if (!supabaseStore) supabaseStore = new SupabaseConvoStore();
    return supabaseStore;
  }
  return memoryStore;
}

export function resetInMemoryConvos() {
  memoryStore.reset();
}
