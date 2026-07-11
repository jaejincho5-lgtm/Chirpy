---
description: "Learned global answer cache: user A's answered question serves user B instantly — with the never-wrong guardrails — plus a hit-rate panel in /backend"
---

You are building the **learned answer cache** for `kfc-conversational-ordering/`: when the agent
answers a general question for one user, the answer is stored so ANY user asking the same thing
later gets it in ~1ms — no LLM call. This sits BEHIND the existing curated FAQ cache and inherits
its philosophy: **NEVER WRONG beats always-hit.** A miss costs latency; a wrong hit costs trust.
Bias hard toward missing. All work happens inside `kfc-conversational-ordering/`.

## Context (read these files first)

- `lib/faq-cache.ts` — the curated instant-FAQ layer. Reuse from it: `normalize()` (lowercase,
  diacritic-strip, punctuation-collapse) and the negative `GUARD_PHRASES` gate (order/mutation
  signals ⇒ always fall through to the real agent). Read its header comment — those three
  enforcement rules govern your layer too. Export whatever you need instead of duplicating.
- Find the faq-cache **call sites** (grep `matchFaq`) — your read hook goes immediately after a
  curated miss, in BOTH the `/api/agent` route and the Messenger channel path if both call it.
- `lib/menu.ts` — `CATALOG_VERSION` (cache entries must be stamped with it and invalidated on
  mismatch, so menu changes can never serve a stale price claim).
- Store pattern: `lib/convo-store.ts` / `lib/reengage-store.ts` (Supabase + memory fallback).
- `/backend` Agent module: `app/backend/modules/agent-ops.tsx` (where the ops panel goes) and
  `app/api/stats/route.ts` (existing stats shape).

## Task

1. **`lib/answer-cache.ts`** — store (Supabase table `kfc_answer_cache` + memory fallback):
   `{ key, say, hits, createdAt, catalogVersion }`, key = `normalize(question)`.
   - `lookupAnswer(message)` → hit only when ALL hold: message passes the GUARD gate (no
     ordering/mutation signal), message is question-shaped/short (reuse the faq-cache heuristics
     for length/shape), normalized key exists, entry `catalogVersion === CATALOG_VERSION`, entry
     age < **24h**. On hit: increment `hits`, return the `say`.
   - `storeAnswer(message, say)` → writes ONLY when the write-policy predicate (below) passes.
2. **Write policy — this is where correctness lives.** Cache a completed agent turn ONLY when
   ALL of these are true:
   - the user message passed the same GUARD gate and question-shape test;
   - the turn used **ZERO tool calls** (any tool — even read-only ones — means the answer
     depended on live data: prices, stock, points, order status ⇒ never cache);
   - the reply contains no personalization markers: no customer name, no point balances, no
     order numbers (reject if it matches `/\b#?\d{4,}\b/` or contains the customer's id/name);
   - the reply is < 400 chars (long answers are usually situational).
   Stamp with `CATALOG_VERSION`. Cap the store at ~500 entries (evict oldest).
3. **Wire the read path:** curated `matchFaq` miss → `lookupAnswer` → hit returns the say through
   the exact same response shape the curated cache uses (so `/user` and `/voice` render/speak it
   identically). Tag the response internally (`source: "learned-cache"`) for logging/stats.
4. **Wire the write path:** where an agent turn finalizes (find where the final `say`/tool-call
   list is known server-side), call `storeAnswer` fire-and-forget.
5. **Ops panel:** track counters (in the store): total lookups, hits, entries. Expose via the
   stats route (or a small `GET /api/answer-cache` if cleaner). In `agent-ops.tsx`, add a compact
   **"Bộ nhớ trả lời chung"** card: entries · hits · hit-rate %, and the 5 most-hit questions.
   Match the module's existing visual style.
6. **TTS synergy (free win):** identical `say` text means the `/api/tts` server cache (if the
   TTS goal has landed) hits too — a cached answer on `/voice` is instant in BOTH text and audio.
   Nothing to build — just verify it happens and mention it in the commit message.
7. **Tests** (`tests/answer-cache.test.ts`, deterministic, memory mode):
   - store→lookup roundtrip on a paraphrase-identical (same normalized) question;
   - GUARD: "cho mình 1 burger" never hits nor stores even if a key exists;
   - a turn WITH tool calls is never stored;
   - reply with an order number is never stored;
   - catalogVersion mismatch ⇒ miss;
   - 24h expiry ⇒ miss (inject a stale `createdAt` — remember `Date.now` is fine in app code,
     just make the test inject timestamps explicitly).

## Acceptance checklist

- [ ] Ask a novel general question ("kfc có phòng sinh nhật không?") as customer A → normal
      agent answer. Ask the SAME question as customer B (different customerId) → near-instant
      reply, identical text, and the backend panel shows the hit.
- [ ] Order-intent messages always reach the real agent (spot-check 3 GUARD phrases).
- [ ] Panel renders with zero data (fresh boot) without breaking the module.
- [ ] `npx tsc --noEmit`, `npm test`, `npm run build` pass.

## Verify, then commit

Run the A-then-B test in two browser profiles on localhost and watch the panel. Commit:
`feat(cache): learned global answer cache with never-wrong guards + ops hit-rate panel`.
