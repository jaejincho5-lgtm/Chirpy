---
description: "Auto-apply the best voucher at quote time — the customer never needs to know a code; the agent announces the saving"
---

You are building **auto-best-voucher** for `kfc-conversational-ordering/`: real customers don't
know promo codes — so at quote/confirm time the system finds the best eligible voucher, applies
it, and the agent announces it: *"Em áp sẵn mã KFC20 cho mình — bớt 18k nha."* Zero-effort savings
= trust = completed orders. All work happens inside `kfc-conversational-ordering/`.

## Context (read these files first)

- `lib/vouchers.ts` — voucher RULES live in `kfc_vouchers` (Supabase, 60s cache, hardcoded
  fallback). Rules have minimum-subtotal conditions (e.g. KFC20 ≥ 60k, LUNCH50 ≥ 150k, FREESHIP
  waives delivery fee). The rule (not a frozen amount) is stored on the order and
  `calculateTotals` in `lib/order.ts` recomputes the discount on every mutation.
- `lib/order.ts` — `calculateTotals`, how a voucher attaches to the `Order`.
- `lib/agent.ts` — find the `quote_order` tool (fulfillment/fees/ETA) and `apply_voucher`.

## Task

1. **`bestVoucherFor(order)` in `lib/vouchers.ts`:** evaluate every ACTIVE voucher against the
   current order (respect each rule's minimums/conditions exactly as `calculateTotals` would),
   compute the concrete saving in VND for each eligible one (including FREESHIP's delivery-fee
   waiver when the order is delivery), return the max-saving voucher + its computed saving, or
   null. Deterministic tie-break (larger saving, then code alphabetical). Pure function — unit
   test it directly.
2. **Hook: auto-apply at quote time.** In the `quote_order` tool's server implementation: if the
   order has NO voucher yet, run `bestVoucherFor`; if one is found, attach it via the SAME code
   path `apply_voucher` uses (rule attached, totals recomputed), and include in the tool result:
   `autoAppliedVoucher: { code, savedVnd }`. Never replace a voucher the customer applied
   themselves — user choice always wins, even if suboptimal.
3. **Mark provenance.** On the order's voucher state add `appliedBy: "auto" | "user"` (set
   "user" in the `apply_voucher` tool, "auto" in the hook). Persist it through to the placed
   order record so ops can count auto-savings later.
4. **System prompt rule (verbatim intent):** *"If a tool result contains `autoAppliedVoucher`,
   tell the customer warmly in the same reply that you already applied it and how much they
   saved (in VND). Never present it as something they must do — it is already done."*
5. **Edge cases:** cart later shrinks below the voucher's minimum → the existing repricing
   already handles the discount math; make sure an auto-applied voucher that becomes ineligible
   is REMOVED (or zeroed per existing behavior) without breaking checkout — follow whatever
   `calculateTotals` does today for ineligible rules and keep it consistent. Re-running
   `quote_order` after cart changes may upgrade the auto voucher to a better one (allowed, only
   while `appliedBy === "auto"`).
6. **Tests** (`tests/vouchers-auto.test.ts`): picks max-saving among multiple eligible; respects
   minimums (59k cart gets nothing, 60k gets KFC20); FREESHIP valued correctly only for
   delivery; never overrides a user voucher; ineligible-after-shrink behaves consistently.

## Acceptance checklist

- [ ] In `/user` chat: build a 60k+ cart, ask to check out/quote → the reply mentions the auto
      voucher + saving, and the receipt total reflects it.
- [ ] Apply a code manually first ("áp mã LUNCH50"), then quote → the user's code is untouched.
- [ ] Sub-minimum cart → no voucher, no mention, no crash.
- [ ] Backend Vouchers module still works (create/toggle) — no regression.
- [ ] `npx tsc --noEmit`, `npm test`, `npm run build` pass.

## Verify, then commit

Run the three chat scenarios above on localhost. Commit:
`feat(vouchers): auto-apply best eligible voucher at quote time with announced savings`.
