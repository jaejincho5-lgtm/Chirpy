// Learned global answer cache. When the agent answers a general question for one
// customer, we store the answer so ANY customer asking the same thing later gets
// it in ~1ms with no LLM call. This sits BEHIND the curated FAQ cache
// (lib/faq-cache) and inherits its philosophy: NEVER WRONG beats always-hit. A
// miss only costs latency; a wrong hit costs trust — so every gate below biases
// hard toward missing.
//
// What makes a wrong hit impossible here:
//   1. Same GUARD + question-shape gate as the curated cache (isEvergreenQuestion)
//      — an order/checkout/mutation message can neither store nor hit.
//   2. Only turns that used ZERO tool calls are stored — any tool means the answer
//      depended on live data (price, stock, points, order status), so it must
//      never be replayed to a different customer or a later moment.
//   3. No personalization is stored — a reply with an order number / long digit
//      run (points, order id) or the asker's own id is rejected.
//   4. Every entry is stamped with CATALOG_VERSION and expires after 24h, so a
//      menu/price change can never serve a stale claim.
//
// Same env-gated Supabase/in-memory split as reengage-store.ts / history-store.ts.

import { createClient } from "@supabase/supabase-js";
import { CATALOG_VERSION } from "./menu";
import { isEvergreenQuestion, normalize } from "./faq-cache";

const TTL_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_ENTRIES = 500;
const MAX_REPLY_CHARS = 400;
// Order numbers, point balances, phone tails — any run of 4+ digits (optionally
// #-prefixed) is a personalization marker and must never be cached.
const PERSONALIZATION_RE = /\b#?\d{4,}\b/;

export type AnswerCacheEntry = {
  key: string; // normalize(question)
  say: string;
  hits: number;
  createdAt: string;
  catalogVersion: string;
};

export type AnswerCacheStats = {
  lookups: number;
  hits: number;
  entries: number;
  hitRate: number; // 0..1
  topQuestions: Array<{ key: string; hits: number }>;
};

export interface AnswerCacheStore {
  get(key: string): Promise<AnswerCacheEntry | null>;
  put(entry: AnswerCacheEntry): Promise<void>;
  bumpHits(key: string): Promise<void>;
  count(): Promise<number>;
  top(limit: number): Promise<Array<{ key: string; hits: number }>>;
}

// Process-local telemetry. These are ops counters for the /backend panel, not
// durable state, so keeping them in memory (even alongside the Supabase store)
// is fine — the demo boots fresh anyway.
let totalLookups = 0;
let totalHits = 0;

class InMemoryAnswerCache implements AnswerCacheStore {
  private map = new Map<string, AnswerCacheEntry>();

  async get(key: string) {
    return this.map.get(key) ?? null;
  }

  async put(entry: AnswerCacheEntry) {
    this.map.set(entry.key, entry);
    // Cap the store — evict the oldest entries by createdAt.
    if (this.map.size > MAX_ENTRIES) {
      const oldest = [...this.map.values()]
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
        .slice(0, this.map.size - MAX_ENTRIES);
      for (const e of oldest) this.map.delete(e.key);
    }
  }

  async bumpHits(key: string) {
    const entry = this.map.get(key);
    if (entry) entry.hits += 1;
  }

  async count() {
    return this.map.size;
  }

  async top(limit: number) {
    return [...this.map.values()]
      .sort((a, b) => b.hits - a.hits || a.key.localeCompare(b.key))
      .slice(0, limit)
      .map((e) => ({ key: e.key, hits: e.hits }));
  }

  reset() {
    this.map.clear();
  }
}

class SupabaseAnswerCache implements AnswerCacheStore {
  private client = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    { auth: { persistSession: false } },
  );

  async get(key: string) {
    const { data, error } = await this.client
      .from("kfc_answer_cache")
      .select("key, say, hits, created_at, catalog_version")
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      key: data.key as string,
      say: data.say as string,
      hits: Number(data.hits ?? 0),
      createdAt: data.created_at as string,
      catalogVersion: data.catalog_version as string,
    };
  }

  async put(entry: AnswerCacheEntry) {
    const { error } = await this.client.from("kfc_answer_cache").upsert({
      key: entry.key,
      say: entry.say,
      hits: entry.hits,
      created_at: entry.createdAt,
      catalog_version: entry.catalogVersion,
    });
    if (error) throw error;
    // Best-effort cap: prune anything beyond the newest MAX_ENTRIES.
    const { data } = await this.client
      .from("kfc_answer_cache")
      .select("key")
      .order("created_at", { ascending: false })
      .range(MAX_ENTRIES, MAX_ENTRIES + 200);
    const stale = (data ?? []).map((row) => row.key as string);
    if (stale.length) await this.client.from("kfc_answer_cache").delete().in("key", stale);
  }

  async bumpHits(key: string) {
    // Read-modify-write; a lost increment under contention only under-counts a
    // display metric, never affects correctness of a hit.
    const current = await this.get(key);
    if (!current) return;
    const { error } = await this.client
      .from("kfc_answer_cache")
      .update({ hits: current.hits + 1 })
      .eq("key", key);
    if (error) throw error;
  }

  async count() {
    const { count, error } = await this.client
      .from("kfc_answer_cache")
      .select("key", { count: "exact", head: true });
    if (error) throw error;
    return count ?? 0;
  }

  async top(limit: number) {
    const { data, error } = await this.client
      .from("kfc_answer_cache")
      .select("key, hits")
      .order("hits", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((row) => ({ key: row.key as string, hits: Number(row.hits ?? 0) }));
  }
}

const inMemoryStore = new InMemoryAnswerCache();

function hasSupabaseEnv() {
  return Boolean(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function getAnswerCacheStore(): AnswerCacheStore {
  return hasSupabaseEnv() ? new SupabaseAnswerCache() : inMemoryStore;
}

function isFresh(entry: AnswerCacheEntry, now: number): boolean {
  return entry.catalogVersion === CATALOG_VERSION && now - Date.parse(entry.createdAt) < TTL_MS;
}

/**
 * Look up a learned answer. Returns the `say` only when the message passes the
 * shared GUARD/question-shape gate AND a fresh, catalog-current entry exists.
 * On a hit, the entry's hit counter is bumped. Any failure is a silent miss.
 */
export async function lookupAnswer(message: string, now = Date.now()): Promise<string | null> {
  if (!isEvergreenQuestion(message)) return null;
  totalLookups += 1;
  const key = normalize(message);
  if (!key) return null;
  try {
    const entry = await getAnswerCacheStore().get(key);
    if (!entry || !isFresh(entry, now)) return null;
    totalHits += 1;
    void getAnswerCacheStore().bumpHits(key);
    return entry.say;
  } catch {
    return null; // a store hiccup must never break the turn — just miss.
  }
}

/**
 * Store a completed agent turn ONLY when the never-wrong write policy passes:
 * the question is evergreen/guarded, the turn used ZERO tools, the reply carries
 * no personalization marker, and it is under the length cap. Fire-and-forget.
 */
export async function storeAnswer(
  message: string,
  say: string,
  opts: { toolCallCount: number; customerId?: string },
  now = Date.now(),
): Promise<void> {
  const reply = (say ?? "").trim();
  if (!reply) return;
  if (opts.toolCallCount > 0) return; // depended on live data ⇒ never cache
  if (!isEvergreenQuestion(message)) return;
  if (reply.length >= MAX_REPLY_CHARS) return;
  if (PERSONALIZATION_RE.test(reply)) return;
  if (opts.customerId && reply.toLowerCase().includes(opts.customerId.toLowerCase())) return;

  const key = normalize(message);
  if (!key) return;
  try {
    const existing = await getAnswerCacheStore().get(key);
    await getAnswerCacheStore().put({
      key,
      say: reply,
      hits: existing?.hits ?? 0,
      createdAt: new Date(now).toISOString(),
      catalogVersion: CATALOG_VERSION,
    });
  } catch {
    // best-effort — a failed write just means the next asker pays for the LLM.
  }
}

export async function getAnswerCacheStats(): Promise<AnswerCacheStats> {
  const store = getAnswerCacheStore();
  const [entries, topQuestions] = await Promise.all([store.count(), store.top(5)]);
  return {
    lookups: totalLookups,
    hits: totalHits,
    entries,
    hitRate: totalLookups ? totalHits / totalLookups : 0,
    topQuestions,
  };
}

/** Test helper — clears the in-memory store and the process counters. */
export function resetAnswerCache() {
  inMemoryStore.reset();
  totalLookups = 0;
  totalHits = 0;
}
