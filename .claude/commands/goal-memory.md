---
description: "Zero-re-entry checkout: save name/phone/address after the first order, confirm-only forever after, risk-based OTP skip for trusted repeats"
---

You are building **zero-re-entry checkout** for `kfc-conversational-ordering/`: the customer
tells us their delivery details ONCE (first order); every later order only *confirms* them with
one word — and trusted repeat customers skip the OTP entirely. The demo line: "checkout went from
7 turns to 3." All work happens inside `kfc-conversational-ordering/`.

## Context (read these files first)

- `lib/order.ts` — the `Order` type. Find where fulfillment lives (delivery vs pickup, address,
  phone) and how `place_order` consumes it.
- `lib/agent.ts` — tool definitions + system prompt; how customer context is injected per turn.
- `lib/otp.ts` — server-side OTP: request/verify, server-tracked `verified` flag that
  `placeOrder` trusts. Your skip logic composes with this — it must set/honor the SAME
  server-side flag, never a client value.
- Store pattern to copy: `lib/convo-store.ts` / `lib/reengage-store.ts` (Supabase + in-memory
  fallback).
- `lib/history-store.ts` — completed-order count per customer (needed for the trust predicate).

## Task

1. **`lib/contact-store.ts`** — new store (project pattern, Supabase table
   `kfc_customer_contacts` + memory fallback):
   `{ customerId, name?, phone?, address?, fulfillment?: "delivery"|"pickup", updatedAt }`.
   `getContact(customerId)`, `saveContact(customerId, patch)`.
2. **Write on success:** wherever order placement completes server-side (the `place_order` tool
   path), persist the order's contact facts (phone, address, fulfillment mode, name if known) to
   the contact store. Overwrite-on-newer; this also handles "customer moved."
3. **Read into the agent:** inject the saved contact into the per-turn customer context (same
   place taste profile/weather context is injected — AFTER any prompt-cache breakpoint, with the
   other volatile context). Add system prompt rules (verbatim intent):
   - *"NEVER ask for a fact that appears in SAVED CONTACT. State it and ask for a one-word
     confirmation: 'Giao về <address> như lần trước nhé?'"*
   - *"If the customer corrects any detail, use the new value for this order (it will be saved
     automatically on placement)."*
   - *"If no saved contact exists, collect details normally — this is their first order."*
4. **Risk-based OTP skip** — a pure, unit-testable predicate in `lib/otp.ts` (or a sibling):
   `canSkipOtp({customerId, order, contact, completedOrderCount})` returns true ONLY when ALL
   hold:
   - env `TRUSTED_SKIP_OTP=1` (default ON in `.env.local` for the demo; document it),
   - `completedOrderCount >= 1`,
   - order total `< 200_000` VND,
   - delivery address matches the saved address (compare with the diacritic-stripping
     `normalize()` from `lib/faq-cache.ts`, whitespace-collapsed) — pickup orders compare
     fulfillment mode instead,
   - a saved contact exists.
   When true: mark the OTP **server-side** as satisfied for this order (whatever `placeOrder`
   checks — set that same server flag through a legit code path, do NOT bypass the check itself)
   and have the agent say so warmly: *"Khách quen nên em bỏ qua bước mã xác nhận nha 💛"*. When
   false: the normal OTP flow runs untouched. New address or big ticket ⇒ ALWAYS full OTP.
5. **Ops visibility:** on the placed order record, store `otpMode: "verified" | "trusted_skip"`
   so `/backend`'s Orders module can show a small badge (add the badge if trivial; otherwise
   just persist the field and note it).
6. **Demo seed:** extend the existing demo-seed path so the demo customer (the one used in
   rehearsal, e.g. `msgr_demo_linh`) has a saved contact — so tomorrow's stage run hits the
   confirm-only + OTP-skip path on the first try.
7. **Tests** (`tests/contact.test.ts`): the skip predicate — all-true case; each condition
   individually false (env off, zero history, total ≥ 200k, address mismatch, no contact) ⇒
   false. Plus contact save/load roundtrip in memory mode.

## Acceptance checklist

- [ ] Fresh customer: full flow — asked for address, OTP required, order places, contact saved
      (verify via the store/backend).
- [ ] SAME customer orders again (< 200k, same address): the agent STATES the address (never
      asks), "ừ" confirms it, NO OTP, order places. Count the turns — must be ≤ 3 after the cart
      is built.
- [ ] Same customer, new address: OTP required again.
- [ ] Same customer, 300k order: OTP required.
- [ ] `TRUSTED_SKIP_OTP` unset: behavior identical to before this change (full OTP always).
- [ ] `npx tsc --noEmit`, `npm test`, `npm run build` pass.

## Verify, then commit

Run the fresh-then-repeat sequence in `/user` chat end-to-end. Commit:
`feat(checkout): saved-contact confirm-only checkout + risk-based OTP skip for trusted repeats`.
