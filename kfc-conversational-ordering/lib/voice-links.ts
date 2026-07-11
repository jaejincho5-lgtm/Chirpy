// Magic-link store for the Chirpy chat→voice handoff. A Messenger user types
// ".chirpy", we mint a single-use, short-TTL token bound to their customer id +
// conversation, and hand back a /voice link. Opening it redeems the token ONCE,
// so /voice knows who they are (shared cart, taste memory, loyalty) with zero
// re-entry. Same env-gated Supabase/in-memory split as the other stores.
//
// Supabase table (apply where the project keeps schema, e.g. db/):
//   create table kfc_voice_links (
//     token text primary key,
//     customer_id text not null,
//     conversation_key text not null,
//     expires_at timestamptz not null,
//     used_at timestamptz
//   );
// The in-memory fallback fully works for the local demo.

import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const TTL_MS = 10 * 60 * 1000; // link valid 10 minutes
const ECHO_TTL_MS = 30 * 60 * 1000; // signed channelEcho valid 30 minutes post-redeem
// Messenger's URL scanner opens links (JS included) within ~1s of the bot
// sending them, redeeming the token before the human can click (observed live
// 2026-07-11: every used_at landed <1s after mint). Strict single-use would
// brick every link, so a token stays redeemable for a short grace window after
// first use. The window is small and the token is still unguessable + bound to
// one customer, so replay risk stays negligible.
const REUSE_GRACE_MS = 2 * 60 * 1000;

export type VoiceLink = {
  token: string;
  customerId: string;
  conversationKey: string;
  expiresAt: string;
  usedAt: string | null;
};

export type MintResult = { token: string; expiresAt: string };
export type RedeemResult =
  | { ok: true; customerId: string; conversationKey: string }
  | { ok: false; reason: "not_found" | "expired" | "used" };

interface VoiceLinkStore {
  put(link: VoiceLink): Promise<void>;
  get(token: string): Promise<VoiceLink | null>;
  markUsed(token: string, usedAt: string): Promise<void>;
}

class InMemoryVoiceLinkStore implements VoiceLinkStore {
  private map = new Map<string, VoiceLink>();
  async put(link: VoiceLink) {
    this.map.set(link.token, link);
  }
  async get(token: string) {
    return this.map.get(token) ?? null;
  }
  async markUsed(token: string, usedAt: string) {
    const link = this.map.get(token);
    if (link) link.usedAt = usedAt;
  }
  reset() {
    this.map.clear();
  }
}

class SupabaseVoiceLinkStore implements VoiceLinkStore {
  private client = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    { auth: { persistSession: false } },
  );
  async put(link: VoiceLink) {
    const { error } = await this.client.from("kfc_voice_links").insert({
      token: link.token,
      customer_id: link.customerId,
      conversation_key: link.conversationKey,
      expires_at: link.expiresAt,
      used_at: link.usedAt,
    });
    if (error) throw error;
  }
  async get(token: string) {
    const { data, error } = await this.client
      .from("kfc_voice_links")
      .select("token, customer_id, conversation_key, expires_at, used_at")
      .eq("token", token)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      token: data.token as string,
      customerId: data.customer_id as string,
      conversationKey: data.conversation_key as string,
      expiresAt: data.expires_at as string,
      usedAt: (data.used_at as string | null) ?? null,
    };
  }
  async markUsed(token: string, usedAt: string) {
    const { error } = await this.client.from("kfc_voice_links").update({ used_at: usedAt }).eq("token", token);
    if (error) throw error;
  }
}

const inMemoryStore = new InMemoryVoiceLinkStore();

function hasSupabaseEnv() {
  return Boolean(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

function getStore(): VoiceLinkStore {
  return hasSupabaseEnv() ? new SupabaseVoiceLinkStore() : inMemoryStore;
}

/** Mint a single-use link token (32 hex chars) bound to a customer + conversation. */
export async function mintVoiceLink(
  customerId: string,
  conversationKey: string,
  now = Date.now(),
): Promise<MintResult> {
  const token = randomBytes(16).toString("hex"); // 32 hex chars — unguessable
  const expiresAt = new Date(now + TTL_MS).toISOString();
  await getStore().put({ token, customerId, conversationKey, expiresAt, usedAt: null });
  return { token, expiresAt };
}

/**
 * Redeem a token: valid if it exists, is unexpired, and is either unused or
 * first-used within REUSE_GRACE_MS (Messenger's link scanner burns the first
 * redemption ~1s after mint; the human click must still succeed).
 */
export async function redeemVoiceLink(token: string, now = Date.now()): Promise<RedeemResult> {
  const link = await getStore().get(token);
  if (!link) return { ok: false, reason: "not_found" };
  if (link.usedAt && now - Date.parse(link.usedAt) > REUSE_GRACE_MS) return { ok: false, reason: "used" };
  if (now > Date.parse(link.expiresAt)) return { ok: false, reason: "expired" };
  // used_at records the FIRST redemption; grace re-redeems don't extend it.
  if (!link.usedAt) await getStore().markUsed(token, new Date(now).toISOString());
  return { ok: true, customerId: link.customerId, conversationKey: link.conversationKey };
}

export function resetInMemoryVoiceLinks() {
  inMemoryStore.reset();
}

// --- signed channelEcho ------------------------------------------------------
// The token is single-use, so once /voice redeems it we can't re-verify it on
// every agent request. Instead /api/voice-link returns a short-lived HMAC-signed
// value carrying the conversationKey; the agent route verifies the signature
// server-side before it will echo a receipt anywhere. A client cannot forge this,
// so it cannot spam arbitrary Messenger threads.

function echoSecret(): string {
  return process.env.VOICE_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "kfc-voice-dev-secret";
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function signChannelEcho(conversationKey: string, now = Date.now()): string {
  const payload = b64url(Buffer.from(JSON.stringify({ k: conversationKey, exp: now + ECHO_TTL_MS })));
  const sig = b64url(createHmac("sha256", echoSecret()).update(payload).digest());
  return `${payload}.${sig}`;
}

/** Verify a signed channelEcho and return the conversationKey, or null if invalid/expired. */
export function verifyChannelEcho(signed: string | undefined, now = Date.now()): string | null {
  if (!signed) return null;
  const [payload, sig] = signed.split(".");
  if (!payload || !sig) return null;
  const expected = b64url(createHmac("sha256", echoSecret()).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    if (typeof decoded.k !== "string" || typeof decoded.exp !== "number") return null;
    if (now > decoded.exp) return null;
    return decoded.k;
  } catch {
    return null;
  }
}
