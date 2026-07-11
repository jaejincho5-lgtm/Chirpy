# KFC P4 — Conversational Ordering via Chat

**Partner:** KFC Vietnam · **Track:** F&B · **Category:** Enterprise AI
**URL:** https://aitalent.genaifund.ai/tracks/fnb/conversational-ordering
**Biggest lever for us:** **Business/ROI fit + demo** — a complete order placed by *talking*, with voucher + loyalty +
secure checkout, is an exec-ready story on the channel (Zalo/Messenger) their customers already live in.

---

## 1. The brief (condensed)

KFC VN customers prefer Messenger/Zalo but ordering forces an app/website switch → drop-off. No conversational
ordering exists; handling is **100% staff-based**. Build an assistant that **places orders, applies vouchers, checks
loyalty points, and hands off to a human** when needed, natively in chat.

- **AI tech:** Generative AI · Voice AI · Conversational AI.
- **Success metrics:** order completion · voucher application · NLU accuracy · loyalty inquiry · order-by-channel.
- **Data/infra:** APIs available. Integrations: **Messenger · Mobile App · Zalo · OMS · Loyalty**.
- **Build direction:** conversational ordering assistant for Messenger/Zalo that orders, vouchers, loyalty, and hands off.

## 2. Our original notes

- Look into the **Zalo API**.
- Flow: **talk to LLM → LLM emits a JSON request to backend → backend handles it → OTP for security → success message.**

That flow is the right spine. Below is how we harden it into an agent and make it demo-win.

## 3. The winning insight

The naive build is "chatbot that fills a cart." Three moves separate us:

1. **The order is a state machine the agent drives — not free text.** The agent's job each turn is to advance a
   typed `Order` object (items, mods, combo, fulfillment, payment) and *never* hallucinate menu/price. Every item is
   validated against the menu catalog before it enters the cart. This is what makes execs trust it with real money.
2. **Voucher + loyalty as first-class tools, in-conversation.** Most teams demo "add nuggets." We demo "apply my
   voucher and use my points" *without leaving chat* — the exact differentiators the brief lists as metrics.
3. **Secure checkout done right (your OTP note) + graceful human handoff.** An OTP confirmation step and a clean
   "let me get a person" escalation read as *production-ready*, not a toy.

## 4. Agentic architecture

```
Zalo / Messenger webhook
   │  (text or voice note)
   ▼
Agent loop (AGENT_MODEL via AI Gateway — currently openai/gpt-4o, see lib/ai.ts) — orchestrates a typed Order state machine
   ├─ tool: search_menu(query)            → validated items/combos/prices (menu catalog)
   ├─ tool: add_to_cart(item, mods, qty)  → mutates Order, recomputes total
   ├─ tool: apply_voucher(code)           → validates + applies (OMS/promo API)
   ├─ tool: check_loyalty(customer_id)    → points balance + redeem options (Loyalty API)
   ├─ tool: quote_order()                 → fulfillment (pickup/delivery), fees, ETA
   ├─ tool: request_otp() / verify_otp()  → secure confirm before payment
   ├─ tool: place_order(Order)            → OMS create; returns order #
   └─ tool: handoff_to_human(reason)      → escalation with full context
   │
   ▼
Channel reply: rich cards (item, price, "confirm?") + natural language
```

- **Grounding:** the LLM proposes; **tools are the source of truth** for menu, price, voucher validity, points. The
  model can't invent a ₫ price — it must call `search_menu`. Guardrail: reject any cart line without a catalog match.
- **JSON contract (your note, formalized):** each turn the agent returns `{say, order_state, next_action}`; the
  backend executes `next_action` (e.g. `request_otp`) and returns the result to the next turn. Clean, testable boundary.
- **Multi-turn memory:** cart + customer context persist per conversation (Supabase), so "make it two, and add a Pepsi"
  works naturally.
- **Handoff:** on low NLU confidence, payment disputes, or explicit ask → `handoff_to_human` with a transcript summary.

## 5. Data grounding & eval

- **Menu catalog** seeded as the tool's DB (real KFC VN menu structure: items, combos, mods, prices).
- **Eval harness** (`npm run eval`) is split into two clearly-labeled suites so the numbers are defensible:
  - **Suite 1 — lib unit tests (deterministic, not the agent).** Drives the pure state-machine + guardrail
    functions over the 30 cases plus a hand-written intent regex. The regex figure is reported as
    *intent-regex accuracy (lib heuristic)* — **not** the agent's NLU. This suite is the fast, offline gate.
  - **Suite 2 — agent-level eval (real LLM tool-calling).** Runs the actual agent runtime (system prompt +
    real tools via `generateText`) over the same 30 cases and asserts the observed **tool-call sequence** and
    **final order state**. Gated on `AI_GATEWAY_API_KEY`; skips cleanly (exit 0) when absent. This is the honest
    measure of the agent — expect an imperfect, believable number with visible failures.
  - **Voucher application success** and **loyalty inquiry success** as explicit pass/fail counts (Suite 1).

## 6. The killer demo (3 minutes)

Run it **inside a real Zalo/Messenger chat on a phone mirrored to screen** — the channel *is* the wow.

1. Voice note in Vietnamese: "Cho mình 1 combo gà rán và 1 Pepsi." → agent builds cart with **rich cards + price**.
2. "Áp mã giảm giá KFC20 và dùng điểm của mình." → **voucher applies, points redeem**, total updates live.
3. "Xác nhận, giao tới nhà." → **OTP** sent → user enters → **order # returned**. Completed, never left chat.
4. Trigger a curveball ("this is wrong, I want a person") → clean **human handoff** with context.
5. Cut to the **metrics slide**, then the **integration slide** (our JSON contract → KFC OMS/Loyalty APIs).

**Fallbacks:** mock OMS/Loyalty behind the same tool interface so no live API can break the run; record every step.

## 7. 5-day plan (4–6 team)

- **D1** — menu catalog → DB; define the `Order` state machine + JSON contract; storyboard; set up one channel (Zalo *or* Messenger).
- **D2** — vertical slice: text → search_menu → add_to_cart → quote → place_order (mock OMS). One order completes.
- **D3** — voucher + loyalty tools + OTP flow; eval harness with the named metrics; Vietnamese NLU tuning.
- **D4** — rich cards, voice-note input, human handoff; polish the channel UX; record fallbacks.
- **D5** — second channel if time; deck (metric-mapped) + README + 5 dry-runs.

**Roles:** agent lead (loop+state machine) · backend (channel webhooks + OMS/Loyalty/voucher tools) · ML (NLU eval)
· frontend/designer (cards, deck, choreography) · glue (Zalo/Messenger setup + OTP).

## 8. Risks & mitigations

- **Zalo Official Account API approval is slow** → build behind an adapter; demo on Messenger (faster) or a web-chat
  mock with identical logic if neither approves in time. Don't let API bureaucracy own the critical path.
- **Real payment integration is out of scope for a hackathon** → stop at OTP-confirmed order creation in OMS
  (mock/sandbox); state clearly "payment handoff is the next integration step."
- **Vietnamese + code-switching NLU** → test Day 2 on real phrasing; keep an eval set; Claude handles VN well.
- **Hallucinated menu/price** → hard guardrail: no cart line without a catalog match; unit-test it.

## 9. Scorecard

| Judge lever | How we hit it |
|---|---|
| Live demo wow | A full order placed by voice, in a real chat app, never leaving the channel |
| Business/ROI fit | Hits every named metric; replaces 100%-staff handling; clear OMS/Loyalty integration path |
| Agentic depth | Tool-driven order state machine with validation, OTP, and context-aware handoff |
| Data grounding | Menu-grounded tools (no hallucinated prices) + eval on completion/NLU/voucher/loyalty |

**Verdict:** the cleanest exec-facing ROI story of the KFC pair. Lower "wow ceiling" than the VNG asset pipelines,
but the highest ratio of *impressiveness to risk*.

---

## Improvement Plan — status (post-audit fix · 2026-07-03)
Original audit ([`/report.md`](../report.md)) verdict: **Shaky** — the server trusted client state and the eval
measured a regex, not the agent. The items below have now been addressed.

1. ✅ **Server no longer trusts client order state.** `app/api/agent/route.ts` reconstructs the `Order` from
   client messages and then runs `revalidateOrder` (`lib/order.ts`): every cart line is rebuilt from the
   authoritative catalog (name + price + options via `getCatalogEntry`), and any forged/unknown line is dropped
   before it can reach `place_order`. The client's `otp.verified` is ignored entirely — OTP verification is
   tracked **server-side** (`lib/otp.ts`) and `placeOrder` trusts only that server flag.
2. ✅ **Eval now hits the real agent.** Suite 2 in `eval/run.ts` drives the actual agent runtime
   (`lib/agent.ts`) over the 30 cases and asserts tool-call sequences + final order state, gated on
   `AI_GATEWAY_API_KEY`. Suite 1 is the fast lib unit suite; its intent-regex number is labeled as a lib
   heuristic, not "NLU accuracy".
3. ✅ **Vouchers reprice on every mutation.** The voucher *rule* (not a frozen amount) is stored on the order
   (`lib/vouchers.ts`); `calculateTotals` recomputes the discount each time, and FREESHIP's delivery-fee waiver
   moved into `calculateTotals` so apply-order no longer matters.
4. ✅ **OTP hardened.** `lib/otp.ts` is a provider interface with a server-generated random 6-digit code, 5-min
   TTL, 5-attempt cap, server-side verification state, and the code never returned by default (a dev code is
   surfaced only behind `OTP_EXPOSE_DEV_CODE=1`).
5. ✅ **`searchMenu` wired to Supabase.** `searchMenuGrounded` reads `kfc_menu` when Supabase env is present and
   falls back to the in-memory catalog otherwise (the seed mirrors `MENU_CATALOG`, so validation stays valid).
6. ✅ **Webhook→agent forward implemented.** `lib/channel.ts` verifies the Messenger `X-Hub-Signature-256` and
   Zalo MAC (skipped only when the secret is unset), normalizes inbound text, and forwards it into the agent
   runtime; the routes now report the real `forwardedToAgent` result.
7. ✅ **Tool-error → handoff trigger.** The runtime auto-escalates to `handoff_to_human` after repeated failing
   tool results, independent of the model's choice.
8. ✅ **Smells cleaned.** Removed the double `computeDiscount` (discount is now computed once, in
   `calculateTotals`) and the unused `order` arg on `checkLoyalty`. (No `lib/sim-client.ts` was present in this
   project.) Voice input remains an explicit UI stub.

### Still stubbed / next steps
- Voice-note transcription is a UI placeholder (text is the demo path).
- ~~Real Zalo/Messenger send-reply APIs are not called~~ **Done 2026-07-04** — see
  [Channel mode](#update--2026-07-04-demo-stage-channel-conversations-eval-fix) below.
- OTP state and combo swap proposals are in-memory (warm-instance only); move to Supabase for
  multi-instance production.

---

## Project COLONEL Delivery Notes

### What's Real / What's Synthetic

**Real in this build**
- Server-side cart guardrails: every mutation goes through `addToCart`, `updateCartLine`, `revalidateOrder`, or combo proposal application built on those helpers.
- Menu-grounded tools with integer VND pricing, voucher repricing, loyalty redemption, OTP-gated order placement, and recoverable out-of-stock substitution.
- Recommendation rules mined from a deterministic synthetic POS log at module load, then blended with per-customer history recorded by successful `place_order`.
- Keyless evals for order state, profiles, suggestions, combo math, craving translation, OOS recovery, and held-out personalization lift.

**Synthetic or mocked**
- POS logs and personas are synthetic. They are used to prove learning behavior without claiming access to KFC private order data.
- The final OMS *fulfilment* handoff (`OMS_URL`) is still a stub — order placement fabricates the
  order number — but the lifecycle, loyalty ledger, and voucher rules are now durable in Supabase
  (see the 2026-07-07 update). OTP delivery is real when Twilio is configured, dev-code otherwise.
- Supabase persistence is env-gated; without Supabase env vars, every store uses an in-memory fallback.
  (A live project — `aabw-colonel`, ap-southeast-1 — is provisioned, schema applied, menu seeded.)
- Zalo/Messenger send-reply APIs are implemented (`sendChannelReply`) and fire when `MESSENGER_TOKEN` /
  `ZALO_OA_TOKEN` are set; payments remain out of scope (OTP-confirmed OMS order is the stopping point).

### Suite 3 Output

```text
SUITE 3 - personalization lift (held-out, engine never saw these customers)
  events: 965            (target: >= 800)
  precision@1 global:      50.1%
  precision@1 personalized:59.7%
  lift: +9.6pp
  by history size k: 0:50.8% 1:58.9% 2:61.4% 3:53.6% 4:67.3% 5+:61.6%   (personalized arm)
  AOV projection @ take-rate {12,20,28,34,40}%: 12%:+1.665 VND 20%:+2.774 VND 28%:+3.884 VND 34%:+4.716 VND 40%:+5.549 VND
```

### Delivery Checklist

- [x] WP-0 through WP-9 implemented and committed.
- [x] `npm install && npm run build && npm test && npm run eval` exits 0 keyless.
- [x] Suite 2 remains key-gated and skips cleanly without `AI_GATEWAY_API_KEY`.
- [x] README includes honest real-vs-synthetic scope and actual Suite 3 numbers.
- [x] Section 16 out-of-scope items were not implemented.

---

## Update — 2026-07-04: demo stage, channel conversations, eval fix

Post-delivery review + build pass (commits `38d5b9f`, `cb8095f`, `c9c5cc8`):

1. **Eval fix (measurement, not product):** Suite 2's voucher cases started on an empty cart while
   vouchers enforce minimum subtotals — unpassable by any agent. They now preload a qualifying cart,
   and failure messages distinguish tool-sequence misses from final-state failures. Verified on a
   live run: previously-failing voucher cases pass. `AGENT_MODEL` is now env-overridable
   (`lib/ai.ts`) so evals can run on a cheaper gateway tier; the code default has since moved to
   `openai/gpt-4o` (BYOK credit) — note Anthropic prompt-cache hints are inert on it.
2. **Demo stage redesign** (`app/`): three-panel stage — director rail (6-beat script + operator
   controls for persona/weather/hour/return-visit/OOS, moved *out* of the phone), a Zalo-authentic
   OA chat (official KFC mark, verified badge, typing indicator, menu cards, suggestion chip, Combo
   Math savings card), and a live engineering console rendering every real tool call plus an order
   receipt. Vietnamese-native fonts (Be Vietnam Pro, Bricolage Grotesque, Spline Sans Mono), oklch
   palette. Renderer fixes: fenced-JSON contracts never show raw in bubbles; auto-scroll; minimal
   bold rendering.
3. **Channel mode — real Messenger/Zalo path** (`lib/convo-store.ts`, `lib/channel.ts`,
   `kfc_conversations` table): webhooks previously got a fresh amnesiac runtime per message and
   never replied. Conversations now persist server-side per `channel:senderId` — capped history,
   live cart (re-validated against the catalog on load), and a stable customer id
   (`msgr_<senderId>`) so taste memory accrues per real user. Replies are stripped of contract
   JSON/markdown and delivered via the Messenger Graph API / Zalo OA API when `MESSENGER_TOKEN` /
   `ZALO_OA_TOKEN` are set (no token → reply returned in the webhook response for simulation).
   **Verified:** cart continuity across three independent webhook requests, state durable in
   Supabase.

## Update — 2026-07-06: first full Opus baseline, cost-estimator fix, prod deploy + webhook hardening

**The dated baseline (Opus, all cases, one run):**

| Metric | Number | Notes |
|---|---|---|
| Agent suite | **21/28 (75%)** | over the `suite:"agent"` cases — the honest denominator (see below) |
| Adversarial (E13) | **4/5 scored · 5/5 behavioral** | `adv-prompt-leak` refused correctly; the harness's `extractSay` mis-parsed the reply (fixed, unverified until next paid run) |
| Teencode NLU (E14) | **9/10** | |
| Latency (B6) | **p50 11.6s · p95 26.8s** | slowest: `teen-9` @ 37.4s |
| Personalization (Suite 3) | **+9.6pp** (50.1%→59.7%, 965 held-out events) | free/deterministic, reproduced same-day |
| Cost | **~$5 actual** vs ~$0.99 estimated | the estimate was wrong, twice — see below |

Remaining honest failures: `agent-oos-recovery` + `agent-craving-spicy` (real agent gaps, prompt work),
plus 3 assertion false-positives and 1 harness crash fixed below (re-scoring them awaits a paid
`EVAL_CASE=` retest, ~$0.10).

**What the run taught us (measurement bugs, all fixed same day):**

1. **The cost estimator under-reported ~5×.** It subtracted cache *reads* from fresh input (disjoint
   buckets — the subtraction zeroed real input) and never counted cache *writes* (billed 1.25× input;
   on a multi-minute run the 5-min cache TTL keeps expiring, so the big system+tools block is
   re-written repeatedly). Now: four separate buckets, straight sum, and the output line defers to the
   AI Gateway dashboard as authoritative.
2. **The run was 2× too expensive to begin with:** the agent suite was driving all 58 cases through
   Opus, including the 30 deterministic lib-pipeline cases Suite 1 already scores by regex — which
   also polluted the headline into a fake "43/58". The agent suite now runs `suite:"agent"` cases only.
3. **`extractSay` false positives:** the model often emits prose + a fenced ```json contract; naive
   `JSON.parse` failed and returned the raw text, so `forbid_reply_contains` matched the *contract's
   own field names* (`order_state`) — scoring a correct refusal as a prompt leak. The parser now
   extracts `say` from fenced/trailing/truncated wrappers (smoke-tested against the actual failing
   reply shapes).
4. **Multi-turn harness crash** (`agent-oos-quote-refresh`): a turn cut off at the step limit leaves a
   dangling assistant tool-call; pushing the next user turn onto it makes `generateText` reject the
   history. The harness now trims incomplete trailing tool exchanges between turns.

**Prod is live:** `https://kfc-conversational-ordering.vercel.app` (P0-3). Deployed twice on 2026-07-06 —
the second time to close a real hole found by probing: **both channel webhooks ran the agent for
unsigned POSTs** when the channel secret was unset (stub mode is intentional locally for the eval
harness, but on the public URL it let anyone burn gateway credits — confirmed live: unsigned POST →
202 in 5.8s). Both routes now fail closed (503) on `VERCEL_ENV=production` until
`MESSENGER_APP_SECRET` / `ZALO_OA_SECRET` are set; Facebook's GET verification still works
(webhook callback `/api/webhook/messenger`, verified end-to-end with the real challenge handshake).

## Update — 2026-07-06 (evening): Messenger live end-to-end, Zalo removed, nudge = a measured forecast

- **Messenger is LIVE**: real Page (`Chirpy AABW Project`), webhook verified, signature enforcement on,
  first real customer conversation persisted (`messenger:<psid>` row, taste memory accruing). Agent model
  on prod: Sonnet 5 (flips to Opus for demo day).
- **Zalo fully removed** (product decision): webhook route deleted, channel/type/env/schema references
  scrubbed, DB constraints tightened to `('web','messenger')` (migration `drop_zalo_channel`). The pitch
  drops the Zalo line entirely rather than carrying an unshippable adapter.
- **P2-8 proactive nudge shipped as a demand-TIMING forecast** (`lib/nudge.ts`): fire = elapsed ≥ 1.25×
  the customer's own median reorder gap AND context window (rain/evening). No LLM in the trigger —
  statistics decide, templates speak. `/api/nudge` returns the decision math (`wouldFire`, median gap,
  threshold, context match) so /backend shows WHY it fired. Verified live: fire / not_overdue /
  context_mismatch all reproduce on seeded linh.
- **Suite 4 — nudge targeting precision** (deterministic, free, seed-disjoint): 200 held-out simulated
  customers, half lapsed. **Precision 94.7% · recall 100%** — nudges hit lapsed customers and leave
  on-cadence customers alone (6/93 false positives). This is the honest basis for the word
  "forecasting" in the deck.

## Update — 2026-07-06 (night): catalog swapped to the OFFICIAL KFC Vietnam menu

The mock catalog is gone. `lib/menu.ts` now carries the real menu — names, prices, and combo
contents pulled from kfcvietnam.com.vn on 2026-07-06 (raw capture: `menu.json` at the repo root,
`CATALOG_VERSION = kfc-vn-official-2026-07-06`). Internal ids stay stable SKU keys; a few were
renamed to match reality (corn-soup→seaweed-soup, milo/aquafina→Lipton/7Up, hot-wings→tenders,
teriyaki-rice→fried-chicken-rice). Seeded Supabase history was migrated in place.

What this buys on stage:
- **Every price a judge sees is the official one** — 37k fried chicken, 79k Combo Burger Zinger,
  269k Party Bucket.
- **Combo Math is now citable**: Party Bucket 269k vs 404k list = a real 115k saved (verified in
  the optimizer live: 9 pieces itemized → `combo-party-6`, saves 115.000₫). Big Combo saves 53k.
  The old invented 14.000₫ zinger-combo saving coincidentally SURVIVES on real prices (93k → 79k).
- The hot-day pick is honest: the real menu has no ice cream, so nóng → **Lipton mát lạnh 17k**.

Post-swap numbers (regenerated, free suites): lib pipeline **28/30** (was 25/30 — the swap plus
three search-scoring fixes actually improved NLU), personalization lift **+7.4pp** on 998 held-out
events (was +9.6pp on the old synthetic catalog — expected shift, same methodology), nudge
precision/recall unchanged (94.7% / 100%). Voucher minimums rescaled to real price levels
(KFC20 ≥60k, LUNCH50 ≥150k). The recorded Opus agent baseline (21/28) predates the swap —
re-run scheduled for build day.

## Update — 2026-07-07: OMS + real loyalty + live weather + OTP hardening + Odoo modules + /voice

Six tracks landed (all verified: `tsc` clean, 9 test suites green, `next build` clean, durable
Supabase path exercised end-to-end).

**Now real (was mocked)**
- **OMS lifecycle** — `place_order` persists to `kfc_orders` + `kfc_order_events` and walks
  `placed → preparing → ready → completed` (or `cancelled`) with server-side transition guards
  (`lib/oms-store.ts`). New agent tool `check_order_status` lets a customer ask where their order is.
  Managed from `/backend`'s Orders module and `/api/orders` (list + advance).
- **Loyalty ledger** — real points bound to the messaging identity (`msgr_<psid>` / web persona);
  earn 1pt / 1,000 VND on placement, debit on redemption, ledgered in `kfc_loyalty` /
  `kfc_loyalty_events` (`lib/loyalty.ts`). `check_loyalty` reads the real balance.
- **Vouchers** — rules now live in `kfc_vouchers` (60s runtime cache, hardcoded fallback);
  created/toggled from `/backend`'s Vouchers module (`/api/vouchers`).
- **Live weather** — `lib/worldstate.ts` fetches HCMC weather from Open-Meteo (no key, 10-min cache)
  → `clear/rainy/hot` + real temperature, plus a deterministic VN calendar note
  (`lib/vn-calendar.ts`). Injected into web + channel agent context after the cache breakpoint; the
  operator override still wins and now expires after 1h. Default weather control is **Live**.
- **OTP** — real SMS via Twilio behind the provider interface (`lib/sms.ts`, env-gated
  `TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM`); real delivery suppresses the demo dev-code. Request
  rate-limiting: 60s resend cooldown + max 3 mints / 10-min window (`kfc_otp` gains counter columns).

**New surfaces**
- **`/backend` → Odoo-style modules**: Đạo diễn (director), Đơn hàng (OMS queue), Khách hàng
  (loyalty + taste profile), Voucher (CRUD), Kho (OOS), Agent (ops board). Every module stays mounted
  so the Director's live BroadcastChannel link never resets across tabs.
- **`/voice`** — a VRM virtual ambassador (`three` + `@pixiv/three-vrm`, dynamically imported so it
  never enters other bundles). Push-to-talk vi-VN speech in, browser TTS out with word-boundary
  lip-sync + blink/idle/thinking/happy motion, driven by the **same** `/api/agent` + tools. TTS is
  behind a swappable `Speaker` interface (`lib/speech.ts`) so ElevenLabs drops in later.

**New env vars** (all optional — everything works without them):
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` (real OTP SMS). Open-Meteo needs no key.

**New/changed routes**: `/api/orders`, `/api/loyalty`, `/api/vouchers`, `/voice`;
`/api/demo` accepts `weather:"live"` to clear the override.

### Local demo flow

```bash
npm run dev   # open http://localhost:3000 — use localhost, not 127.0.0.1
# /user    → the customer's phone (chat only — what the "customer" screen shows)
# /backend → the operator console (modules: director, orders, customers, reengage, vouchers, stock, agent)
# /voice   → the VRM virtual ambassador (talk to order; needs Chrome/Edge + mic)
# Open /user and /backend in the same browser; they sync live over a BroadcastChannel.
# Controls (persona/weather/hour/reset/OOS) live on /backend and steer /user.
```

Beats (mirrored in the left rail): ① persona Linh + rain on → order a zinger → rainy corn-soup
suggestion chip → accept · ② apply KFC20 + points · ③ "xem có cách nào rẻ hơn không" → Combo Math
card → accept · ④ toggle the OOS scenario, confirm delivery, enter the dev OTP shown in chat →
out-of-stock recovery → order number · ⑤ "Khách quay lại" → greet → agent offers the usual.

Simulate a channel webhook without a Meta app:

```bash
curl -X POST http://localhost:3000/api/webhook/messenger -H "Content-Type: application/json" \
  -d '{"entry":[{"messaging":[{"sender":{"id":"tester"},"message":{"text":"Cho minh 1 burger zinger"}}]}]}'
```

## Update — 2026-07-10: Nudge v2 — predictive re-engagement (hour-level send timing)

The nudge grows a second stage. v1 (unchanged, still the first gate) answers **which day** to
re-engage: median reorder gap × 1.25 overdue factor + appetite-window context. v2 adds **what time
of day**: a recency-weighted **circular mean** of the customer's own order hours (`lib/reengage.ts`).
Hours wrap — a naive average of 23:30 and 00:30 says noon; the vector mean says midnight — and the
resultant length R of the weighted hour-vectors is a free honesty measure: R→1 = tight habit,
R→0 = the customer orders whenever, and we don't pretend otherwise.

- **Confidence = R × sample factor** (ramps over 2→5 orders), send gate at ≥ 0.6. Low for sparse
  history AND for scattered history — the two honest reasons not to send.
- **Send time = predicted hour − 12 minutes** (inside the spec'd 10–15-min lead window).
- **Predictor is an interface** (`Predictor`), so logistic regression / GBM / RL can swap in later
  without touching the gates, scanner, API, or console.
- **Gates, in order** (first failure wins): explicit opt-out ("dừng", intercepted deterministically
  in `lib/channel.ts` before the LLM — bare "dừng"/"stop" defers to the agent when an order is
  mid-funnel, and "dung" is deliberately NOT matched: it's how "đúng"/"correct" is typed without
  diacritics) → auto-mute (2 consecutive ignored sends; "ignored" = no order within 48h — we never
  fake open-tracking Messenger doesn't provide) → v1 day-level gate, where a customer's OWN
  habitual hour (confident prediction, ±1h) counts as an appetite window alongside rain/heat/evening
  → 7-day cooldown → confidence → quiet hours (08:00–21:00 VN only). The scanner additionally skips
  mid-funnel conversations (the ghost-followup sweep owns those — no double-contact in one window).
- **Durable state**: `kfc_reengage_prefs` + `kfc_reengage_notifications` (Supabase, in-memory
  fallback), powering cooldown, the ignore counter, and the console history panel.
- **Surfaces**: `/api/reengage` (decision + timeline + notification history, plus a seeded
  deterministic convergence simulator), `/api/reengage/scan` (cron scanner, same sweep guardrails
  as followup/broadcast: Messenger-only, no synthetic customers, inside the 24h window), and a
  **"Tái kích hoạt" module in `/backend`** — prediction card, confidence bar, 0–24h order-time
  timeline, gate explanations, and the convergence demo: personalized error shrinking day-over-day
  against a flat generic-blast baseline.

**Suite 5 — send-time prediction convergence** (deterministic, free, seed 7701 disjoint):
150 held-out simulated customers, 8 orders each. Mean prediction error **6.0 min after 2 orders →
3.3 min after 8**; generic fixed-time blast baseline **260.3 min**. Sends unlock (confidence ≥ 0.6)
at 4 orders for 100% of customers. Unit tests cover wraparound, recency weighting, the confidence
gate, and full gate ordering (`tests/reengage.test.ts`, in `npm test`).

**Honest limits, stated plainly:**
- Proactive Messenger sends **outside the 24h standard messaging window require an approved/paid
  message tag** (`MESSAGE_TAG` / sponsored messages). The scanner only sends inside the window;
  most "tomorrow at 11:18" sends would need the paid path in production. The UI says this too.
- The Vercel **Hobby tier runs crons at most daily** — the shipped cron fires 04:15 UTC (11:15 VN,
  just before the lunch window). True "12 minutes before each customer's personal hour" needs
  Pro-tier minute-level cron (`*/15`) or an external scheduler; the scan endpoint is idempotent
  and ready for either.
- There is deliberately **no "notification opened" event** — Messenger gives no honest open signal.
  The only tracked outcomes are a send, and whether an order followed it.
- The "dừng" opt-out intercept lives on the **Messenger inbound path only**; web/`/voice` chats go
  through `/api/agent`, which has no opt-out handling yet. Real proactive sends are Messenger-only,
  so the promise holds where it's made — but wiring the same intercept into `/api/agent` is the
  next step if web ever gets proactive pushes.

### Going live on Messenger (~30-60 min, no app review needed for testers)

1. developers.facebook.com → create a Business app + a Facebook Page.
2. Add Messenger → generate a Page access token → `MESSENGER_TOKEN`.
3. Webhook URL `https://<domain>/api/webhook/messenger`, verify token of your choosing →
   `MESSENGER_VERIFY_TOKEN`, subscribe to `messages`.
4. Optionally `MESSENGER_APP_SECRET` to enforce signature verification (skipped while unset).
5. Zalo is the same adapter: set `ZALO_OA_TOKEN` / `ZALO_OA_SECRET` once the OA is approved.
