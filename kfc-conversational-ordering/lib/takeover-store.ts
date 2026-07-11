// Human takeover flag per channel conversation. When active, the Messenger
// webhook parks inbound messages in the convo transcript and never invokes the
// agent — a human answers from /backend → Hộp thư instead. Supabase-backed
// when configured (the webhook may land on any serverless instance),
// in-memory otherwise (same env-gating as convo-store).
//
// Auto-expiry: a takeover a human walked away from is worse than the bot —
// the customer would be texting into a void. Any takeover older than
// TAKEOVER_TTL_MS since the last operator action silently reverts to the
// agent; every operator reply refreshes the clock.

import { supabaseAdmin } from "./supabase";

export const TAKEOVER_TTL_MS = 60 * 60 * 1000;

export interface TakeoverStore {
  isActive(convoId: string): Promise<boolean>;
  /** Set the flag; also used by operator replies (active=true) to refresh the TTL. */
  set(convoId: string, active: boolean): Promise<void>;
  /** Convo ids with an unexpired active takeover (for the inbox list badges). */
  listActive(): Promise<string[]>;
}

function expired(updatedAt: string | number): boolean {
  const at = typeof updatedAt === "number" ? updatedAt : Date.parse(updatedAt);
  return !Number.isFinite(at) || Date.now() - at > TAKEOVER_TTL_MS;
}

class InMemoryTakeoverStore implements TakeoverStore {
  private flags = new Map<string, { active: boolean; setAt: number }>();

  async isActive(convoId: string) {
    const flag = this.flags.get(convoId);
    return Boolean(flag?.active) && !expired(flag!.setAt);
  }

  async set(convoId: string, active: boolean) {
    this.flags.set(convoId, { active, setAt: Date.now() });
  }

  async listActive() {
    return [...this.flags.entries()]
      .filter(([, flag]) => flag.active && !expired(flag.setAt))
      .map(([id]) => id);
  }

  reset() {
    this.flags.clear();
  }
}

class SupabaseTakeoverStore implements TakeoverStore {
  private client = supabaseAdmin();

  async isActive(convoId: string): Promise<boolean> {
    // Fail closed to "agent answers": a store error must never strand the
    // customer with silence, worst case the bot replies during a takeover.
    const { data, error } = await this.client
      .from("kfc_takeover")
      .select("active, updated_at")
      .eq("convo_id", convoId)
      .maybeSingle();
    if (error || !data) return false;
    return data.active && !expired(data.updated_at);
  }

  async set(convoId: string, active: boolean): Promise<void> {
    // Throw on failure: a toggle the operator believes succeeded but didn't
    // means the agent and the human answer the same customer simultaneously.
    const { error } = await this.client.from("kfc_takeover").upsert({
      convo_id: convoId,
      active,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(`takeover set failed: ${error.message}`);
  }

  async listActive(): Promise<string[]> {
    const { data, error } = await this.client
      .from("kfc_takeover")
      .select("convo_id, updated_at")
      .eq("active", true);
    if (error || !data) return [];
    return data.filter((row) => !expired(row.updated_at)).map((row) => row.convo_id);
  }
}

const memoryStore = new InMemoryTakeoverStore();
let supabaseStore: SupabaseTakeoverStore | null = null;

export function getTakeoverStore(): TakeoverStore {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    if (!supabaseStore) supabaseStore = new SupabaseTakeoverStore();
    return supabaseStore;
  }
  return memoryStore;
}

export function resetInMemoryTakeovers() {
  memoryStore.reset();
}
