import assert from "node:assert/strict";
import {
  mintVoiceLink,
  redeemVoiceLink,
  signChannelEcho,
  verifyChannelEcho,
  resetInMemoryVoiceLinks,
} from "../lib/voice-links";

resetInMemoryVoiceLinks();

// --- mint → redeem happy path (single use) -----------------------------------

const minted = await mintVoiceLink("msgr_demo_linh", "messenger:demo_linh");
assert.ok(/^[0-9a-f]{24,}$/.test(minted.token), "token is 24+ hex chars, unguessable");

const first = await redeemVoiceLink(minted.token);
assert.equal(first.ok, true, "first redemption succeeds");
if (first.ok) {
  assert.equal(first.customerId, "msgr_demo_linh");
  assert.equal(first.conversationKey, "messenger:demo_linh");
}

// Messenger's URL scanner burns the first redemption ~1s after mint, so a
// token stays redeemable for a 2-minute grace window (the human's click),
// then hard-locks.
const graceRedeem = await redeemVoiceLink(minted.token);
assert.equal(graceRedeem.ok, true, "re-redemption inside the grace window succeeds (link-scanner survival)");

const mintedAt = Date.parse("2026-07-11T00:00:00Z");
const scanned = await mintVoiceLink("msgr_scan", "messenger:scan", mintedAt);
const scanner = await redeemVoiceLink(scanned.token, mintedAt + 700); // scanner hits at +0.7s
assert.equal(scanner.ok, true);
const human = await redeemVoiceLink(scanned.token, mintedAt + 30_000); // human clicks at +30s
assert.equal(human.ok, true, "human click 30s after the scanner still adopts the identity");
const late = await redeemVoiceLink(scanned.token, mintedAt + 700 + 2 * 60 * 1000 + 1);
assert.equal(late.ok, false, "past the grace window the token is locked");
if (!late.ok) assert.equal(late.reason, "used");

// --- unknown + expired tokens ------------------------------------------------

const unknown = await redeemVoiceLink("deadbeefdeadbeefdeadbeef");
assert.equal(unknown.ok, false);
if (!unknown.ok) assert.equal(unknown.reason, "not_found");

const t0 = Date.parse("2026-07-11T00:00:00Z");
const expiring = await mintVoiceLink("msgr_x", "messenger:x", t0);
const expired = await redeemVoiceLink(expiring.token, t0 + 11 * 60 * 1000); // 11 min > 10 min TTL
assert.equal(expired.ok, false, "past the 10-minute TTL ⇒ expired");
if (!expired.ok) assert.equal(expired.reason, "expired");

// --- signed channelEcho: verify + tamper + expiry ----------------------------

const echo = signChannelEcho("messenger:demo_linh");
assert.equal(verifyChannelEcho(echo), "messenger:demo_linh", "a valid signature yields the conversation key");
assert.equal(verifyChannelEcho(undefined), null, "missing echo ⇒ null");
assert.equal(verifyChannelEcho(`${echo}x`), null, "a tampered signature is rejected");
assert.equal(verifyChannelEcho("not.avalidtoken"), null, "garbage is rejected");

const e0 = Date.parse("2026-07-11T00:00:00Z");
const shortEcho = signChannelEcho("messenger:demo_linh", e0);
assert.equal(verifyChannelEcho(shortEcho, e0 + 60_000), "messenger:demo_linh", "fresh echo verifies");
assert.equal(verifyChannelEcho(shortEcho, e0 + 31 * 60 * 1000), null, "echo older than 30 min ⇒ null");

resetInMemoryVoiceLinks();
console.log("chirpy voice-link tests passed");
