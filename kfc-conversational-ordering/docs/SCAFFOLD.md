# SCAFFOLD — KFC P4 Conversational Ordering

> Session brief. Read `../_starter/README.md` first. Goal: a green-deploying web-chat
> that places a full order by natural language on a mock OMS. See `./README.md`.

## Stack
- Fork `_starter/`. Demo surface = **web-chat mock** (real Zalo/Messenger webhooks
  are API routes, stubbed until channel approval).
- **Data:** Supabase — menu catalog. Schema prefix `kfc_`.
- **Voice:** Web Speech / voice-note transcription (stub → Whisper later).

## Env
`AI_GATEWAY_API_KEY`, Supabase vars. Later: `ZALO_OA_TOKEN`, `MESSENGER_TOKEN`, `OMS_URL`.

## Add these files
```
app/page.tsx                 # phone-style chat mock with rich item/price cards
app/api/agent/route.ts       # order state-machine agent
app/api/webhook/zalo/route.ts     # stub: verify + forward to agent (for later)
app/api/webhook/messenger/route.ts# stub
lib/order.ts                 # typed Order state machine + cart math
lib/menu.ts                  # search_menu against catalog (NO hallucinated prices)
lib/oms.ts                   # mock OMS + Loyalty + voucher clients (swappable)
db/schema.sql                # kfc_menu, kfc_combos, kfc_vouchers
db/seed.ts                   # seed a realistic KFC VN menu
```

## Agent tools
- `search_menu(query)` → validated items/combos/prices (source of truth)
- `add_to_cart(item, mods, qty)` → mutates `Order`, recomputes total
- `apply_voucher(code)` → validate + apply (mock OMS)
- `check_loyalty(customerId)` → points balance + redeem options (mock)
- `quote_order()` → fulfillment + fees + ETA
- `request_otp()` / `verify_otp()` → secure confirm before "payment"
- `place_order(Order)` → mock OMS create → returns order #
- `handoff_to_human(reason)` → escalation w/ transcript summary

**Guardrail (unit-test it):** reject any cart line without a `search_menu` match.

## Mock
`lib/oms.ts` returns canned OMS/Loyalty/voucher responses so the flow completes with
zero external APIs. The agent's per-turn JSON contract `{say, order_state, next_action}`
is the integration boundary — keep it clean for the real OMS later.

## Eval
~30 scripted intents (incl. Vietnamese, code-switched) → **order completion rate**,
**NLU accuracy**, **voucher success**, **handoff fired correctly**. Print a headline.

## Deploy
Vercel, Root Directory `kfc-conversational-ordering`. Green on web-chat + mock OMS.

## Done when
Voice/text → cart with cards → voucher + loyalty applied → OTP → order # returned,
all in-chat; a handoff path works; eval prints a number.
