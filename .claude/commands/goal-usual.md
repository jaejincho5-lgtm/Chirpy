---
description: "'Như mọi khi' — the one-phrase reorder: replays the customer's last/usual order into the cart in a single turn"
---

You are building the **one-phrase reorder** for `kfc-conversational-ordering/`: a returning
customer says *"như mọi khi"* (the usual) and the cart fills with their habitual order in ONE
turn, priced and ready to confirm. This is the phrase the driver says in the demo — it must be
fast and bulletproof. All work happens inside `kfc-conversational-ordering/`.

## Context (read these files first)

- `lib/profile.ts` — `TasteProfile` already derives `usual` (modal primary item + habitual
  options, requires ≥2 orders at ≥40% share) from `lib/history-store.ts`, which stores each
  customer's completed orders (`CompletedOrderRecord` with `lines: {catalogId, optionIds}`).
- `lib/order.ts` — the server-side cart helpers (`addToCart`, `revalidateOrder`, totals). ALL
  cart mutations must go through these — never hand-build cart lines.
- `lib/agent.ts` — the agent runtime: system prompt + tool definitions. See how existing tools
  (`search_menu`, `add_to_cart`, …) are declared and how they mutate the turn's `Order`.
- `lib/menu.ts` — `getCatalogEntry` for names/validation; items can go out of stock.
- `eval/` + `tests/` — how existing unit tests are written; add yours in the same style.

## Task

1. **`buildUsualOrder(customerId)` in a new `lib/reorder.ts`:**
   - Strategy: prefer an exact replay of the customer's **most recent completed order** (all
     lines). If no completed orders → fall back to `TasteProfile.usual` (single item + options).
     Neither → return `{ ok: false, reason: "no_history" }`.
   - Validate every line through the catalog (`getCatalogEntry` + the `lib/order.ts` helpers) —
     drop lines whose item no longer exists (menu changed) and report them in the result
     (`skipped: string[]`). If everything was dropped → treat as `no_history`.
   - Returns the built cart lines + a human summary (item names + total) — pure function of
     history + catalog, easily unit-testable.
2. **Agent tool `reorder_usual`** in `lib/agent.ts`:
   - No parameters (customerId comes from the runtime context like the other tools).
   - Executes `buildUsualOrder`, applies the lines to the live `Order` via the standard helpers,
     recomputes totals, and returns `{applied, skipped, summary}` (or the no-history failure).
   - **System prompt rule (add verbatim intent):** *"When the customer asks for their usual /
     the same as last time ('như mọi khi', 'như lần trước', 'cái cũ', 'món quen', 'same as
     always'), call `reorder_usual` IMMEDIATELY — no clarifying question first. Then read back
     the cart with the total and ask for one-word confirmation. If it returns no_history, say
     you'll remember from their first order and offer the menu."*
   - If some lines were `skipped` (out of catalog), the agent must mention it honestly and offer
     the closest alternative (the existing OOS-recovery behavior is the model to follow).
3. **Greeting integration:** wherever the returning-customer greeting is composed for the web
   agent (find where profile context is injected into the system/context block), make sure the
   agent knows the usual EXISTS so its greeting can offer it proactively: *"Phần như mọi khi —
   Zinger cay + Pepsi, 87k — chốt luôn không?"*. The order should be confirmable with a single
   "ừ" after that. (The `/voice` chirpy greeting already advertises the phrase — this makes the
   chat side symmetric.)
4. **Tests** (`tests/reorder.test.ts`, keyless/deterministic):
   - replay of last order (2 lines) → both lines, correct total;
   - item removed from catalog → skipped + reported, rest applied;
   - no history → `no_history`;
   - profile-usual fallback when history exists in profile but the exact-replay path is empty
     (construct per the store's shapes).

## Acceptance checklist

- [ ] Seed a customer with 2 completed orders (use the existing seed/dev path the project uses
      for demo customers) → in `/user` chat, send "như mọi khi" → ONE assistant turn later the
      cart shows the last order with correct prices/total, and the reply asks for confirmation.
- [ ] "ừ" then confirms/checkout proceeds normally (no regression in the state machine).
- [ ] A brand-new customerId saying "như mọi khi" → graceful no-history reply, no crash, no
      hallucinated cart.
- [ ] Works identically through `/voice` (same `/api/agent` path — test by speaking it).
- [ ] `npx tsc --noEmit`, `npm test` (including the new suite), `npm run build` pass.

## Verify, then commit

Test both the seeded and the fresh customer paths in the browser. Commit:
`feat(agent): 'như mọi khi' one-phrase reorder — reorder_usual tool + proactive greeting offer`.
