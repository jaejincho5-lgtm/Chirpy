# GRAND PLAN — from "lots of small features" to one WOW story

> **Build day execution:** the hour-by-hour playbook is [`../../docs/BUILD_DAY.md`](../../docs/BUILD_DAY.md)
> (AABW root `docs/`). Each feature below is an executable slash command in `AABW/.claude/commands/`
> — open Claude Code from the AABW root and type `/goal-<name>`.

**Date:** 2026-07-10 · **North star: order passthrough rate.** Every feature below is judged by one
question: *does it remove a step between craving and confirmed order?* Fewer steps → higher
completion → more upsell surface. That's the pitch line too: "we removed N taps between hungry and
fed."

The current build has real depth (state machine, loyalty ledger, nudge v2, reengage prediction) but
it reads as a *pile of features*. The plan reframes everything around **one customer journey** the
judges can feel: *a driver at a red light orders dinner in 15 seconds without touching the screen.*

---

## 1. FLAGSHIP — "Chirpy handoff": chat → voice magic link (the driving scenario)

**The scene:** user is driving, stops at a red light, types `.chirpy` (or just "chirpy") into the
Messenger chat. Bot instantly replies with a unique link. They tap it once → `/voice` opens **already
knowing who they are** — same cart, same taste memory, same loyalty points as the chat. They say
"cho mình phần như mọi khi" (*order my usual*) and never look at the screen again.

**Why this works with what we already have:**
- Conversations are already keyed per real user: `messenger:<psid>` in `lib/convo-store.ts`, with a
  stable customer id `msgr_<psid>` that all taste memory (`lib/profile.ts`), loyalty
  (`lib/loyalty.ts`), and history accrue to.
- `/voice` currently hardcodes `customerId = "voice_guest"` (`app/voice/page.tsx:26`) — that's the
  only wall between the two surfaces. Tear it down.

**Implementation sketch:**
1. **Trigger:** deterministic intercept in `lib/channel.ts` (same pattern as the existing "dừng"
   opt-out intercept — before the LLM, zero latency, zero cost). Match `.chirpy` / `chirpy` /
   "nói chuyện" / "voice".
2. **Mint a voice token:** short random token → row in a new `kfc_voice_links` store (Supabase +
   in-memory fallback, same pattern as every other store): `{ token, customerId: msgr_<psid>,
   conversationKey, expiresAt (10 min), usedAt }`. Single-use + short TTL = the security story
   ("magic link, not a password").
3. **Reply with the link:** `https://<domain>/voice?t=<token>` — Messenger renders it tappable.
   Copy: *"Bấm vào đây rồi nói chuyện với em nhé — em nhớ hết đơn của mình rồi 🐔"*.
4. **`/voice` redeems it:** on load, `GET /api/voice-link?t=` → returns `customerId` + a profile
   greeting seed. All subsequent `/api/agent` calls use the real customerId → "order the usual"
   works because `TasteProfile.usual` already exists and the agent already greets returning
   customers.
5. **Close the loop (the demo kicker):** when the voice order places, send the receipt **back into
   the Messenger thread** via the existing `sendChannelReply`. Judge sees: chat → voice → order
   confirmation lands back in chat. One identity, two modalities, zero re-entry.

**Demo beat:** phone mirrored, Messenger open → type `.chirpy` → tap link → phone mounts on the
dashboard (or just held up) → "Chirpy ơi, phần như mọi khi, giao về nhà" → OTP autofills the saved
flow → order number spoken aloud + receipt appears in Messenger. ~20 seconds, hands never typed an
item.

---

## 2. FLAGSHIP — Zero-re-entry profile: ask once, confirm forever

**Principle: the customer should never type the same fact twice.** First order collects phone +
address + name in-flow; every later order only *confirms* them.

- **Store:** extend the profile layer (or a sibling `kfc_customer_contacts` store) with
  `{ phone, addressLines[], defaultFulfillment, name }`, keyed by the same customerId. Written by
  `place_order` on first success.
- **Agent behavior:** new tool `get_saved_contact(customerId)`; system prompt rule: *if a saved
  address exists, never ask for it — state it and ask for a one-word confirm* ("Giao về 12 Nguyễn
  Huệ như lần trước nhé?" → "ừ" → done). Changing it is one sentence, and the new value persists.
- **Checkout collapse:** with saved contact + saved payment preference, checkout is literally:
  suggest → "chốt" → OTP → placed. Count the turns before/after and put that number on the slide
  (e.g. "checkout: 7 turns → 3 turns").
- **Trust switch (risk-based OTP):** returning customer + order under a threshold (e.g. 200k) +
  same delivery address as last time → skip OTP, just confirm verbally. Full OTP for new
  addresses/large tickets. This is a real production pattern (step-up auth) and it makes the repeat
  demo *dramatically* faster. Keep it env-gated so the secure path is still showable.

---

## 3. MORE PASSTHROUGH FEATURES (each = one less step, ranked by wow-per-hour)

### 3.1 "Như mọi khi" — the one-word reorder ⭐ do this
`TasteProfile.usual` already exists (modal item + habitual options at ≥40% share). Add a
deterministic fast path: message matches "như mọi khi / cái cũ / same as last time / usual" →
build the cart from `usual` (or literally replay the last order) **without waking the LLM**, reply
with the priced cart + "chốt luôn không?". Instant, free, and the single best driving-scenario
command. Also surface it as the greeting suggestion: "Phần như mọi khi — Zinger cay + Pepsi, 87k.
Chốt không?" — the order becomes ONE yes.

### 3.2 Auto-apply the best voucher ⭐ do this
Today the user must *know* the code — that's a step, and real users don't know codes. At quote
time, scan active vouchers in `kfc_vouchers`, apply the one that saves the most, and *tell them*:
"Em áp sẵn mã KFC20 cho mình — bớt 18k nha." Zero-effort savings is the single strongest
trust/passthrough builder, and it turns the voucher metric from "user remembered a code" into
"system did it for them." (Flag on the order so ops can see auto vs manual application.)

### 3.3 Smart attach at the confirm moment (the honest upsell)
`attachRates` per customer already exist, plus the POS-mined affinity rules (`lib/reco`). Rule:
**exactly one** attach suggestion, only at the "chốt" moment, only if (a) personal attach rate is
high or (b) affinity lift is strong, and never anything in `declinedRecently` (already tracked!).
One suggestion, one decline memory = upsell that doesn't feel like nagging. Show the accept-rate
counter in `/backend` — that's the AOV slide.

### 3.4 Order-ahead timing: "tới nơi là có"
Driver scenario, part 2: "mình tới trong 15 phút" → order goes to OMS with a `readyAt` target so
prep starts timed, and the status push (already built) fires "gà của mình đang chiên, 5 phút nữa
xong" as they approach. `kfc_orders` + the OMS lifecycle already exist — this is a `readyAt` column
+ copy. Small build, big story: *the food waits for you, not the other way around.*

### 3.5 Group order link ("đặt chung")
"Đặt chung cho văn phòng đi" → bot mints a share link; colleagues open a stripped web page (or
just message the same bot with the code), each adds their item to the SAME order; initiator says
"chốt" and pays once. This is huge in VN office lunch culture and directly multiplies ticket size.
Medium build (shared-cart session keyed by a join code — `convo-store` pattern reused), but it's a
distinct wow beat no other team will have. Stretch goal.

### 3.6 Named saved orders ("cơm trưa văn phòng")
"Lưu đơn này là 'cơm trưa văn phòng'" → later, "đặt cơm trưa văn phòng" replays it. A named-preset
map on the profile; the deterministic reorder path from 3.1 handles the replay. Cheap once 3.1
exists.

### 3.7 Already built — reframe as passthrough, don't rebuild
Nudge v2 send-time prediction, ghost-followup, proactive status pushes, OOS recovery, Combo Math:
these ARE passthrough features (they recover orders that would have died). In the deck, present
every one as "+X recovered orders", not as separate features. One metric, one story.

---

## 4. /VOICE OVERHAUL (the demo centerpiece — polish list)

### 4.1 Look ✨ fix first
- The stage must read *premium kiosk*, not *debug page*: real depth behind the chicken (gradient
  floor + soft shadow), KFC red/white palette locked, one display typeface moment ("Đại sứ Gà").
- Subtitle bubble: bigger type (driver reads at arm's length — min ~20px), high contrast, smooth
  enter/exit; never overlaps the receipt.
- Receipt panel: slide-in animation, monospace prices, running total that *ticks* when items land.
- State choreography: `listen / think / speak / idle` should each be unmistakable at a glance
  (ring pulse while listening, subtle breathing while idle, glow while speaking). The classes
  already exist (`voice-stage--*`) — the CSS needs the taste pass.
- Kill jank: preload the VRM + first TTS voice on mount so the first interaction has zero hitch.

### 4.2 Real TTS (fast + nice)
`lib/speech.ts` was built for exactly this — `Speaker` is an interface; drop in a provider:
- **Recommendation: ElevenLabs Flash v2.5** — ~75ms model latency, streams, supports Vietnamese.
  Server route `/api/tts` (keeps the key server-side) → stream audio to the client → play through
  **WebAudio with an `AnalyserNode`** so `onLevel` becomes *real* amplitude → actual lip-sync
  instead of the current word-boundary pulse hack. This alone transforms the avatar.
- Fallback chain: ElevenLabs → browser `speechSynthesis` (current) so the demo never dies on a
  quota/network blip.
- **TTS audio cache:** hash(speakableText) → audio blob (memory + Supabase storage). Greetings,
  clarifiers, confirmations repeat constantly — cached phrases play in ~0ms and cost nothing.
  Pre-warm the greeting + top 20 canned lines at build/deploy time.

### 4.3 Latency: cache every layer
- **Instant path (exists):** `faq-cache` already serves evergreen answers in ~1ms with the
  never-wrong guard. Extend the curated set with the questions heard in testing.
- **NEW — learned global answer cache (user A asks → user B gets it instantly):**
  `kfc_answer_cache`: key = `normalize(question)` (the diacritic-stripping normalizer already
  exists in faq-cache), value = the agent's `say` + TTS audio ref + hit count.
  **Write policy is where correctness lives — reuse the faq-cache philosophy:**
  - only cache turns that were *pure Q&A*: zero tool calls that mutate (no cart/voucher/loyalty/OTP/
    order tools ran) and the reply contains no personalized tokens (name, points, order number) and
    no live data (price quotes come from tools — cache the question routing, not stale prices… or
    version the cache on `CATALOG_VERSION` so price answers invalidate on menu change);
  - the same negative GUARD_PHRASES gate reads: an ordering signal always falls through to the agent;
  - TTL 24h + serve count cap, and every hit logged to `/backend` (Agent module) — "answer cache
    hit rate: 34%" is a great ops slide number.
- **Prompt caching:** verify the Anthropic cache breakpoint sits *after* the static system+tools
  block and *before* volatile context (weather/profile) — the README notes cache writes were a real
  cost issue on eval runs, same physics applies to demo latency. Static-first ordering = warm cache
  = faster first token.
- **Perceived latency:** the avatar should *acknowledge instantly* even when the answer is slow —
  a cached "Dạ để em xem…" filler (spoken from the TTS cache, 0ms) while the real completion
  streams. Voice UIs are judged on time-to-first-sound, not time-to-answer.

### 4.4 Hands-free (the driver can't hold a button)
Flip the interaction model: **always listening, button = mute** (not push-to-talk).
- **VAD:** `@ricky0123/vad-web` (Silero VAD compiled to WASM, runs client-side, well-proven) to
  detect speech start/stop → feed segments to Web Speech recognition (or just use recognition
  `continuous: true` with the VAD deciding end-of-utterance). Auto-submit on end-of-speech.
- **Barge-in:** user starts talking while the chicken is talking → `getSpeaker().cancel()`
  immediately and listen. This is the detail that makes it feel alive.
- **Echo guard (the gotcha):** the avatar's own voice will trigger the mic. Options, simplest
  first: (a) pause recognition while `speaking === true` and accept no barge-in (safe demo mode),
  (b) `echoCancellation: true` on getUserMedia + VAD threshold tuning for real barge-in. Ship (a),
  attempt (b).
- Big mic-state indicator (green ring = listening, red slash = muted) — glanceable while driving.
- Wake-word ("Chirpy ơi") is a stretch goal; auto-listen already covers the scenario.

---

## 5. UI/UX CLEANUP

### 5.1 /backend (the messy one)
The module shell (`app/backend/page.tsx`) is sound — the mess is *inside* the modules. Standards
pass, one module at a time:
- **One layout grammar:** every module = header row (title + primary action) → KPI strip →
  content cards. Same paddings, same card radius/border, same type scale everywhere. Extract the
  common pieces into `modules/shared.tsx` (it exists — push more into it).
- **Replace emoji tab icons** with a consistent line-icon set (emoji renders differently
  per-OS and reads as prototype). Add an active-tab underline animation.
- **Data display rules:** numbers right-aligned + tabular-nums, VND always formatted the same,
  timestamps humanized ("3 phút trước"), status = colored dot + word (not raw enum strings).
- **Empty/loading states everywhere** — a judge clicking a module with no data should see a
  designed empty state, not a blank div.
- **Density:** operator consoles want compact rows; cut dead vertical space, cap content width.
- Run the `impeccable`/design-taste pass per module after the grammar is in place.

### 5.2 Global
- Audit `globals.css` for one source of truth: spacing scale, radius scale, the oklch palette
  already chosen — remove ad-hoc values.
- Mobile check on `/user` and `/voice` (the demo runs on a phone — test at 390×844, not desktop).
- Fix "UI been bugging": collect concrete repro list (which page, what breaks) — file per-bug notes
  in `docs/UI_BUGS.md` as they're spotted; unreproduced "it's janky" reports don't get fixed.

---

## 6. BUILD ORDER (wow-per-hour, hackathon time budget)

| # | Item | Effort | Why first |
|---|---|---|---|
| 1 | /voice visual polish + always-listening VAD + barge-in (§4.1, §4.4) | 1 day | The centerpiece; everything else is invisible if this looks broken |
| 2 | ElevenLabs TTS via `/api/tts` + AnalyserNode lip-sync + audio cache (§4.2) | 0.5–1 day | Biggest single perceived-quality jump |
| 3 | Chirpy handoff: token mint + `/voice?t=` redemption + receipt-back-to-chat (§1) | 0.5 day | THE demo narrative; mostly plumbing on existing stores |
| 4 | "Như mọi khi" deterministic reorder + greeting suggestion (§3.1) | 0.5 day | Makes beat 3 land ("order the usual" must be instant) |
| 5 | Saved contact + confirm-only checkout (+ risk-based OTP skip) (§2) | 0.5 day | Turns of checkout drop visibly on stage |
| 6 | Auto-best-voucher (§3.2) | 2–3 h | Cheap, delightful, hits a judged metric |
| 7 | Learned answer cache + hit-rate panel (§4.3) | 0.5 day | Speed + an ops number for the deck |
| 8 | /backend standards pass (§5.1) | 0.5–1 day | Judges WILL click around the console |
| 9 | Order-ahead `readyAt` (§3.4) · named presets (§3.6) | 2–3 h each | If time remains |
| 10 | Group ordering (§3.5) | 1 day | Stretch — only if everything above is done and rehearsed |

**The one demo (3 min):** Messenger chat as a known customer → `.chirpy` → voice link → hands-free
"như mọi khi, giao về nhà" → saved address confirmed in one word → auto-voucher announced → one
smart attach accepted → (OTP skipped: trusted repeat) → order placed, spoken + receipt lands back
in Messenger → cut to `/backend`: the order in the OMS queue, the answer-cache hit rate, the
reengage prediction for this customer. *Craving to confirmed: under 30 seconds, zero typing.*
