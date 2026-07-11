# PRD — Project COLONEL (implementation spec v2)
## The KFC ordering agent that learns you

**Event:** Agentic AI Build Week 2026 · HCMC · Jul 8–12
**Submission vehicle:** this repo folder — `kfc-conversational-ordering/` (KFC P4, F&B track)
**Absorbs:** the recommendation engine from `../kfc-kiosk-recommendations/` (as agent tools, not a second entry)
**Status:** v2 · 2026-07-04 · written against the code as of commit `08d5ce7`
> **DELIVERED (same day):** WP-0–9 built and merged (`44d414c`–`27708a7`), keyless gate green,
> Suite 3 printed +9.6pp lift. Post-delivery pass (`38d5b9f`–`c9c5cc8`) fixed the Suite 2 voucher
> eval cases, rebuilt the demo stage UI, and shipped stateful channel conversations + real
> Messenger/Zalo send APIs (beyond §16 — approved separately). Current status lives in
> [`README.md`](../README.md).
**Audience:** a coding agent (Codex) building this unattended. Every section is a work order.

**One-liner:** A chat agent that places real orders end-to-end, upsells from a mined co-purchase
model blended with per-customer taste memory, optimizes your bill, survives out-of-stock, and
proves its learning with a held-out eval number.

---

## 0. Hard constraints — read before writing any code

1. **Do NOT upgrade `ai` past v5.** `package.json` pins `"ai": "^5.0.0"` + `"@ai-sdk/react": "^2.0.0"`.
   v6 breaks the `@ai-sdk/react` hooks used by `app/page.tsx`. All new tools use the existing
   `tool()` + `zod` pattern from `lib/agent.ts`.
2. **Keyless-green is non-negotiable.** `npm install && npm run build && npm test && npm run eval`
   must exit 0 with **no env vars set**. Anything touching an LLM or Supabase must be gated exactly
   like the existing patterns: Suite 2 skips cleanly without `AI_GATEWAY_API_KEY`
   (see `eval/run.ts`), `searchMenuGrounded` falls back to memory without Supabase env
   (see `lib/menu.ts:410`).
3. **Never trust the client.** All new cart mutations go through the guardrail path
   (`addToCart` / `revalidateOrder` in `lib/order.ts`). New server-side state (profiles, swap
   proposals, OOS flags) lives server-side; the client only sends IDs.
4. **All money is integer VND** (`priceVnd`, `totalVnd`, ...). Format only via `formatVnd`
   (`lib/menu.ts:281`). Never float arithmetic on money.
5. **Determinism where keyless:** every non-LLM feature (suggestions, combo math, cravings,
   Suite 3 eval) must be seeded/deterministic so evals are reproducible. Reuse `seededRandom`
   (port from `../kfc-kiosk-recommendations/lib/pos-sim.ts:170`).
6. **Don't break what exists.** The 30 cases in `eval/cases.jsonl` and `tests/order.test.ts`
   must keep passing. Extend `eval/run.ts`; don't rewrite it.
7. Dev machine is Windows; keep scripts cross-platform (`tsx`, no bash-isms in npm scripts).

## 1. Current-state inventory (what you're building on — verified exports)

### This repo (`kfc-conversational-ordering/`)

| File | What's there (do not re-implement) |
|---|---|
| `lib/menu.ts` | `MENU_CATALOG: MenuItem[]` (15 items, listed §2.1), `MenuItem {id, sku, name, vietnameseName, category, description, priceVnd, tags, options, available, popular?}`, `searchMenu(query, limit=6)`, `searchMenuGrounded` (Supabase w/ memory fallback), `getCatalogEntry`, `getMenuOption`, `createMatchId(id)` = `` `search_menu:${CATALOG_VERSION}:${id}` ``, `normalizeText` (diacritic-stripping — reuse for Vietnamese matching), `formatVnd`, `toMenuMatch`, `CATALOG_VERSION` |
| `lib/order.ts` | Typed `Order` state machine: `createOrder`, `addToCart` (guardrails: `CartGuardrailError` w/ `GuardrailCode`), `calculateTotals` (voucher rule recompute + loyalty + FREESHIP), `repriceOrder`, `setVoucher/setLoyalty/setQuote/setOtpRequested/setOtpVerified/setPlacedOrder/setHandoff`, `compactOrderState`, `revalidateOrder` (rebuilds every line from catalog), `summarizeOrder`. `Order.customerId?: string` exists but is never set — you will wire it. |
| `lib/agent.ts` | `createAgentRuntime({sessionKey, initialOrder?, transcriptSummary?})` → `{order, tools, system}`. 9 tools: `search_menu, add_to_cart, apply_voucher, check_loyalty, quote_order, request_otp, verify_otp, place_order, handoff_to_human`. `recordToolError` auto-handoffs after `TOOL_ERROR_HANDOFF_THRESHOLD = 2` failures. `SYSTEM` prompt string. |
| `lib/oms.ts` | `applyVoucher`, `checkLoyalty(customerId, redeem)`, `quoteOrder`, `placeOrder(order, paymentMethod, otpVerified)` (refuses without server OTP flag), `createHumanHandoff`, `availableVoucherCodes` |
| `lib/otp.ts` | `otpProvider: {request(sessionKey, phone), verify(sessionKey, code), isVerified(sessionKey)}` — in-memory, random 6-digit, TTL, attempt cap, `OTP_EXPOSE_DEV_CODE=1` for evals |
| `lib/channel.ts` | Messenger/Zalo signature verification + message extraction + `forwardToAgent` |
| `lib/supabase.ts` | `supabaseAdmin()` — server-only client factory |
| `lib/ai.ts` | `AGENT_MODEL` (AI Gateway model ref) |
| `app/api/agent/route.ts` | `POST` handler: parses `{messages: UIMessage[]}`, `extractOrder` from tool-output parts → `revalidateOrder` → `createAgentRuntime` → `streamText({model, system, messages, tools, stopWhen: stepCountIs(10)})` → `toUIMessageStreamResponse()`. `sessionKeyFor` = first message id. `maxDuration = 60`. |
| `app/page.tsx` | 305-line web chat (Zalo/Messenger mock) using `@ai-sdk/react` `useChat` |
| `db/schema.sql` | `kfc_menu`, `kfc_combos`, `kfc_vouchers`, `kfc_orders`, `kfc_order_events` + RLS (menu/combos public-read; rest server-only) |
| `eval/run.ts` (261 lines) | Suite 1 (deterministic lib + intent regex, 30 cases from `eval/cases.jsonl`, fields `{id, input, intent, expect_item?, voucher?}`) + Suite 2 (real agent via `AI_GATEWAY_API_KEY`, skips clean when absent) |
| `tests/order.test.ts` | State-machine unit tests, run by `npm test` |

### Donor project (`../kfc-kiosk-recommendations/lib/` — port, adapting IDs)

| File | Ports as | Notes |
|---|---|---|
| `affinity.ts` | `lib/reco/affinity.ts` | Port **verbatim** (self-contained: `mineAffinityRules(orders, isCombo, {minSampleOrders=5, topN=80})` → `AffinityRule {from, to, kind, support, confidence, lift, sampleOrders}`). Only change: import `PosOrder` from the new pos-sim. |
| `context.ts` | `lib/reco/context.ts` | Port verbatim: `WeatherSignal ("clear"|"rainy")`, `Daypart`, `KioskContext {storeId?, hour, dayOfWeek, weather, promo?}`, `getDaypart`, `normalizeContext`. Rename `KioskContext` → export alias `OrderContext`. |
| `pos-sim.ts` | `lib/reco/pos-sim.ts` | **Rewrite the item universe** onto THIS repo's catalog IDs (§4.2) and add per-customer personas (§4.3). Keep the architecture: hand-authored propensity model, independent of any recommender, `seededRandom` LCG. |
| `reco.ts` | **not ported** | Its `MENU_ITEMS` and scorer are kiosk-specific. The new scorer is `lib/reco/suggest.ts` (§5). Steal only the *silence discipline* concept. |

## 2. Catalog groundwork

### 2.1 Existing catalog IDs (source of truth for every spec below)

`fried-chicken-1pc` 39k · `fried-chicken-2pc` 76k · `hot-wings-3pc` 49k · `boneless-chicken` 59k ·
`zinger-burger` 65k · `shrimp-burger` 69k · `rice-chicken-teriyaki` 59k · `spaghetti-chicken` 49k ·
`combo-classic` 89k · `combo-zinger` 99k · `combo-family-4` 329k · `combo-party-6` 499k ·
`fries-regular` 29k · `egg-tart` 19k · `pepsi-medium` 19k · `aquafina` 15k

### 2.2 WP-1 (first change): add 3 items to `MENU_CATALOG` in `lib/menu.ts`

Needed by the rainy-day demo beat and craving translator. Follow the existing object shape exactly
(sku series continues at 017):

```ts
{ id: "corn-soup", sku: "KFCVN-SID-017", name: "Warm Corn Soup", vietnameseName: "sup bap",
  category: "side", description: "Hot creamy corn soup cup.", priceVnd: 25000,
  tags: ["soup", "sup", "bap", "warm", "corn"], options: [], available: true },
{ id: "coleslaw", sku: "KFCVN-SID-018", name: "Coleslaw", vietnameseName: "salad bap cai",
  category: "side", description: "Chilled cabbage salad.", priceVnd: 25000,
  tags: ["salad", "coleslaw", "bap cai", "fresh", "light"], options: [], available: true },
{ id: "milo-cup", sku: "KFCVN-DRK-019", name: "Milo", vietnameseName: "milo",
  category: "drink", description: "Iced chocolate malt drink.", priceVnd: 25000,
  tags: ["milo", "chocolate", "kids", "sweet", "drink"], options: [], available: true },
```

Also mirror them into `db/seed.ts` (it mirrors `MENU_CATALOG` — keep them in sync or validation
breaks when Supabase is enabled).

## 3. Architecture delta (target state)

```
app/page.tsx  ── persona picker · weather toggle · suggestion chips · tool trace · "return visit"
   │  POST {messages, customerId, context:{weather, hour}}
   ▼
app/api/agent/route.ts  (existing streamText loop, stepCountIs(10) → raise to 12)
   ├─ existing 9 tools (unchanged)
   ├─ suggest_addons            → lib/reco/suggest.ts   (mined rules ⊕ taste profile ⊕ context)
   ├─ optimize_bill             → lib/combos.ts          (deterministic bill search, proposal token)
   ├─ accept_bill_swap          → lib/combos.ts          (applies proposal server-side)
   ├─ update_cart_line          → lib/order.ts           (qty change / remove, guardrailed)
   ├─ interpret_craving         → lib/cravings.ts        (keyless attribute matching + budget parse)
   └─ get_customer_profile      → lib/profile.ts         (taste memory read)
   │
   ├─ lib/history-store.ts  — HistoryStore interface: InMemory (default) / Supabase (env-gated)
   ├─ lib/demo.ts           — OOS injection (demo-only)
   └─ app/api/feedback/route.ts — records suggestion accept/decline
eval/run.ts  = Suite 1 (extended) + Suite 2 (extended, key-gated) + Suite 3 (NEW, keyless: personalization lift)
```

Build order = WP numbers. Each WP ends with the repo green (`build`, `test`, `eval`).

---

## WP-0 · Baseline & plumbing (½ day equivalent — do first)

**0a.** Run `npm install && npm run build && npm test && npm run eval`. Record output. If anything
is red before you change a line, stop and report.

**0b. `customerId` + context plumbing.**
- `app/api/agent/route.ts`: accept body `{messages, customerId?, context?}` where
  `context = {weather?: "clear"|"rainy", hour?: number}`. Validate with zod
  (`customerId: z.string().regex(/^[a-z0-9_-]{1,40}$/).optional()`); default `customerId = "guest"`,
  default context = `{weather: "clear", hour: new Date().getHours()}`.
- Thread both into `createAgentRuntime` via new options fields `customerId: string`,
  `orderContext: OrderContext`. Set `order.customerId = customerId` on the sanitized initial order.
- `check_loyalty` tool: change `customerId` input default from `"demo-customer"` to
  `ctx.customerId`.
- `app/page.tsx`: send `customerId` + `context` in the `useChat` request body (v5 `useChat` supports
  a `body`/`prepareSendMessagesRequest`-style option — use whichever this installed minor exposes;
  verify against `node_modules/@ai-sdk/react`).

**0c. Raise `stopWhen: stepCountIs(10)` → `stepCountIs(12)`** in the route (the new
suggest/optimize steps lengthen happy-path tool chains).

**Acceptance WP-0:** build/test/eval green; a chat request with `customerId: "linh"` produces
`order.customerId === "linh"` inside tool payloads (assert via a quick tsx script or test).

---

## WP-1 · Port the reco engine (`lib/reco/`)

### 4.1 Files

- `lib/reco/context.ts` — port from donor, re-export `KioskContext` as `OrderContext`.
- `lib/reco/affinity.ts` — port verbatim.
- `lib/reco/pos-sim.ts` — rewrite per below.

### 4.2 `lib/reco/pos-sim.ts` — demand model over THIS catalog

Types:

```ts
export type PosLine = { itemId: string; quantity: number };
export type PosOrder = { id: string; customerId: string; seq: number; context: OrderContext; lines: PosLine[] };
export function seededRandom(seed: number): () => number  // port the LCG verbatim
```

Hand-authored world model (these exact numbers — they are the "ground truth" the engine never
sees; do not tune them to make the engine look good):

```ts
// Which primary a walk-in starts with, by daypart (uniform pick within pool):
const PRIMARY_POOL: Record<Daypart, string[]> = {
  breakfast: ["zinger-burger", "rice-chicken-teriyaki", "spaghetti-chicken"],
  lunch:     ["zinger-burger", "fried-chicken-2pc", "rice-chicken-teriyaki", "combo-zinger"],
  afternoon: ["hot-wings-3pc", "zinger-burger", "boneless-chicken", "fried-chicken-1pc"],
  evening:   ["fried-chicken-2pc", "combo-family-4", "zinger-burger", "combo-classic"],
};

// P(attach X | primary Y), neutral context:
const ATTACH_BASE: Record<string, Record<string, number>> = {
  "zinger-burger":        { "fries-regular": 0.42, "pepsi-medium": 0.38, "corn-soup": 0.08, "egg-tart": 0.10, "coleslaw": 0.07, "hot-wings-3pc": 0.09 },
  "fried-chicken-1pc":    { "fries-regular": 0.35, "pepsi-medium": 0.33, "corn-soup": 0.10, "coleslaw": 0.12, "egg-tart": 0.08 },
  "fried-chicken-2pc":    { "fries-regular": 0.40, "pepsi-medium": 0.36, "corn-soup": 0.11, "coleslaw": 0.10, "egg-tart": 0.09, "milo-cup": 0.06 },
  "hot-wings-3pc":        { "pepsi-medium": 0.44, "fries-regular": 0.30, "aquafina": 0.10, "egg-tart": 0.07 },
  "boneless-chicken":     { "pepsi-medium": 0.35, "fries-regular": 0.32, "milo-cup": 0.14, "egg-tart": 0.12 },
  "shrimp-burger":        { "fries-regular": 0.38, "pepsi-medium": 0.34, "coleslaw": 0.11 },
  "rice-chicken-teriyaki":{ "aquafina": 0.22, "pepsi-medium": 0.25, "corn-soup": 0.14, "egg-tart": 0.08 },
  "spaghetti-chicken":    { "milo-cup": 0.20, "pepsi-medium": 0.24, "egg-tart": 0.14, "fries-regular": 0.18 },
  "combo-classic":        { "egg-tart": 0.12, "corn-soup": 0.08, "hot-wings-3pc": 0.07 },
  "combo-zinger":         { "egg-tart": 0.11, "corn-soup": 0.07, "hot-wings-3pc": 0.08 },
  "combo-family-4":       { "egg-tart": 0.18, "milo-cup": 0.15, "corn-soup": 0.12, "coleslaw": 0.10 },
  "combo-party-6":        { "egg-tart": 0.20, "milo-cup": 0.16, "aquafina": 0.14 },
};

// Context modifiers (multiplicative on attach probability):
//   rainy:   corn-soup ×2.2 · milo-cup ×1.3 · pepsi-medium ×0.75 · coleslaw ×0.6
//   evening: egg-tart ×1.3 · combo attachments ×1.15
//   lunch:   aquafina ×1.2
// Clamp every final probability to [0, 0.85].
```

Generators:

```ts
export function generatePosOrders(orderCount: number, seed: number): PosOrder[]
// anonymous walk-ins (customerId "walkin", seq 0): draw daypart (breakfast .1, lunch .35,
// afternoon .2, evening .35), weather (rainy .3), primary from pool, then each ATTACH_BASE entry
// independently vs modified probability. 1–2 quantity on drink/side at p=0.15 for qty 2.
```

### 4.3 Per-customer personas (feeds Taste Memory + Suite 3)

```ts
export type Persona = {
  customerId: string;
  favoritePrimary: string;      // sampled from all primaries
  primaryLoyalty: number;       // U(0.55, 0.9) — P(order favorite | any visit)
  attachMultiplier: Record<string, number>; // per attachable item, lognormal-ish: exp(N(0,0.7)) clamped [0.25, 3.0] — approximate N(0,1) as sum of 12 U(0,1) minus 6
  spicePreference: "spicy" | "original" | "none";  // p = .35/.4/.25 — spicy personas add optionIds ["spice-spicy"] on chicken lines
  rainySoupBoost: number;       // U(1.0, 3.0) extra corn-soup multiplier when rainy
};
export function generatePersona(customerId: string, seed: number): Persona
export function generateCustomerHistory(persona: Persona, orderCount: number, seed: number): PosOrder[]
// seq 1..orderCount; context drawn per order; primary = favorite w.p. primaryLoyalty else pool draw;
// attach prob = clamp(ATTACH_BASE × contextMod × attachMultiplier[item] × (rainy ? rainySoupBoost for corn-soup : 1), 0, 0.9)
```

**Acceptance WP-1:** a scratch tsx script mines rules from `generatePosOrders(4000, 1401)` via
`mineAffinityRules(orders, id => id.startsWith("combo-"))` and prints ≥ 20 rules;
`fries-regular` and `pepsi-medium` appear as top consequents of `zinger-burger`. Deterministic
across two runs.

---

## WP-2 · Taste Memory (`lib/history-store.ts`, `lib/profile.ts`, schema)

### 5.1 `lib/history-store.ts`

```ts
export type CompletedOrderRecord = {
  customerId: string; orderId: string; placedAt: string;
  context: OrderContext;
  lines: Array<{ catalogId: string; quantity: number; optionIds: string[] }>;
  totalVnd: number;
};
export type SuggestionEvent = {
  customerId: string; catalogId: string; action: "accepted" | "declined"; at: string;
};
export interface HistoryStore {
  recordOrder(rec: CompletedOrderRecord): Promise<void>;
  recordSuggestion(ev: SuggestionEvent): Promise<void>;
  getOrders(customerId: string, limit?: number): Promise<CompletedOrderRecord[]>;   // newest first
  getSuggestions(customerId: string, limit?: number): Promise<SuggestionEvent[]>;
}
export function getHistoryStore(): HistoryStore
// Supabase impl iff SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY are set, else module-level
// InMemoryHistoryStore (Map<customerId, ...>) — same pattern as searchMenuGrounded.
// The in-memory store must also expose a reset() for evals (export resetInMemoryHistory()).
```

Wire the **write**: in `lib/agent.ts` `place_order` tool `execute`, after a successful
`placeOrder`, `await getHistoryStore().recordOrder(...)` built from the order + `ctx.orderContext`
+ `ctx.customerId`. Never let a store failure fail the tool: wrap in try/catch, log, continue.

### 5.2 `lib/profile.ts` — derived, never stored (honest + no staleness)

```ts
export type TasteProfile = {
  customerId: string;
  orderCount: number;
  usual: { catalogId: string; optionIds: string[]; share: number } | null;  // modal primary (category chicken/burger/rice/combo) with its modal options; share = freq/orderCount; null if orderCount < 2 or share < 0.4
  attachRates: Record<string, number>;      // item → (times attached + 1) / (orderCount + 2)   [Laplace]
  spice: "spicy" | "original" | null;       // modal spice option across chicken/burger lines, null if < 2 observations
  declinedRecently: string[];               // catalogIds with ≥ 2 "declined" events within the customer's last 5 orders' timespan
  avgTicketVnd: number;
};
export async function deriveProfile(customerId: string): Promise<TasteProfile>
export function deriveProfileFromRecords(orders: CompletedOrderRecord[], suggestions: SuggestionEvent[], customerId: string): TasteProfile  // pure, for Suite 3
```

### 5.3 Schema additions — append to `db/schema.sql`

```sql
create table if not exists public.kfc_customer_history (
  id bigint generated always as identity primary key,
  customer_id text not null,
  order_id text not null,
  context jsonb not null default '{}'::jsonb,
  lines jsonb not null,
  total_vnd integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists kfc_customer_history_idx on public.kfc_customer_history (customer_id, created_at desc);

create table if not exists public.kfc_suggestion_events (
  id bigint generated always as identity primary key,
  customer_id text not null,
  catalog_id text not null,
  action text not null check (action in ('accepted', 'declined')),
  created_at timestamptz not null default now()
);
create index if not exists kfc_suggestion_events_idx on public.kfc_suggestion_events (customer_id, created_at desc);

alter table public.kfc_customer_history enable row level security;
alter table public.kfc_suggestion_events enable row level security;
-- server-only: no anon/authenticated policies (same stance as kfc_orders).
```

### 5.4 Feedback endpoint — `app/api/feedback/route.ts`

`POST {customerId, catalogId, action: "accepted"|"declined"}`, zod-validated (same customerId
regex as WP-0; catalogId must resolve via `getCatalogEntry` or 400). Calls
`recordSuggestion`. Returns `{ok: true}`.

**Acceptance WP-2:** unit test in `tests/profile.test.ts` (add to `npm test` chain — make `test`
script `tsx tests/order.test.ts && tsx tests/profile.test.ts`): feed 6 synthetic records where
4/6 primaries are `zinger-burger` w/ `spice-spicy` → `usual.catalogId === "zinger-burger"`,
`spice === "spicy"`; 2 declines on `corn-soup` → `declinedRecently` contains it.

---

## WP-3 · `suggest_addons` (`lib/reco/suggest.ts` + tool)

### 6.1 Engine

```ts
export type Suggestion = {
  catalogId: string; name: string; priceVnd: number; displayPrice: string;
  reason: string;                    // one sentence, human, cites the actual signal
  source: "global" | "personal" | "blended";
  score: number;                     // final blended score, 4 dp
};
export type SuggestResult = { decision: "suggest" | "silent"; suggestion: Suggestion | null; debug: {...} };
export function suggestAddons(
  cart: Array<{ catalogId: string; quantity: number }>,
  context: OrderContext,
  profile: TasteProfile | null,
): SuggestResult
```

Rules mined **once at module load** (off request path, donor pattern):
`const RULES = mineAffinityRules(generatePosOrders(4000, TRAIN_SEED /* = 1401 */), id => id.startsWith("combo-"), { minSampleOrders: 8, topN: 60 })`.

**Scoring — implement exactly:**
- Candidates: every `AffinityRule` whose `from` is in the cart and whose `to` is NOT in the cart,
  is `available`, and is category `side|drink|dessert` or `hot-wings-3pc`. Plus every profile
  `attachRates` key not in cart (same availability filter).
- `global(c) = max over matching rules of: rule.confidence × min(rule.lift, 3) / 3` (0 if no rule).
- `personal(c) = profile ? profile.attachRates[c] ?? 1/(profile.orderCount + 2) : 0`.
- `wP = profile ? min(0.65, profile.orderCount / (profile.orderCount + 4)) : 0`.
- `contextMult(c)`: rainy → `corn-soup` ×1.6, `milo-cup` ×1.15, `pepsi-medium|aquafina` ×0.8,
  `coleslaw` ×0.7; `getDaypart(hour) === "evening"` → `egg-tart` ×1.25. Else 1.
- `rejectMult(c)`: c ∈ `profile.declinedRecently` → 0 (hard suppress); else if ≥1 decline ever → 0.5.
- `score(c) = ((1 − wP)·global + wP·personal) × contextMult × rejectMult`.
- **Silence discipline** (return `decision: "silent"`, `suggestion: null`) when ANY of:
  cart empty · cart already covers a main/combo AND a side AND a drink · top score < 0.08 ·
  order stage ∈ `otp_requested|confirmed|placed|handoff`.
- Return only the **top 1** (chat ≠ kiosk: one suggestion max).
- `reason` templates (fill with real numbers): global → `"X% of orders with {from} add {to}."`
  (confidence as integer %); personal → `"You've added {to} in {n} of your last {m} orders."`;
  rainy corn-soup → append `" It's raining — warm add-ons over-index today."`.

### 6.2 Tool (add in `lib/agent.ts` `buildTools`)

```ts
suggest_addons: tool({
  description: "Suggest at most one add-on for the current cart, from mined co-purchase rules blended with this customer's taste profile. Call after add_to_cart. Respect decision:'silent' — do not invent a suggestion.",
  inputSchema: z.object({}),
  execute: async () => {
    const profile = await deriveProfile(ctx.customerId).catch(() => null);
    const result = suggestAddons(ctx.getOrder().cart.map(l => ({catalogId: l.catalogId, quantity: l.quantity})), ctx.orderContext, profile);
    return payload({ ok: true, ...result });
  },
}),
```

**Acceptance WP-3:** unit test `tests/suggest.test.ts`: (a) cart `[zinger-burger]`, clear noon, no
profile → suggests `fries-regular` or `pepsi-medium`; (b) same but rainy → `corn-soup` in top spot
(if not, the context multiplier or ATTACH_BASE is mis-wired — fix the engine, not the test);
(c) profile with 2 recent `corn-soup` declines → never `corn-soup`; (d) cart
`[combo-zinger, fries-regular, pepsi-medium]` → `silent`.

---

## WP-4 · Combo Math (`lib/combos.ts` + 3 tools)

### 7.1 Contents map (code is source of truth; mirror into `db/seed.ts` combos rows)

```ts
export type ComboSlot = { accepts: string[]; };  // catalogIds; first = canonical
export const COMBO_CONTENTS: Record<string, ComboSlot[]> = {
  "combo-classic":  [{accepts:["fried-chicken-2pc"]}, {accepts:["fries-regular"]}, {accepts:["pepsi-medium","aquafina","milo-cup"]}],
  "combo-zinger":   [{accepts:["zinger-burger"]}, {accepts:["fries-regular"]}, {accepts:["pepsi-medium","aquafina","milo-cup"]}],
  "combo-family-4": [{accepts:["fried-chicken-2pc"]},{accepts:["fried-chicken-2pc"]},{accepts:["fried-chicken-2pc"]}, {accepts:["fries-regular"]},{accepts:["fries-regular"]}, {accepts:["pepsi-medium","aquafina","milo-cup"]},{accepts:["pepsi-medium","aquafina","milo-cup"]},{accepts:["pepsi-medium","aquafina","milo-cup"]},{accepts:["pepsi-medium","aquafina","milo-cup"]}],
  "combo-party-6":  [/* 5× fried-chicken-2pc, 3× fries-regular, 6× drink slots, same pattern */],
};
```

(Sanity: combo-classic 89k vs 76+29+19 = 124k à la carte → saves 35k. combo-zinger 99k vs 113k →
14k. Verify family-4 329k vs 3×76 + 2×29 + 4×19 = 362k → 33k; party-6 499k vs 5×76+3×29+6×19 = 581k → 82k.)

### 7.2 Optimizer

```ts
export type BillProposal = {
  swapId: string;               // makeId-style token
  savingsVnd: number; displaySavings: string;
  addCombos: Array<{ catalogId: string; quantity: number }>;
  consumeLines: Array<{ lineId: string; units: number }>;   // à-la-carte units absorbed
  bonusItems: Array<{ catalogId: string; name: string }>;   // combo slots not matched by cart (free upside)
  summary: string;              // human sentence for the agent to relay
};
export function optimizeBill(order: Order): BillProposal | null
export function takeProposal(swapId: string): BillProposal | undefined  // one-shot registry read
export function applyProposal(order: Order, p: BillProposal): Order     // pure; uses addToCart/updateCartLine internally
```

Algorithm (cart sizes are tiny — exhaustive is fine and must be deterministic):
1. Build a unit multiset from cart lines that are: not combos already, `available`, and have **no
   paid options** (`options.every(o => o.priceDeltaVnd === 0)`) — lines with paid options are never
   consumed (customizations must survive). Free options (spice, drink flavor) are carried into the
   summary note.
2. DFS over combo counts: for each combo type `q ∈ 0..3` (order types descending price). For a
   combo instance, greedily match each slot against the remaining multiset (`accepts` order);
   unmatched slots become `bonusItems`. Require `matchedUnits ≥ 2` per instance, else prune.
3. Candidate price = Σ combo `priceVnd` + Σ remaining units à la carte. Keep the cheapest.
4. Proposal only if `savingsVnd ≥ 5000`. Store in a module `Map<swapId, {proposal, expires}>`
   (TTL 10 min, sweep on access). Return `null` otherwise.
5. `applyProposal`: decrement/remove consumed lines via `updateCartLine`, then `addToCart` each
   combo with `createMatchId(comboId)` + `source: "search_menu"` (server-constructed, guardrails
   still run). Recompute happens inside those helpers. **Voucher/loyalty survive automatically**
   (`calculateTotals` recomputes from rules).

### 7.3 `updateCartLine` — add to `lib/order.ts`

```ts
export function updateCartLine(order: Order, lineId: string, quantity: number): Order
// quantity 0 → remove line. 1..20 → set + reprice. Unknown lineId → CartGuardrailError("unknown_catalog_item" — add new code "unknown_cart_line" to GuardrailCode instead).
```

### 7.4 Tools (in `buildTools`)

- `update_cart_line`: input `{lineId: z.string(), quantity: z.number().int().min(0).max(20)}` —
  wraps `updateCartLine`, `CartGuardrailError` → `recordToolError` + `ok:false` (mirror
  `add_to_cart`'s catch shape).
- `optimize_bill`: input `{}` — runs `optimizeBill(ctx.getOrder())`; returns
  `payload({ok: true, proposal})` (proposal may be null → the agent says the cart is already optimal
  **only if asked**; never volunteers "no savings").
- `accept_bill_swap`: input `{swapId: z.string()}` — `takeProposal`; missing/expired →
  `ok:false, code:"swap_expired"` (+ `recordToolError`); else `ctx.setOrder(applyProposal(...))`.

**Acceptance WP-4:** `tests/combos.test.ts`: cart `[zinger-burger, fries-regular, pepsi-medium]`
→ proposal swaps to `combo-zinger`, `savingsVnd === 14000`, no bonus items; cart
`[fried-chicken-2pc ×3, fries-regular ×2, pepsi-medium ×4]` → `combo-family-4`, savings 33000;
cart `[zinger-burger (extra-cheese)]` + fries + pepsi → zinger line NOT consumed (paid option),
proposal is null (only 2 consumable units but no combo covers fries+pepsi alone at ≥5k savings);
applying a proposal then `calculateTotals` keeps a previously applied `KFC20` voucher discount > 0.

---

## WP-5 · Craving Translator (`lib/cravings.ts` + tool) — keyless, deterministic

### 8.1 Attribute vectors (author exactly; axes all 0..1)

Axes: `crispy, spicy, light, heavy, warm, refreshing, sweet, shareable, kids`.

```
fried-chicken-1pc:  crispy .9  spicy .4* heavy .5 warm .8            (*base; "original")
fried-chicken-2pc:  crispy .9  spicy .4  heavy .7 warm .8 shareable .3
hot-wings-3pc:      crispy .8  spicy .9  heavy .4 warm .8
boneless-chicken:   crispy .8  spicy .3  heavy .4 warm .7 kids .7
zinger-burger:      crispy .7  spicy .8  heavy .6 warm .7
shrimp-burger:      crispy .6  spicy .2  heavy .5 warm .7
rice-chicken-teriyaki: heavy .6 warm .8 light .3 sweet .2
spaghetti-chicken:  heavy .5 warm .8 kids .8 sweet .3
combo-classic/zinger: inherit main + heavy +.2, shareable .2
combo-family-4:     heavy .8 warm .8 shareable 1.0
combo-party-6:      heavy .9 warm .8 shareable 1.0
fries-regular:      crispy .8 light .3 warm .6 kids .6
corn-soup:          warm 1.0 light .7 sweet .3
coleslaw:           refreshing .9 light .9
egg-tart:           sweet .9 warm .5 light .5 kids .5
pepsi-medium:       refreshing .8 sweet .6
milo-cup:           refreshing .6 sweet .9 kids .9
aquafina:           refreshing .9 light 1.0
```

### 8.2 Lexicon (match on `normalizeText(query)` — diacritics already stripped)

```
crispy:  gion, gion rum, crispy, crunchy        spicy: cay, spicy, hot
light:   nhe, thanh, khong dau mo, light, not heavy, healthy
heavy:   no, chac bung, filling, hungry, doi    warm: am, nong, soup, sup, warm
refreshing: mat, giai khat, refreshing, thirsty, khat
sweet:   ngot, sweet, trang mieng, dessert      shareable: nhom, chia se, share, party, ban be
kids:    tre em, cho be, kids, con
Negations: "khong X" / "not X" / "no X" → axis weight −1 instead of +1 (e.g. "khong cay").
Budget:  /(?:duoi|toi da|under|below|<)\s*(\d{2,3})\s*k/  and  /(\d{2,3})\s*k(?:\s|$)/ fallback → budgetVnd = n×1000
```

### 8.3 Scoring + tool

`queryVec` = sum of matched axis unit-vectors (negations subtract). Score(item) = Σ_axes
`queryVec[a] × itemVec[a]`; drop items with score ≤ 0 or `priceVnd > budgetVnd` (when budget
present); tie-break by `popular` then lower price. Return top 3 as `MenuMatch`-compatible objects
**via `toMenuMatch(getCatalogEntry(id), score)`** so `add_to_cart` matchIds stay valid.

```ts
interpret_craving: tool({
  description: "Map a vague craving ('gion gion cay cay, duoi 100k') to up to 3 real menu items with valid matchIds. Use when the user describes a mood/craving instead of a menu item. Results are add_to_cart-ready.",
  inputSchema: z.object({ craving: z.string().min(2) }),
  execute: async ({ craving }) => payload({ ok: true, ...interpretCraving(craving) }),
})
```

`interpretCraving` returns `{matches, budgetVnd, matchedAxes, unmatched: boolean}` — when no axis
matches, `unmatched: true` and the agent should fall back to `search_menu`.

**Acceptance WP-5:** `tests/cravings.test.ts`: `"gion gion cay cay dưới 100k"` → top-3 ⊆
{hot-wings-3pc, zinger-burger, fried-chicken-1pc/2pc}, all ≤ 100000, hot-wings or zinger first;
`"gì đó nhẹ nhẹ mát mát"` → coleslaw or aquafina first; `"khong cay"` never returns hot-wings first.

---

## WP-6 · Out-of-stock self-correction (`lib/demo.ts` + oms change)

### 9.1 `lib/demo.ts`

```ts
const oos = new Set<string>((process.env.OOS_DEMO_ITEMS ?? "").split(",").map(s => s.trim()).filter(Boolean));
export function isOutOfStock(catalogId: string): boolean;
export function setOutOfStock(ids: string[]): void;       // replaces set
export function clearOutOfStock(): void;
```

`app/api/demo/route.ts`: `POST {outOfStock: string[]}` → validates each via `getCatalogEntry`,
calls `setOutOfStock`. **Guard: enabled only when `process.env.DEMO_CONTROLS === "1"` or
`NODE_ENV !== "production"`; otherwise 404.** This is the stage-control for the demo beat.

### 9.2 `placeOrder` change (`lib/oms.ts`)

Before the existing OTP/emptiness checks pass through to success, check
`order.cart.filter(l => isOutOfStock(l.catalogId))`. If non-empty return:

```ts
{ ok: false, code: "item_out_of_stock",
  message: "Some items just went out of stock.",
  outOfStock: [{ catalogId, name }...],
  substitutes: /* for each OOS item: same-category, available, !isOutOfStock, |priceVnd − item.priceVnd| ≤ 15000, sorted by price distance, top 2, as toMenuMatch(...) so matchIds are valid */ }
```

### 9.3 Agent wiring

In the `place_order` tool catch-path: an `item_out_of_stock` failure must **NOT** call
`recordToolError` (it is a recoverable, scripted event — it must never burn the 2-strike handoff
budget). All other failures keep current behavior.

**System prompt** (append to `SYSTEM` in `lib/agent.ts` — verbatim, see §12 consolidated block).
Recovery contract: apologize briefly, present the provided substitutes (never re-search), on
user's pick call `update_cart_line` (qty 0 on the OOS line) then `add_to_cart` with the
substitute's matchId, re-run `quote_order` if a quote existed, then `place_order` again. OTP does
NOT need to be re-verified (same session flag).

**Acceptance WP-6:** `tests/oos.test.ts`: with `setOutOfStock(["pepsi-medium"])`, `placeOrder` on
a cart containing pepsi returns `ok:false, code:"item_out_of_stock"` with `milo-cup`/`aquafina`
among substitutes; after swap + re-place (with otpVerified true) → `ok:true`. `clearOutOfStock()`
in test teardown.

---

## WP-7 · `get_customer_profile` tool + return-visit greeting

```ts
get_customer_profile: tool({
  description: "Read this customer's taste profile (usual order, attach rates, spice preference). Call ONCE at the start of a conversation for a returning customer, and before composing any 'your usual?' offer.",
  inputSchema: z.object({}),
  execute: async () => {
    const profile = await deriveProfile(ctx.customerId).catch(() => null);
    return payload({ ok: true, profile, isReturning: (profile?.orderCount ?? 0) >= 1 });
  },
})
```

System-prompt contract (§12): for a returning customer with a non-null `usual`, the FIRST reply
of a conversation offers the usual (with spice preference and, when `suggest_addons` fires, the
remembered add-on) as a one-tap confirm — but composes it from tool data only, never from memory
of prior turns.

**Acceptance WP-7:** covered by Suite 2 case `return-visit-usual` (§11) and the manual demo script.

---

## WP-8 · Eval — Suite 3 (personalization lift, keyless) + Suite 1/2 extensions

### 11.1 Suite 3 — `eval/personalization.ts`, invoked from `eval/run.ts` (always runs; no keys)

Protocol (all seeds fixed constants at top of file):

```
TRAIN_SEED = 1401      (must equal suggest.ts RULES seed — export it from suggest.ts and import)
PERSONA_SEED = 7301    CONTEXT/HISTORY draws derive from PERSONA_SEED + customer index
CUSTOMERS = 60         ORDERS_PER_CUSTOMER = 10
```

1. For each customer i: `persona = generatePersona("evalcust_" + i, PERSONA_SEED + i)`,
   `history = generateCustomerHistory(persona, 10, PERSONA_SEED + 100 + i)`.
2. For each k in 0..8: take orders 1..k as known history → build
   `profile_k = deriveProfileFromRecords(historyRecords(1..k), [], customerId)` (convert PosOrder →
   CompletedOrderRecord; profile_0 = null). Target = order k+1. Skip targets whose lines are only
   the primary (no attachment to predict).
3. Prediction event: `suggestAddons([primary line of target], target.context, profile_k)` vs
   `suggestAddons(..., null)` (global baseline). A prediction **hits** if the suggested catalogId
   is among the target order's attached (non-primary) items. Silent predictions count as misses
   for both arms (they're rare on single-main carts).
4. Report (print exactly this block shape):

```
SUITE 3 — personalization lift (held-out, engine never saw these customers)
  events: <n>            (target: ≥ 800)
  precision@1 global:      <g>%
  precision@1 personalized:<p>%
  lift: +<p−g>pp
  by history size k: 0:<>% 1:<>% 2:<>% 3:<>% 4:<>% 5+:<>%   (personalized arm)
  AOV projection @ take-rate {12,20,28,34,40}%: <...>
```

5. **Hard assertions (exit 1 on failure):** events ≥ 800 · personalized ≥ global + 4.0pp ·
   personalized at k≥3 > personalized at k=0. If these fail, the blend weights/engine are wrong —
   tune `wP`/scoring (never the world model in pos-sim, never the seeds) until honest lift shows.
6. AOV projection: for hit events, uplift = suggested item's `priceVnd` × take-rate; report mean
   over all events at each take-rate in {.12, .20, .28, .34, .40}.

### 11.2 Suite 1 extensions (deterministic, in `eval/run.ts`)

Add assertion blocks (plain code, not JSONL cases): the four combo-math tests' scenarios; craving
top-1 checks (2 cases); silence discipline (complete cart → silent); rainy flip
(`zinger-burger` cart: clear → top ≠ corn-soup, rainy+profile-less → corn-soup suggested or
top-2 — assert the *flip changes the top suggestion*, mirroring the donor eval's context-flip
assertions).

### 11.3 Suite 2 extensions (agent-level, key-gated — same gating as existing)

Append to `eval/cases.jsonl` with a new optional field `"suite": "agent"` (Suite 1 must filter
`suite !== "agent"`; existing 30 cases have no `suite` field and keep running in both as today).
New cases (8):

```jsonl
{"id":"agent-craving-spicy","suite":"agent","input":"Thèm gì đó giòn giòn cay cay dưới 100k","intent":"craving","expect_tools":["interpret_craving"],"expect_item_any":["hot-wings-3pc","zinger-burger","fried-chicken-1pc","fried-chicken-2pc"]}
{"id":"agent-suggest-after-add","suite":"agent","input":"Cho mình 1 burger zinger","intent":"add_to_cart","expect_tools":["search_menu","add_to_cart","suggest_addons"]}
{"id":"agent-optimize-accept","suite":"agent","input":"(cart preloaded: zinger-burger, fries-regular, pepsi-medium) Xem giúp mình có cách nào rẻ hơn không","intent":"optimize","expect_tools":["optimize_bill"],"expect_savings_min":14000}
{"id":"agent-oos-recovery","suite":"agent","setup":{"oos":["pepsi-medium"]},"input":"(cart+OTP preloaded) Đặt hàng đi","intent":"place_order","expect_tools":["place_order","update_cart_line","add_to_cart","place_order"],"expect_final_stage":"placed"}
{"id":"agent-return-visit","suite":"agent","setup":{"historyOrders":3},"input":"Chào, đói quá","intent":"greeting","expect_tools":["get_customer_profile"],"expect_reply_mentions_usual":true}
{"id":"agent-decline-respected","suite":"agent","setup":{"declined":["corn-soup","corn-soup"]},"input":"Cho 1 gà rán 2 miếng","intent":"add_to_cart","forbid_suggestion":"corn-soup"}
{"id":"agent-voucher-after-swap","suite":"agent","input":"(cart preloaded + KFC20) Đổi sang combo rẻ hơn rồi báo tổng","intent":"optimize","expect_voucher_retained":"KFC20"}
{"id":"agent-budget-craving","suite":"agent","input":"something light, not spicy, under 30k","intent":"craving","expect_item_any":["coleslaw","corn-soup","aquafina","egg-tart","fries-regular"]}
```

Suite 2 runner: implement `setup` handling (preload cart via lib calls on the runtime's initial
order; `oos` via `setOutOfStock`; `historyOrders` via `generateCustomerHistory` → in-memory store;
`declined` via `recordSuggestion`). Assert `expect_tools` is a **subsequence** of observed tool
names (not exact-match — the model may interleave others). Reset in-memory stores +
`clearOutOfStock()` between cases.

**Acceptance WP-8:** keyless `npm run eval` prints Suite 1 (all green incl. new blocks) + Suite 2
`SKIPPED (no AI_GATEWAY_API_KEY)` + the full Suite 3 block with passing assertions, exit 0.

---

## WP-9 · UI (`app/page.tsx` — extend, don't rewrite)

Keep the existing chat + `useChat` wiring. Add (styling: match existing `globals.css` idiom;
plain CSS/inline is fine — this is a phone-framed demo, not a design contest):

1. **Persona bar** (top): select with `Linh (linh)`, `Mẹ Linh (linh_mom)`, `Khách (guest)` — value
   is the `customerId` sent in the request body — plus a 🌧️ **rain toggle** (context.weather) and
   an **hour slider or Day/Evening toggle** (context.hour: 12 / 19).
2. **"Khách quay lại" (return visit) button**: clears the chat/messages state (new conversation ⇒
   new sessionKey since it derives from first message id) but keeps `customerId` — this IS the
   demo's learning beat. Label it clearly.
3. **Suggestion chips**: when a `suggest_addons` tool part with `decision === "suggest"` streams
   in, render the suggestion as a chip under the message: item name + price + reason, with
   **[Thêm +]** → sends the message `"Thêm 1 {name}"` AND `POST /api/feedback {action:"accepted"}`;
   **[Không, cảm ơn]** → sends nothing to the model, posts `declined` feedback, dismisses chip.
4. **Bill-swap card**: when an `optimize_bill` tool part carries a non-null proposal, render
   savings + summary with **[Đổi luôn — tiết kiệm {displaySavings}]** → sends
   `"Đồng ý đổi combo (swap {swapId})"` (the model then calls `accept_bill_swap`).
5. **Tool-trace rail**: a collapsible side/bottom panel listing every tool part in order:
   `✓/✗ tool_name` + one-line summary (e.g. `suggest_addons → corn-soup (rainy +personal)`).
   Judges must SEE the loop think. Render from message parts (`part.type` starts with `tool-`),
   green/red by `output.ok`.
6. **OOS demo control**: tiny footer button (visible only when `NODE_ENV !== "production"` or
   `DEMO_CONTROLS === "1"`): "☠ Pepsi hết hàng" → `POST /api/demo {outOfStock:["pepsi-medium"]}`,
   toggling to "clear".

**Acceptance WP-9:** `npm run dev`; manually drive the §13 storyboard end-to-end (keyless mode:
tools still run — only the model needs the key, so this step requires `AI_GATEWAY_API_KEY`; note
it in the run report if unavailable, and verify chips/trace render from a mocked message fixture
in a component test or storybook-less harness if keyless).

---

## 12. System-prompt additions (`lib/agent.ts` `SYSTEM` — append verbatim)

```
Suggestions & taste memory:
- After add_to_cart succeeds, call suggest_addons once. If decision is "silent", say nothing about add-ons. If it returns a suggestion, offer it in one short sentence including the price and the reason. Never offer more than one add-on per turn, never invent one, and never re-offer an item the customer declined in this conversation.
- At the start of a conversation, call get_customer_profile. If isReturning and profile.usual exists, open by offering the usual (name + spice preference + total from search_menu pricing) as a one-tap confirm. Build the offer only from tool outputs.

Bill optimization:
- Before quote_order on carts with 2+ items, call optimize_bill. If it returns a proposal, offer the swap in one sentence stating the exact savings. Apply it only after the customer agrees, via accept_bill_swap with the proposal's swapId. If proposal is null, say nothing about optimization unless the customer asked.

Cravings:
- When the customer describes a mood or craving instead of a concrete item ("gì đó giòn giòn cay cay", "something light"), call interpret_craving, present up to 3 returned options with prices, and use their matchIds directly for add_to_cart. If it returns unmatched:true, fall back to search_menu.

Out-of-stock recovery:
- If place_order fails with item_out_of_stock: apologize in one short sentence, offer ONLY the substitutes provided in the tool result (with prices), and after the customer picks: update_cart_line the out-of-stock line to quantity 0, add_to_cart the substitute, re-run quote_order if a quote existed, then place_order again. Do not request a new OTP. Do not hand off for out-of-stock.
```

## 13. The 3-minute demo storyboard (expected tool sequences — dry-run against this)

| Beat | Operator does | Utterance | Expected tool sequence |
|---|---|---|---|
| 1 | persona=Linh, rain ON, hour=12 | "Cho mình 1 burger zinger" | `get_customer_profile` (guest-empty ok) → `search_menu` → `add_to_cart` → `suggest_addons` → offers **corn-soup, rainy reason** |
| 2 | tap **[Thêm +]**; then | "Áp mã KFC20, thêm 1 pepsi nữa" | `search_menu`→`add_to_cart`→`suggest_addons`(likely silent)→`apply_voucher` |
| 3 | — | "Xem có cách nào rẻ hơn không" | `optimize_bill` → proposal (zinger+fries+pepsi→combo-zinger, −14.000₫... fries not in cart? then beat 2 adds fries instead of soup-only: **operator: keep fries in script**) → tap swap card → `accept_bill_swap` |
| 4 | — | "Giao tới nhà, xác nhận đi" | `quote_order`→`request_otp`→(user sends code)→`verify_otp` |
| 5 | tap **☠ Pepsi hết hàng** first | "Đặt hàng" | `place_order` ✗ oos → substitutes → "7Up... Milo nhé?" → user: "Milo đi" → `update_cart_line`→`add_to_cart`→`place_order` ✓ order # |
| 6 | tap **Khách quay lại** | "Chào" | `get_customer_profile` → "Như mọi khi nhé? Zinger cay + Milo — trời vẫn mưa, thêm súp bắp như lần trước?" — **the beat that wins** |

Every beat's tool trace must be visible in the rail. Record a fallback capture of each beat.

## 14. Kill-questions (a judge or reviewer will ask these — the code must already answer)

1. "Is the suggestion really from mined data?" → point at `lib/reco/affinity.ts` mining
   `generatePosOrders(4000, 1401)` at module load; rules carry support/confidence/lift; the reason
   string quotes the real confidence.
2. "Is the learning real or a hardcoded demo?" → Suite 3 prints lift on 60 held-out synthetic
   customers the engine never trained on; the learning-curve-by-k line shows it growing with
   history. In-demo, the return-visit offer is derived at request time from `kfc_customer_history`
   (or the in-memory store) written by the *actual* `place_order` two minutes earlier.
3. "Can a crafted request forge the cart/profile?" → `revalidateOrder` on every request (existing);
   profile writes happen only server-side inside the `place_order` tool; feedback endpoint
   validates catalogIds; swap proposals are server-registry tokens.
4. "Why should I trust the savings number?" → `optimizeBill` is exhaustive over the combo space;
   `tests/combos.test.ts` pins exact VND numbers.
5. "What happens with zero history?" → `wP = 0`, pure global rules; profile null-safe everywhere.
6. "What's fake?" → POS log + personas are synthetic (stated in README); Zalo/Messenger send-API
   not called (webhook verify + forward exist); OTP in-memory; payment out of scope. Say so.

## 15. Delivery checklist (Codex: end state)

- [ ] All WPs 0–9 merged; `npm install && npm run build && npm test && npm run eval` exit 0 keyless.
- [ ] `npm run eval` with `AI_GATEWAY_API_KEY` set: Suite 2 runs all 38 cases; report pass count
      honestly in the run summary (do NOT gate CI on Suite 2 pass rate — it's a measurement).
- [ ] New/changed files exactly: `lib/reco/{context,affinity,pos-sim,suggest}.ts`,
      `lib/{history-store,profile,combos,cravings,demo}.ts`,
      `app/api/{feedback,demo}/route.ts`, `tests/{profile,suggest,combos,cravings,oos}.test.ts`,
      `eval/personalization.ts`; modified: `lib/{menu,order,agent,oms}.ts`,
      `app/api/agent/route.ts`, `app/page.tsx`, `db/{schema.sql,seed.ts}`, `eval/{run.ts,cases.jsonl}`,
      `package.json` (test script chain), `README.md` (new "What's real / what's synthetic" section
      + Suite 3 headline numbers).
- [ ] README updated with the printed Suite 3 numbers (paste actual output, not aspirations).
- [ ] Commit per WP (`feat(colonel): WP-N — <name>`), Co-Authored-By footer per repo convention.
- [ ] Nothing from `../kfc-kiosk-recommendations/` modified — copy, don't move.

## 16. Explicitly OUT of scope for this build (do not attempt)

Group ordering (F7) · proactive nudges (F10) · Colonel Console (F11) · voice transcription ·
real Zalo/Messenger send APIs · payments · Redis OTP. These are build-week stretch goals gated on
the checklist above being fully green first.
