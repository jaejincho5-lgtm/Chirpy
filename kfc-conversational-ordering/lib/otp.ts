// Server-side OTP provider. The code is generated randomly on the server,
// stored server-side keyed by a conversation session, and NEVER returned in the
// tool payload or UI by default. Verification state is tracked server-side too,
// so a client cannot forge `otp.verified: true` — it must actually present the
// server-generated code within the TTL and attempt cap.
//
// Delivery: a real SMS gateway (Twilio, lib/sms.ts) sends the code when
// configured. Without it, OTP_EXPOSE_DEV_CODE=1 surfaces the code for the demo
// (the chat becomes the delivery channel). Real SMS always suppresses the dev
// code, even if the flag is on.
//
// Requests are rate-limited per session: a 60s resend cooldown and at most 3
// mints per 10-minute window, so a caller cannot drain SMS or brute the mint
// path. Verification attempts remain capped separately.
//
// Two implementations behind one async interface:
//   - SupabaseOtpProvider (default when Supabase env is set): codes + counters
//     survive serverless instance churn.
//   - MockOtpProvider: in-memory fallback for keyless local runs and evals.

import { randomInt } from "node:crypto";
import { supabaseAdmin } from "./supabase";
import { sendSms, twilioConfigured } from "./sms";

export type OtpRequestResult =
  | {
      ok: true;
      maskedPhone: string;
      requestedAt: string;
      expiresAt: string;
      /** True when a real SMS was sent (Twilio configured and accepted). */
      smsSent: boolean;
      /** Only populated when OTP_EXPOSE_DEV_CODE=1 AND no real SMS was sent. */
      devCode?: string;
    }
  | {
      ok: false;
      code: "cooldown" | "rate_limited";
      retryInSeconds: number;
      message: string;
    };

export type OtpVerifyResult =
  | { ok: true; message: string }
  | { ok: false; code: "not_requested" | "expired" | "too_many_attempts" | "mismatch"; message: string };

export interface OtpProvider {
  request(sessionKey: string, phone: string): Promise<OtpRequestResult>;
  verify(sessionKey: string, code: string): Promise<OtpVerifyResult>;
  isVerified(sessionKey: string): Promise<boolean>;
  clear(sessionKey: string): Promise<void>;
}

const TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 3;
const REQUEST_WINDOW_MS = 10 * 60 * 1000;

type OtpRecord = {
  code: string;
  phone: string;
  expiresAt: number;
  attempts: number;
  verified: boolean;
  requestCount: number;
  windowStartedAt: number;
  lastRequestedAt: number;
};

function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `${digits.slice(0, 3)}***${digits.slice(-3)}`;
}

function exposeDevCode() {
  return process.env.OTP_EXPOSE_DEV_CODE === "1";
}

function newCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

// Shared rate-limit decision over the previous record (if any). Returns either a
// failure result to return verbatim, or the request counters for the new mint.
function decideRequest(
  prev: OtpRecord | null,
  now: number,
): { block: OtpRequestResult } | { allow: { requestCount: number; windowStartedAt: number } } {
  if (prev) {
    const sinceLast = now - prev.lastRequestedAt;
    if (sinceLast < RESEND_COOLDOWN_MS) {
      return {
        block: {
          ok: false,
          code: "cooldown",
          retryInSeconds: Math.ceil((RESEND_COOLDOWN_MS - sinceLast) / 1000),
          message: "Please wait before requesting another code.",
        },
      };
    }
    const windowOpen = now - prev.windowStartedAt < REQUEST_WINDOW_MS;
    if (windowOpen && prev.requestCount >= MAX_REQUESTS_PER_WINDOW) {
      return {
        block: {
          ok: false,
          code: "rate_limited",
          retryInSeconds: Math.ceil((REQUEST_WINDOW_MS - (now - prev.windowStartedAt)) / 1000),
          message: "Too many code requests. Try again later.",
        },
      };
    }
    return {
      allow: {
        requestCount: windowOpen ? prev.requestCount + 1 : 1,
        windowStartedAt: windowOpen ? prev.windowStartedAt : now,
      },
    };
  }
  return { allow: { requestCount: 1, windowStartedAt: now } };
}

// Deliver the code (real SMS if configured) and build the success result.
// devCode is exposed only when the flag is on AND no real SMS went out.
async function deliver(phone: string, now: number, code: string): Promise<OtpRequestResult> {
  let smsSent = false;
  if (twilioConfigured()) {
    const res = await sendSms(phone, `Ma xac nhan KFC cua ban: ${code}. Het han sau 5 phut.`);
    smsSent = res.sent;
  }
  const result: OtpRequestResult = {
    ok: true,
    maskedPhone: maskPhone(phone),
    requestedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TTL_MS).toISOString(),
    smsSent,
  };
  if (!smsSent && exposeDevCode()) result.devCode = code;
  return result;
}

// Shared verification logic over a loaded record; the store strategies differ
// only in how they load/save/delete.
function judge(record: OtpRecord | null, code: string): { result: OtpVerifyResult; action: "delete" | "save" | "none" } {
  if (!record) {
    return { result: { ok: false, code: "not_requested", message: "Request an OTP before verification." }, action: "none" };
  }
  if (Date.now() > record.expiresAt) {
    return { result: { ok: false, code: "expired", message: "OTP expired. Request a new one." }, action: "delete" };
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    return {
      result: { ok: false, code: "too_many_attempts", message: "Too many attempts. Request a new OTP." },
      action: "delete",
    };
  }
  record.attempts += 1;
  if (code.trim() !== record.code) {
    return { result: { ok: false, code: "mismatch", message: "OTP did not match the confirmation code." }, action: "save" };
  }
  record.verified = true;
  return { result: { ok: true, message: "OTP verified." }, action: "save" };
}

/** In-memory provider — keyless local runs and the eval harness. */
export class MockOtpProvider implements OtpProvider {
  private store = new Map<string, OtpRecord>();

  async request(sessionKey: string, phone: string): Promise<OtpRequestResult> {
    const now = Date.now();
    const prev = this.store.get(sessionKey) ?? null;
    const decision = decideRequest(prev, now);
    if ("block" in decision) return decision.block;

    const code = newCode();
    this.store.set(sessionKey, {
      code,
      phone,
      expiresAt: now + TTL_MS,
      attempts: 0,
      verified: false,
      requestCount: decision.allow.requestCount,
      windowStartedAt: decision.allow.windowStartedAt,
      lastRequestedAt: now,
    });
    return deliver(phone, now, code);
  }

  async verify(sessionKey: string, code: string): Promise<OtpVerifyResult> {
    const record = this.store.get(sessionKey) ?? null;
    const { result, action } = judge(record, code);
    if (action === "delete") this.store.delete(sessionKey);
    // "save": the record is mutated in place — nothing further to do in-memory.
    return result;
  }

  async isVerified(sessionKey: string): Promise<boolean> {
    const record = this.store.get(sessionKey);
    if (!record) return false;
    if (Date.now() > record.expiresAt) {
      this.store.delete(sessionKey);
      return false;
    }
    return record.verified;
  }

  async clear(sessionKey: string): Promise<void> {
    this.store.delete(sessionKey);
  }
}

/** Durable provider — kfc_otp rows survive serverless instance churn (P2-11). */
class SupabaseOtpProvider implements OtpProvider {
  private client = supabaseAdmin();

  private async load(sessionKey: string): Promise<OtpRecord | null> {
    const { data } = await this.client
      .from("kfc_otp")
      .select("code, phone, expires_at, attempts, verified, request_count, window_started_at, last_requested_at")
      .eq("session_key", sessionKey)
      .maybeSingle();
    if (!data) return null;
    return {
      code: data.code,
      phone: data.phone,
      expiresAt: Date.parse(data.expires_at),
      attempts: data.attempts,
      verified: data.verified,
      requestCount: data.request_count ?? 1,
      windowStartedAt: data.window_started_at ? Date.parse(data.window_started_at) : Date.now(),
      lastRequestedAt: data.last_requested_at ? Date.parse(data.last_requested_at) : Date.now(),
    };
  }

  private async save(sessionKey: string, record: OtpRecord): Promise<void> {
    await this.client.from("kfc_otp").upsert({
      session_key: sessionKey,
      code: record.code,
      phone: record.phone,
      expires_at: new Date(record.expiresAt).toISOString(),
      attempts: record.attempts,
      verified: record.verified,
      request_count: record.requestCount,
      window_started_at: new Date(record.windowStartedAt).toISOString(),
      last_requested_at: new Date(record.lastRequestedAt).toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  async request(sessionKey: string, phone: string): Promise<OtpRequestResult> {
    const now = Date.now();
    const prev = await this.load(sessionKey);
    const decision = decideRequest(prev, now);
    if ("block" in decision) return decision.block;

    const code = newCode();
    await this.save(sessionKey, {
      code,
      phone,
      expiresAt: now + TTL_MS,
      attempts: 0,
      verified: false,
      requestCount: decision.allow.requestCount,
      windowStartedAt: decision.allow.windowStartedAt,
      lastRequestedAt: now,
    });
    return deliver(phone, now, code);
  }

  async verify(sessionKey: string, code: string): Promise<OtpVerifyResult> {
    const record = await this.load(sessionKey);
    const { result, action } = judge(record, code);
    if (action === "delete") await this.clear(sessionKey);
    if (action === "save" && record) await this.save(sessionKey, record);
    return result;
  }

  async isVerified(sessionKey: string): Promise<boolean> {
    const record = await this.load(sessionKey);
    if (!record) return false;
    if (Date.now() > record.expiresAt) {
      await this.clear(sessionKey);
      return false;
    }
    return record.verified;
  }

  async clear(sessionKey: string): Promise<void> {
    await this.client.from("kfc_otp").delete().eq("session_key", sessionKey);
  }
}

function hasSupabase() {
  return Boolean(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

// Durable when Supabase is configured; in-memory otherwise (keyless eval, CI).
export const otpProvider: OtpProvider = hasSupabase() ? new SupabaseOtpProvider() : new MockOtpProvider();

// Exposed for tests (rate-limit decision without clock mocking).
export const __otpLimits = { RESEND_COOLDOWN_MS, MAX_REQUESTS_PER_WINDOW, REQUEST_WINDOW_MS };
export { decideRequest as __decideRequest };
