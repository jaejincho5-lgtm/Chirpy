# BUILD DAY PLAYBOOK — 2026-07-11

**Mission:** turn the KFC project from "many small features" into ONE unforgettable demo:
*a driver orders dinner by voice in under 30 seconds, hands-free, and the receipt lands back in
their Messenger chat.* Everything tomorrow serves that scene.

**Why we win:** most teams will demo a chatbot that fills a cart. We demo an **identity that
follows the customer across chat and voice**, a system that **remembers you after one order**,
**applies the best discount without being asked**, and **answers instantly** — with an ops console
that proves none of it is smoke. Judges reward teams that look like they could ship Monday.

---

## 0. Morning setup (30 min, EVERYONE, before any code)

1. `git pull` on `main` (or the agreed branch). `cd kfc-conversational-ordering && npm install`.
2. `npm run dev` → open `http://localhost:3000` (use **localhost**, not 127.0.0.1). Check `/user`,
   `/backend`, `/voice` all load. If they don't, STOP and fix together before splitting up.
3. Env keys (one person, 20 min, in `.env.local` + Vercel dashboard):
   - **`ELEVENLABS_API_KEY`** ← sign up at elevenlabs.io (free tier is enough for build day;
     upgrade before demo if quota bites). NEEDED BY LANE A.
   - Confirm existing keys still present: `AI_GATEWAY_API_KEY`, Supabase vars, `MESSENGER_TOKEN`,
     `MESSENGER_APP_SECRET`, `MESSENGER_VERIFY_TOKEN`, Twilio (optional).
4. Phone check: the demo phone can open the Messenger Page chat and gets replies. Send "hello",
   get an answer. If the webhook is dead, fixing it is priority zero.
5. Everyone opens Claude Code **from the AABW root folder** (that's where the `/goal-*` commands
   live): `cd AABW && claude`.

## 1. How to run a goal (first-time hackers, read this twice)

Each feature is a slash command in `.claude/commands/`. The command contains the FULL spec —
context, exact files, edge cases, acceptance checklist. You don't need to know the codebase; the
prompt does.

1. In Claude Code, type the command, e.g. `/goal-usual`, and press enter.
2. Let it work. Answer its questions if it asks. Don't interrupt unless it's clearly stuck.
3. When it finishes, **verify like a user, not like a coder**: it will tell you the manual test
   steps (e.g. "open /voice and say X"). Actually do them.
4. If verification passes: `git add -A && git commit` (Claude will propose a message) and tell the
   team in the group chat: "✅ goal-usual done".
5. If something's broken, paste the error/behavior back into the same Claude session and say
   "fix this". Do NOT start a new goal with a broken one in your working tree.
6. **One goal at a time per person. Never run a goal from someone else's lane** (file conflicts).
7. Stuck > 45 min on one goal? Flag Phineas. We cut or reassign — no heroics, the demo is the boss.

## 2. Lanes (who runs what, in order)

Lanes touch disjoint files so nobody merge-conflicts. Run your lane's goals IN ORDER.

| Lane | Person | Goals (in order) | Files owned |
|---|---|---|---|
| **A — Voice** | strongest tinkerer | `/goal-handsfree` → `/goal-tts` → `/goal-voice-polish` | `app/voice/*`, `lib/speech.ts`, `app/api/tts/*` |
| **B — Agent brain** | second technical | `/goal-usual` → `/goal-memory` → `/goal-voucher` | `lib/agent.ts`, `lib/profile.ts`, `lib/order.ts`, `lib/contact-store.ts` |
| **C — Platform** | third | `/goal-chirpy` → `/goal-answer-cache` | `lib/channel.ts`, `lib/voice-link*`, `lib/answer-cache*`, new api routes |
| **D — Design/story** | design eye | `/goal-backend-ui`, then demo assets (slides, phone mount, script cards) | `app/backend/modules/*`, `app/globals.css` |

Dependency notes:
- `/goal-chirpy` (C) and `/goal-handsfree` (A) both edit `app/voice/page.tsx` in SMALL, different
  spots — C's change is ~15 lines at the top. Sequence it: **A finishes `/goal-handsfree` first**,
  then C runs `/goal-chirpy` after pulling A's commit. Everything else is fully parallel.
- `/goal-usual` should land before `/goal-chirpy` is demoed (the voice beat says "như mọi khi").

## 3. Schedule (demo at ~18:00; adjust to the real deadline)

| Time | A — Voice | B — Agent | C — Platform | D — Design |
|---|---|---|---|---|
| 09:00 | setup (§0) | setup | setup | setup |
| 09:30 | `/goal-handsfree` | `/goal-usual` | *(wait for A's commit)* prep Messenger/page checks | `/goal-backend-ui` part 1 |
| 11:00 | `/goal-tts` | `/goal-memory` | `/goal-chirpy` | `/goal-backend-ui` part 2 |
| 13:00 | **CHECKPOINT 1** — deploy to Vercel, run the demo path end-to-end once, list breakages | | | |
| 13:30 | `/goal-voice-polish` | `/goal-voucher` | `/goal-answer-cache` | slides + script cards |
| 15:30 | **CHECKPOINT 2** — deploy, FULL demo rehearsal #1 on the real phone, fix list | | | |
| 16:00 | fix list only — NO new features after 16:00, no exceptions | | | fix list |
| 17:00 | rehearsal #2 and #3 (time them), record a backup video of the whole flow | | | |
| 17:45 | freeze. Deploy. Charge the phone. Breathe. | | | |

**Cut order if behind** (drop from the bottom): `/goal-answer-cache` → `/goal-voucher` →
`/goal-voice-polish` (partial is fine) → `/goal-memory`'s OTP-skip half. NEVER cut:
`/goal-handsfree`, `/goal-tts`, `/goal-chirpy`, `/goal-usual` — they ARE the demo.

## 4. The 3-minute demo script (rehearse against this exactly)

> **Setup:** projector shows the laptop with `/backend` (Đạo diễn module) + a mirrored phone.
> Messenger chat already has history as customer "Linh" (2 prior orders — seed beforehand).

1. **(0:00) The hook, speak it:** *"KFC Vietnam loses customers at one exact moment: when chat
   says 'download the app to finish'. We removed every step between craving and confirmed order —
   watch a driver order dinner at a red light."*
2. **(0:20) Chat beat:** on the phone, Messenger: "đói quá" → agent greets Linh BY TASTE, suggests
   her usual with price. Point at the screen: *"one prior order — it already knows her."*
3. **(0:40) The handoff:** type `.chirpy` → link arrives instantly (no AI in that path — say it:
   *"that reply is deterministic, 0ms, 0 cost"*) → tap → `/voice` opens **already greeting Linh by
   name with her usual.**
4. **(1:00) Hands-free order:** phone propped up, hands OFF. "Như mọi khi, giao về nhà nha" →
   chicken talks back with real TTS, receipt slides in, saved address confirmed with one word
   ("ừ") → *"em áp sẵn mã KFC20, bớt 18k"* (auto-voucher — point it out: *"she never typed a
   code"*) → one smart attach ("thêm Pepsi như mọi lần không?") → "ừ" → trusted-customer checkout,
   order PLACED, chicken celebrates, spoken order number.
5. **(1:50) Close the loop:** hold up the phone — **the receipt is in the Messenger thread.**
   *"One identity across chat and voice. Zero typing. Under 30 seconds."*
6. **(2:10) Prove it's real:** cut to `/backend` — the live order in the OMS queue, advance it to
   'preparing' → (if status pushes are demoable) the push hits the phone. Flash the Customers
   module (taste profile), Tái kích hoạt (send-time prediction: *"we know she's an 11:30 lunch
   person — we message at 11:18, and our error converges to 3 minutes"*), and the answer-cache
   hit counter.
7. **(2:40) The numbers slide:** 95% nudge precision · +7–9pp personalization lift · checkout
   turns 7→3 · answer cache hit-rate → *"every number came from a test suite in the repo, and
   `npm test` is green. We're ready for KFC's real APIs Monday."*

**Fallbacks (decide NOW, not on stage):** TTS quota dies → browser voice auto-fallback is built
in, keep going. Mic flakes on venue wifi → the type-to-chirpy input is one tap away. Anything
worse → play the backup video recorded at 17:00 and narrate live (practiced once).

## 5. Judge Q&A cheat sheet (30-second answers, everyone memorizes)

- *"Is the AI making up prices?"* — No. The model can only call tools; every cart line is
  re-validated server-side against the official KFC VN menu. It cannot invent a price.
- *"What's real vs mocked?"* — Real: Messenger E2E, orders/loyalty/vouchers durable in Supabase,
  live HCMC weather, real OTP via SMS. Mocked: final OMS fulfilment handoff + payment (that's the
  Monday integration), synthetic history for the learning proofs — and we say so on the slide.
- *"Why voice?"* — Drivers and kitchens. Hands are busy; VN is a motorbike country. The magic
  link means zero-install voice — no app, no account creation, identity carries over from chat.
- *"How does the cache never answer wrong?"* — Hard negative guard: any message with an ordering
  signal skips every cache and hits the real agent. Caches only store order-neutral, evergreen
  answers, versioned against the menu catalog.
- *"What would you do with real KFC data?"* — Swap the synthetic POS log for real order history —
  the recommendation and send-time interfaces don't change (they're built as swappable predictors).

## 6. Definition of done, per goal

A goal is DONE when: (1) its acceptance checklist in the command file passes, (2) `npm test` and
`npm run build` exit clean, (3) the manual demo-path test worked on localhost, (4) committed with
a descriptive message, (5) announced in the group chat. Not before.
