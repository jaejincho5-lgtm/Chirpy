import assert from "node:assert/strict";
import { MockOtpProvider, __decideRequest, __otpLimits } from "../lib/otp";

process.env.OTP_EXPOSE_DEV_CODE = "1";

// --- Rate-limit decision (pure, injected timestamps — no clock mocking) ------

const { RESEND_COOLDOWN_MS, MAX_REQUESTS_PER_WINDOW, REQUEST_WINDOW_MS } = __otpLimits;
const base = 1_000_000_000_000;

function rec(overrides: Partial<{ requestCount: number; windowStartedAt: number; lastRequestedAt: number }>) {
  return {
    code: "123456",
    phone: "0901234567",
    expiresAt: base + 300_000,
    attempts: 0,
    verified: false,
    requestCount: 1,
    windowStartedAt: base,
    lastRequestedAt: base,
    ...overrides,
  };
}

// No prior record → always allowed, counter starts at 1.
const first = __decideRequest(null, base);
assert.ok("allow" in first && first.allow.requestCount === 1, "first request allowed");

// Within the cooldown window → blocked as cooldown.
const soon = __decideRequest(rec({ lastRequestedAt: base }), base + 10_000);
assert.ok("block" in soon && soon.block.ok === false && soon.block.code === "cooldown", "resend within 60s is cooldown");

// After cooldown but under the window cap → allowed, counter increments.
const second = __decideRequest(rec({ requestCount: 1, lastRequestedAt: base }), base + RESEND_COOLDOWN_MS + 1);
assert.ok("allow" in second && second.allow.requestCount === 2, "second request past cooldown increments count");

// At the window cap, past cooldown → rate_limited.
const capped = __decideRequest(
  rec({ requestCount: MAX_REQUESTS_PER_WINDOW, windowStartedAt: base, lastRequestedAt: base }),
  base + RESEND_COOLDOWN_MS + 1,
);
assert.ok("block" in capped && capped.block.ok === false && capped.block.code === "rate_limited", "4th in window is rate_limited");

// After the window elapses → counter resets to 1, allowed.
const newWindow = __decideRequest(
  rec({ requestCount: MAX_REQUESTS_PER_WINDOW, windowStartedAt: base, lastRequestedAt: base }),
  base + REQUEST_WINDOW_MS + 1,
);
assert.ok("allow" in newWindow && newWindow.allow.requestCount === 1, "new window resets the counter");

// --- End-to-end through the provider -----------------------------------------

const provider = new MockOtpProvider();
const r1 = await provider.request("limit-session", "0901234567");
assert.ok(r1.ok, "first live request succeeds");
const r2 = await provider.request("limit-session", "0901234567");
assert.ok(!r2.ok && r2.code === "cooldown", "immediate resend on same session is cooldown");

console.log("OTP rate-limit tests passed");
