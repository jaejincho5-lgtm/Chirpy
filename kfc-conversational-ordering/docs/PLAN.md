# PLAN — Project COLONEL: next actions through demo day

**Written:** 2026-07-04, against commit `17d8446` · **Event:** AABW build week Jul 8–12, HCMC
**State:** WP-0–9 delivered · keyless gate green · Suite 3 lift +9.6pp · demo split into `/user` + `/backend` ·
channel layer built (Messenger/Zalo send APIs, server-side conversations) · Supabase `aabw-colonel` live ·
Vercel production env vars set · agent currently on **Haiku free tier** (rate-limited, sloppy)

Priorities are ordered. P0 = demo fails without it. Each item has owner, effort, exact steps, acceptance.
"You" = human task (accounts/money/paperwork). "Agent" = Claude/Codex session. Anchors are file:symbol.

---

## P0-1 · Conversation quality — fix the "terrible flow" (Agent, ~half day incl. testing)

**Evidence (live transcript, Haiku, 2026-07-04):** ordering a Pepsi produced five distinct failures:

| # | Failure | Example from transcript |
|---|---------|--------------------------|
| 1 | Acted + asked about the same action in one message | "✓ Thêm 1 Pepsi Medium… Bạn muốn upsize lên Large không?" |
| 2 | Asked the same question twice in one bubble | upsize question repeated back-to-back |
| 3 | Dropped its own pending question | user: "okay" (= yes, upsize) → agent: "Bạn còn muốn order gì nữa không?" — upsize never applied |
| 4 | Asked the customer for the store's address | "cho mình địa chỉ cửa hàng KFC gần bạn nhất" — the business knows its stores |
| 5 | Code-switched filler tone | "Perfect!", "Okiee", "upsizee"; reformatted the phone to +84 (→ ugly mask "840***458") |

**Root cause:** under-specified system prompt + small model. Fix both; prompt first so the improvement
is measurable per-model.

### Step 1 — add a "Conversation discipline" block to `SYSTEM` (`lib/agent.ts:34`)

Insert after the "Core rules" block (drafted and reviewed, paste as-is):

```
Conversation discipline:
- Vietnamese only. Warm and brief. No English filler ("Perfect", "Okay", "Okiee"). At most one emoji per message.
- Ask at most ONE question per message — never two, never the same question twice.
- Never combine an action and a question about that same action. Act with sensible defaults instead:
  quantity 1, size Medium, spice original. Mention the default in passing ("size Medium nhé, muốn lớn hơn
  thì nói mình") rather than asking.
- If your previous message asked a yes/no question, a short reply ("ok", "okay", "ừ", "dạ", "được") answers
  THAT question — act on it with the right tool call first. Never leave your own question unresolved.
- Pickup orders: NEVER ask the customer for a store address — the business knows its stores. Ask which
  quận/khu vực they are in, then confirm pickup there via quote_order (fulfillment "pickup", address = their area).
- Before request_otp, recap in one line: items + total + fulfillment. Pass the customer's phone number to
  request_otp exactly as they typed it — do not reformat it.
- Never re-ask for information already given in this conversation (phone, area, chosen items).
```

### Step 2 — regression-test the exact failing flow

Replay the transcript's shape via the webhook simulator (server must run with env + key):

```bash
# turn 1: "cho pepsi"          → expect: adds Medium w/ default note, at most ONE question
# turn 2: "okay"               → expect: resolves whatever was asked, or proceeds; no dropped question
# turn 3: "lấy, hoàn kiếm, 0889923458" → expect: pickup quote for the area; NEVER asks for a store address
curl -X POST http://localhost:3000/api/webhook/messenger -H "Content-Type: application/json" \
  -d '{"entry":[{"messaging":[{"sender":{"id":"flowtest"},"message":{"text":"cho pepsi"}}]}]}'
```

Score each turn against the 5 failure modes. Run the same 3 turns twice (Haiku is nondeterministic).

### Step 3 — add 3 Suite 2 cases pinning the behavior (`eval/cases.jsonl`)

```jsonl
{"id":"agent-default-size","suite":"agent","input":"cho pepsi","intent":"add_to_cart","expect_tools":["search_menu","add_to_cart"],"expect_item_any":["pepsi-medium"],"forbid_reply_contains":"?.*?\\?"}
{"id":"agent-short-yes","suite":"agent","multi_turn":["Cho 1 pepsi, size lớn được không?","okay"],"intent":"add_to_cart","expect_item_any":["pepsi-medium"]}
{"id":"agent-pickup-no-store-address","suite":"agent","input":"(cart preloaded) lấy tại hoàn kiếm, sđt 0889923458","intent":"quote","expect_tools":["quote_order"],"forbid_reply_contains":"địa chỉ cửa hàng"}
```

Note: `multi_turn` and `forbid_reply_contains` need small runner support in `eval/run.ts` (the runner
currently sends a single `prompt`; extend to a messages array + reply regex assertions).

**Acceptance:** all 5 failure modes absent in 2/2 replays of the 3-turn flow on Haiku; new Suite 2
cases pass on Opus after P0-2; keyless gate stays green.

---

## P0-2 · Gateway top-up + the real Suite 2 baseline (You: 5 min · Agent: 1 h)

The single most overdue measurement. Everything so far ran on rate-limited free-tier Haiku
(~10 cases before 429s; 8/38 last partial run — includes rate-limit noise, not a real number).

1. **You:** Vercel dashboard → AI Gateway → **Top up $5–10** (card already on file).
2. **Agent:** `npm run eval` with `AI_GATEWAY_API_KEY` + default model (Opus 4.8) → record the honest
   38-case number in README (replace nothing; add "Suite 2 baseline (Opus): N/38, date").
3. **Agent:** rerun the P0-1 flow test on Opus — expect most discipline issues to shrink further.
4. Decision gate: if Suite 2 (Opus) < 30/38, triage failures into prompt vs eval-case issues before
   any new features. Suspected soft spots from the Haiku partial: `voucher-2` (question-shaped wording
   "co freeship khong" — arguably should expect an answer, not an apply), craving→add chains.

**Acceptance:** README carries a dated Opus Suite 2 number; failures triaged with one-line causes.

---

## P0-3 · Production deploy + smoke (Agent, ~1 h, needs P0-2's top-up for a usable live agent)

1. `vercel --prod` from `kfc-conversational-ordering/` (env vars already set on the project).
2. Set `AGENT_MODEL=anthropic/claude-opus-4-8` in Vercel env (currently haiku) after top-up.
3. Smoke on the deployed URL: `/` launcher renders · `/user` completes beats 1–4 · `/backend` syncs
   in a second tab · `POST /api/webhook/messenger` (simulated payload) returns a reply and persists
   to `kfc_conversations` · Supabase writes visible.
4. Check function region; if latency to `ap-southeast-1` Supabase is noticeable, set region `sin1`
   (`vercel.json` → `{"regions":["sin1"]}`) and redeploy.
5. Record the stable production URL in README + report.md (the per-deployment URLs rot).

**Acceptance:** a phone on mobile data (not your wifi) completes a full order on the prod URL.

---

## P0-4 · Live Messenger (You: 30–60 min · Agent: 30 min verification)

Prereq: P0-3 deployed URL. Steps (also in README "Going live on Messenger"):

1. developers.facebook.com → create **Business** app + a Facebook Page (name it like a demo store,
   e.g. "KFC VN Demo — COLONEL").
2. Add Messenger product → generate **Page access token** → Vercel env `MESSENGER_TOKEN`.
3. Webhooks → URL `https://<prod-domain>/api/webhook/messenger`, verify token = your choice →
   also set as `MESSENGER_VERIFY_TOKEN` in Vercel env → subscribe to `messages`.
4. App Roles → add the team's personal FB accounts as **Testers** (no app review needed).
5. Set `MESSENGER_APP_SECRET` (App settings → Basic) to enforce signature verification.
6. Redeploy (env changes need a new deployment) → message the Page from a phone.

**Verification (Agent):** confirm rows in `kfc_conversations` keyed `messenger:<psid>`, replies
delivered (`sent:true` in logs), multi-turn cart continuity from a real phone, and taste-memory
carryover: place an order, then greet again → "như mọi khi?".

**Known gap (accept for demo):** OTP and combo-swap proposals are in-memory per serverless
instance. On Fluid Compute a continuous chat usually stays warm, but if OTP verify fails oddly
during rehearsal, the fix is a `kfc_otp` table mirroring `lib/otp.ts`'s provider interface (~1 h,
schema + swap the provider; do NOT start this unless rehearsal shows the problem).

---

## P1-5 · Zalo OA track (You, paperwork; zero engineering)

1. Register at oa.zalo.me (needs business info — decide whose entity; check whether AABW/GenAI Fund
   provides partner OAs for teams — **ask the organizers first**, cheapest path).
2. If/when approved: developers.zalo.me app → link OA → set `ZALO_OA_TOKEN` + `ZALO_OA_SECRET` in
   Vercel env, webhook URL `https://<prod-domain>/api/webhook/zalo`. Code path is already live.
3. If not approved by Jul 10: pitch line stays "same adapter, paperwork gate, not engineering gate" —
   show `lib/channel.ts` sendChannelReply's Zalo branch on the integration slide.
4. **Do not** use zca-js/personal-account bridges live (ToS risk in front of the partner; ban risk
   mid-demo). If a Zalo visual is mandatory, record a burner-account clip in advance, labeled as such.

---

## P1-6 · Demo choreography + dry-runs (You + Agent, Day 4 of build week)

Stage setup: projector = `/backend` · laptop screen = `/user` in a phone-sized window · real phone =
live Messenger (prod). Beats (already in the `/backend` rail):

1. Linh + Mưa → "Cho mình 1 burger zinger và khoai tây" → corn-soup chip (rainy reason) → accept.
2. "Áp mã KFC20 và dùng điểm" → receipt shows both deductions.
3. "Xem có cách nào rẻ hơn không" → Combo Math card → accept → total drops, voucher survives.
4. Toggle OOS **before** checkout → confirm + OTP → place fails → substitutes → pick Milo → order #.
5. "Khách quay lại — chat mới" → greet → "như mọi khi?" (the money shot).
6. Pull out the real phone → same order in real Messenger → point at `/backend`: "same agent, same
   memory — this is the production pipe."

Rules (from the playbook, non-negotiable):
- **Record every beat** as a fallback clip (conference wifi will fail). Screen-record a clean run of
  /user + /backend side by side, and a phone screen recording of the Messenger flow.
- **5+ full dry-runs** before the real one; one dry-run on venue wifi if possible.
- Assign one person as operator (drives `/backend`), one as customer (drives `/user`/phone).
- Pre-demo checklist: gateway credits > $3 · `kfc_conversations`/history rows for persona "linh"
  seeded (or perform beat 1–5 as the seed, live) · OOS toggle OFF at start · dev server nowhere in
  sight (prod URL only).

**Known BroadcastChannel constraint:** `/user` and `/backend` sync only within one browser. The real
phone's Messenger traffic does NOT mirror into `/backend` today. If you want the console to mirror
the phone during beat 6, that's P2-9 — otherwise narrate it ("check the database" is also a flex).

---

## P1-7 · Suite 2 runner upgrades to match reality (Agent, ~2 h)

Current runner sends one prompt per case; real flows are multi-turn (that's exactly where the
transcript fell apart). Extend `eval/run.ts`:

- `multi_turn: string[]` — send messages sequentially through one runtime (reuse `generateText`
  with accumulated messages; assert on final state).
- `forbid_reply_contains` / `expect_reply_matches` — regex assertions on the final `say`.
- Reset in-memory stores between cases (already done) AND between turns only when specified.
- Add the 3 P0-1 cases + 2 more: OOS-recovery-with-quote-refresh; return-visit greeting includes the
  actual usual item name (not a hallucinated one).

**Acceptance:** runner supports multi-turn; 43+ cases total; keyless skip still clean.

---

> **P1.5 — the "unfair advantage" backlog** now lives in [`OPTIMIZATIONS.md`](./OPTIMIZATIONS.md)
> (19 ideas with effort/files/acceptance; top five: live profile card, prompt caching,
> cost-per-order, Messenger rich cards, adversarial eval). Slot after P0-4, before P2.

## P2 — only if ahead of schedule (explicitly NOT before P0/P1)

- **P2-8 · Proactive nudge (F10):** trigger = elapsed > 1.25× the customer's median reorder gap AND
  context match, or a voucher hitting their usuals with expected-acceptance above threshold (reuse
  `suggestAddons` scoring). Guardrails: opt-in after first completed order, ≤1/week, quiet hours,
  auto-mute after 2 ignored, one-tap order + visible stop. Demo: "Giả lập tối thứ 6 mưa" button on
  `/backend` firing an agent-initiated message into `/user`. Eval: nudge precision on held-out sim
  customers (Suite 3 harness extension). ~half day.
- **P2-9 · Cross-device backend mirror:** channel-mode conversations already persist server-side;
  add `GET /api/console-state?convo=...` + polling (or Supabase realtime) so `/backend` can mirror
  the real phone's Messenger session during beat 6. ~2–3 h.
- **P2-10 · Food photography on menu cards:** the single biggest remaining visual lift. Real KFC VN
  product shots (or generated once, reviewed) as base64/static assets keyed by catalogId; cards
  already have the layout slot. Do NOT ship SVG/CSS food.
- **P2-11 · Durable OTP + swap-proposal store** (see P0-4 known gap; promote only if rehearsal bites).
- **P2-12 · Voice notes:** Web Speech API in `/user` composer (vi-VN), gated behind a flag; demo only
  if it survives 5 dry-runs — otherwise it stays a recorded clip.

## Kill-questions to rehearse (judges will ask)

1. "Is the learning real?" → Suite 3: +9.6pp on 965 held-out events, learning curve by history size;
   live: the return-visit beat used history written 2 minutes earlier (show the Supabase row if pushed).
2. "Is this actually deployable on Zalo?" → same adapter, code on screen, OA paperwork status; consent
   model honest (OA rules respected — that's why nudges are opt-in).
3. "What's mocked?" → OMS/loyalty/payments behind production-shaped adapters; synthetic POS data,
   stated on the slide. Everything the judges watched (agent, tools, memory, channel) is real.
4. "Why should I trust the savings number?" → deterministic exhaustive optimizer, unit-pinned
   (14.000₫/33.000₫ in tests), voucher recompute survives the swap.
5. "What happens at scale / multi-instance?" → Supabase-backed state; the two in-memory pieces (OTP,
   swap tokens) are named with their production fix — don't get caught claiming otherwise.

## Sequence summary

| When | Item | Owner |
|---|---|---|
| Today/tomorrow | P0-2 top-up (5 min) → P0-1 prompt fix + flow test → P0-2 Opus baseline → P0-3 deploy | You + Agent |
| Jul 8 (D1) | P0-4 Messenger live · P1-5 Zalo paperwork submitted · P1-7 runner upgrades | You + Agent |
| Jul 9 (D2) | Fix whatever the Opus baseline + real-phone testing surfaced | Agent |
| Jul 10 (D3) | P2 picks (nudge demo button is the highest-wow per hour) | Agent |
| Jul 11 (D4) | P1-6 choreography, recordings, 5 dry-runs | Team |
| Jul 12 (D5) | Deck + submission + final dry-runs | Team |
