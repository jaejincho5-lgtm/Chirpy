# OPUS-WORKPLAN — Project Chirpy upgrade, 6 tracks in one day

Written by Fable 5 on 2026-07-07 after full codebase exploration + user interview.
**Audience: Claude Opus executing autonomously.** Every decision is already made —
do not re-litigate scope, do not ask the user questions unless a credential is
missing. Follow the tracks in order. Commit at the end of each track with the
message given in that track. All paths are relative to
`kfc-conversational-ordering/` unless stated otherwise.

---

## 0. Context you must load into your head first

**Product:** "Project Chirpy" — KFC Vietnam conversational ordering agent
(hackathon: Agentic AI Build Week 2026, HCMC). Customer chats in Vietnamese on
`/user` (Messenger-style web mock) or **real Facebook Messenger** (webhook is
live). An AI-SDK v5 agent loop (`streamText`/`generateText`, `stopWhen:
stepCountIs(8)`, model `anthropic/claude-opus-4-8` via Vercel AI Gateway,
`lib/ai.ts`) drives a **typed Order state machine** (`lib/order.ts`) through 15
tools defined in `lib/agent.ts` `buildTools()`. `/backend` is the operator
console. Deployed on Vercel (Hobby: **daily cron limit** — the ghost-followup
sweep is triggered opportunistically from `/api/console`, not a frequent cron).

**Stack:** Next.js 16 App Router, React 19, `ai` v5, `@ai-sdk/react` v2,
`@supabase/supabase-js`, zod 3, TypeScript 5.6, `tsx` for tests/evals. No test
framework — tests are plain **ESM scripts with top-level `await` and
`console.assert`-style checks**, run via `npm test` (chained `tsx tests/*.ts`).

**Supabase project:** `aabw-colonel`, project id **`xjqqvrfecrhamrjwucac`**,
ap-southeast-1. Every store in the codebase follows the same dual pattern:
`SupabaseXStore` when `(SUPABASE_URL || NEXT_PUBLIC_SUPABASE_URL) &&
SUPABASE_SERVICE_ROLE_KEY` are set, otherwise an in-memory fallback (keyless
local runs, CI, evals). **Copy this pattern exactly for anything new** — see
`lib/history-store.ts` as the canonical example.

**Identity model:** customers are identified by `customerId` string — web:
persona ids `linh` / `linh_mom` / `guest` (validated `^[a-z0-9_-]{1,40}$`,
`app/api/agent/route.ts:20`); Messenger: `msgr_<psid>` via
`channelCustomerId()` in `lib/convo-store.ts:37`. **The loyalty account IS this
id** — that is the "account binding" the user asked for.

**Conversation state:** web = stateless server, client resends full history,
order reconstructed from tool-output parts then `revalidateOrder()`; channel =
server-side `kfc_conversations` (cap 24 messages), cart re-validated on load.
OTP session key: web `conv_<firstMessageId>` (`app/api/agent/route.ts:67`),
channel = the convo id `messenger:<psid>`.

**Prompt caching discipline (do not break):** the base system prompt is
byte-stable and carries `cacheControl: ephemeral`; volatile per-turn state goes
in a **second, uncached system message** (see `lib/channel.ts:221-235`).
Anything dynamic (order state, weather) must go in that second message or the
user message — **never edit the cached system prompt with dynamic content.**

**The demo bus:** `/user` and `/backend` sync over a `BroadcastChannel` named
by `DEMO_BUS` in `app/demo-shared.tsx`. `/backend` sends persona/weather/hour/
reset/nudge控制; `/user` broadcasts its transcript+order back. Do not break
these message shapes; extend them additively only.

**Git state warning:** `git status` shows deletions under
`kfc-kiosk-recommendations/` at repo root — **unrelated to you, do not touch,
do not commit them.** Stage files explicitly (`git add <paths>`), never `git
add -A` from the repo root.

### Already DONE in this session (working tree + live DB) — do not redo

1. **Supabase migration `loyalty_followups_oms_lifecycle` APPLIED to
   `xjqqvrfecrhamrjwucac`**: created `kfc_followups`, `kfc_loyalty`
   (customer_id PK, points, lifetime_points, updated_at, both points columns
   `>= 0` checked), `kfc_loyalty_events` (delta, reason in
   earn/redeem/adjust, order_id), RLS enabled server-only; **seeded
   `kfc_vouchers`** with KFC20 / FREESHIP / LUNCH50 (upsert, is_active=true).
2. **`db/schema.sql`** — extended with the same DDL + comments (bottom of file).
3. **`lib/oms-store.ts`** — NEW, complete. OMS lifecycle store:
   `OmsStage = placed|preparing|ready|completed|cancelled`, `OMS_STAGE_FLOW`
   transition map, `OMS_STAGE_LABEL` (Vietnamese labels + ETA hints),
   `getOmsStore()` dual-store with `createOrder(order, omsOrderNumber)`,
   `getByOrderNumber`, `latestForCustomer`, `listOrders(limit, stage?)`,
   `advance(id, toStage, note?)` (validates transitions, appends
   `kfc_order_events`, optimistic `eq("stage", ...)` guard), `getEvents`,
   `resetInMemoryOms()`.
4. **`lib/loyalty.ts`** — NEW, complete. `MAX_REDEEM_PER_ORDER = 12000`,
   `EARN_RATE_VND_PER_POINT = 1000`, `pointsEarnedFor()`, `getLoyaltyStore()`
   dual-store with `getAccount`, `earn`, `redeem` (clamped, ledger rows in
   `kfc_loyalty_events`), `listMembers`, `resetInMemoryLoyalty()`.
5. **`lib/vouchers.ts`** — EDITED. Added DB-backed loading below the hardcoded
   array: `loadVouchers()` (reads active, date-windowed `kfc_vouchers`, 60s
   module cache, falls back to hardcoded `VOUCHERS` on error/keyless),
   `invalidateVoucherCache()`, `findVoucherAsync(code)`. Sync `findVoucher`
   kept for fallback/tests.

Nothing is committed yet. Tracks below start from this state.

---

## Track 2 — OMS: async OMS functions, persistence, status tool, orders API

### 2.1 `lib/oms.ts` — make voucher/loyalty functions real

- **`applyVoucher(order, code)` → `async`**. Replace `findVoucher(normalizedCode)`
  with `await findVoucherAsync(normalizedCode)` (import from `./vouchers`).
  Everything else unchanged.
- **`checkLoyalty(customerId, redeem)` → `async`**, real balance:

```ts
export async function checkLoyalty(customerId = "demo-customer", redeem = false) {
  const account = await getLoyaltyStore().getAccount(customerId);
  const pointsBalance = account.points;
  const redeemablePoints = Math.min(pointsBalance, MAX_REDEEM_PER_ORDER);
  const discountVnd = Math.floor(redeemablePoints / 1000) * 1000;
  // ...rest identical shape to today (redemption object, redeemOptions array),
  // plus add lifetimePoints: account.lifetimePoints to the return.
}
```

  Import `getLoyaltyStore`, `MAX_REDEEM_PER_ORDER` from `./loyalty`.
  **Do NOT debit points here** — debit happens at place_order (2.3). Checking
  a redemption must never burn points.
- **`availableVoucherCodes()` → `async`**, map over `await loadVouchers()`
  instead of `VOUCHERS`.
- `placeOrder` stays **sync** and otherwise untouched.

### 2.2 Fix every call site of the now-async functions

| File | Line (pre-edit) | Change |
|---|---|---|
| `lib/agent.ts` | 272 | `const result = await applyVoucher(ctx.getOrder(), code);` |
| `lib/agent.ts` | 291 | `const result = await checkLoyalty(checkedCustomerId, redeem);` |
| `eval/run.ts` | 136 | `await applyVoucher(order, code)` |
| `eval/run.ts` | 142 | `await checkLoyalty("demo-vip", true)` |
| `eval/run.ts` | 576 | `await applyVoucher(order, "KFC20")` — check the enclosing fn is async; make it so if not |
| `tests/order.test.ts` | 133, 160 | `await applyVoucher(...)` (file already uses top-level await — fine) |
| `tests/combos.test.ts` | 45 | `await applyVoucher(...)` |

Grep afterwards: `applyVoucher|checkLoyalty|availableVoucherCodes` must show no
un-awaited calls (searchable as `= applyVoucher(` / `= checkLoyalty(`).

**Eval gotcha:** `eval/run.ts:141-145` expects `checkLoyalty("demo-vip", true)`
to produce `pointsRedeemed === 12000`. With a real ledger, `demo-vip` has 0
points → the case fails. Fix by **seeding demo balances**:

1. In-memory: in `lib/loyalty.ts` give `InMemoryLoyaltyStore` a constructor
   that seeds `DEMO_SEED_BALANCES` — export
   `const DEMO_SEED_BALANCES: Record<string, number> = { "demo-vip": 42600, linh: 15400, linh_mom: 8200 };`
   (`points` = seed, `lifetimePoints` = seed).
2. Supabase: run via MCP `execute_sql` on project `xjqqvrfecrhamrjwucac`
   (idempotent):

```sql
insert into public.kfc_loyalty (customer_id, points, lifetime_points)
values ('demo-vip', 42600, 42600), ('linh', 15400, 15400), ('linh_mom', 8200, 8200)
on conflict (customer_id) do nothing;
```

   (`do nothing`, not update — never clobber live earned balances.)

### 2.3 `lib/agent.ts` `place_order` tool — persist + settle loyalty

Inside the existing `if (result.ok)` block (after `ctx.setOrder(placed)`,
alongside the `recordOrder` call, each in its own try/catch so a store failure
never breaks the reply):

```ts
// Durable OMS record + lifecycle start (kfc_orders / kfc_order_events).
try {
  await getOmsStore().createOrder(placed, result.placedOrder.orderNumber);
} catch (error) { console.warn("Failed to persist OMS order", error); }

// Loyalty settlement: debit any redemption, then earn on the final total.
let loyaltyEarned = 0;
try {
  const loyalty = getLoyaltyStore();
  if (placed.loyalty && placed.loyalty.pointsRedeemed > 0) {
    await loyalty.redeem(ctx.customerId, placed.loyalty.pointsRedeemed, result.placedOrder.orderNumber);
  }
  loyaltyEarned = await loyalty.earn(ctx.customerId, placed.totals.totalVnd, result.placedOrder.orderNumber);
} catch (error) { console.warn("Failed to settle loyalty", error); }
```

Then change the return to `return payload({ ...result, loyaltyEarned });` (only
when ok; error path returns `payload(result)` as today). Imports:
`getOmsStore` from `./oms-store`, `getLoyaltyStore` from `./loyalty`.

### 2.4 New agent tool `check_order_status`

Add to `buildTools()` after `place_order`:

```ts
check_order_status: tool({
  description:
    "Look up the customer's order in the OMS: current stage (placed/preparing/ready/completed/cancelled) and timeline. Use when the customer asks where their order is. orderNumber optional — omit to use their most recent order.",
  inputSchema: z.object({ orderNumber: z.string().optional() }),
  execute: async ({ orderNumber }) => {
    const store = getOmsStore();
    const record = orderNumber
      ? await store.getByOrderNumber(orderNumber.trim().toUpperCase())
      : await store.latestForCustomer(ctx.customerId);
    if (!record) {
      return payloadLite({ ok: false, code: "order_not_found", message: "No order found for this customer." });
    }
    const events = await store.getEvents(record.id);
    const label = OMS_STAGE_LABEL[record.stage];
    return payloadLite({
      ok: true,
      orderNumber: record.omsOrderNumber,
      stage: record.stage,
      stageVietnamese: label.vi,
      etaHint: label.etaHint,
      itemsSummary: record.itemsSummary,
      totalVnd: record.totalVnd,
      timeline: events.map((e) => ({ event: e.eventType, at: e.createdAt })),
    });
  },
}),
```

(`payloadLite`, not `payload` — read-only tool.) Import `OMS_STAGE_LABEL` too.
**Do not** count `order_not_found` as `recordToolError` — a guest with no
orders asking "đơn đâu" must not trip the auto-handoff.

### 2.5 System prompt addition (`SYSTEM` in `lib/agent.ts`)

This is static text → safe to edit the cached prompt. Add one line to "Core
rules" after the handoff line:

```
- When the customer asks where their order is ("đơn tới đâu rồi", "bao giờ tới"), call check_order_status and answer with the stage in Vietnamese plus the ETA hint. Never invent a delivery status.
- After place_order succeeds, if the result includes loyaltyEarned > 0, mention it briefly ("+187 điểm KFC nhé").
```

### 2.6 `app/api/orders/route.ts` — NEW (backend Orders module API)

```ts
import { NextResponse } from "next/server";
import { getOmsStore, OMS_STAGE_FLOW, type OmsStage } from "@/lib/oms-store";
```

(Match the import alias style used by existing routes — check
`app/api/console/route.ts`; if the repo uses relative imports, use
`../../../lib/oms-store`.)

- `GET` — query `?stage=` optional; returns
  `{ orders: await getOmsStore().listOrders(40, stage) }`.
- `POST` — body `{ orderId: string, toStage: OmsStage }`; validate `toStage`
  is one of the five stages; call `advance`; on `{ error }` return 409 with
  the error, else `{ order: record }`.
- **Demo-gate exactly like `/api/console`** — copy its guard (it checks a
  `DEMO_CONSOLE` env or similar; replicate verbatim so the deploy stays
  consistent). Read `app/api/console/route.ts` first and copy its gating.

### 2.7 Acceptance (run before committing)

- `npx tsc --noEmit` clean.
- `npm test` passes (all six test files).
- `npm run eval` — lib suite: voucher + loyalty + place_order cases still pass.
- New micro-test `tests/oms-store.test.ts` (same style as existing: plain tsx
  script, top-level await, assert helper — copy the header of
  `tests/oos.test.ts`): create an order via `createOrder("web")` +
  `addToCart`, place it into the in-memory store, assert `placed → preparing →
  ready → completed` all succeed, `completed → preparing` returns error,
  `placed → completed` returns error, `latestForCustomer` finds it, events
  length === 4. Add it to the `test` script chain in `package.json`.

**Commit:** `feat(chirpy): real OMS — durable orders, lifecycle events, status tool + API`

---

## Track 3 — Loyalty wrap-up + voucher management API

Most of track 3 landed in track 2 (real `checkLoyalty`, settlement at
placement). Remaining:

### 3.1 `app/api/loyalty/route.ts` — NEW

- `GET` → `{ members: await getLoyaltyStore().listMembers(50) }`. Demo-gated
  like `/api/console`.

### 3.2 `app/api/vouchers/route.ts` — NEW

- `GET` → active + inactive rules: read `kfc_vouchers` directly via
  `supabaseAdmin()` (fall back to hardcoded `VOUCHERS` mapped into the same
  shape with `is_active: true` when keyless).
- `POST` — body either
  `{ action: "create", code, description, discountType, discountValue, minimumSubtotalVnd, maxDiscountVnd? }`
  or `{ action: "toggle", code, isActive }`. Uppercase + trim the code,
  validate `discountType in ('percent','fixed','free_delivery')`, upsert /
  update `kfc_vouchers`, then call `invalidateVoucherCache()`. Return the row.
  Demo-gated. (Cache note: the 60s TTL means other serverless instances pick
  up changes within a minute — acceptable, do not build cross-instance
  invalidation.)

### 3.3 Loyalty check tool already returns `lifetimePoints` (2.1) — also update
`get_customer_profile`'s payload? **No.** Leave profile alone; loyalty stays
its own tool. (Scope control.)

### 3.4 Acceptance

- `npx tsc --noEmit`; `npm test`.
- Manual: `curl localhost:3000/api/vouchers` returns 3 seeded rules (with dev
  server + env), POST create a `TEST10` voucher, `apply_voucher` path picks it
  up after cache expiry (or restart), toggle it off, verify it stops applying.

**Commit:** `feat(chirpy): loyalty members + voucher management APIs (DB-backed rules live)`

---

## Track 4 — Real-world signals: Open-Meteo + VN calendar

### 4.1 `lib/worldstate.ts` — NEW

```ts
// Live world signals for HCMC. Weather auto-derives the recommender's
// clear/rainy/hot signal; the operator override from /backend still wins
// (demo steering). Module-level cache: one Open-Meteo call per ~10 min per
// warm instance; on fetch failure, fall back to the last good value, then to
// "clear".
import type { WeatherSignal } from "./reco/context";

export type WorldState = {
  weather: WeatherSignal;
  temperatureC: number | null;
  isRaining: boolean;
  calendarNote: string | null;   // "Hôm nay là ngày lễ Quốc Khánh 2/9" etc.
  source: "live" | "fallback";
  fetchedAt: string;
};
```

- `const HCMC = { latitude: 10.762, longitude: 106.66 };`
- URL: `https://api.open-meteo.com/v1/forecast?latitude=10.762&longitude=106.66&current=temperature_2m,precipitation,rain,weather_code&timezone=Asia%2FHo_Chi_Minh`
  — no API key. 5s `AbortController` timeout (copy the timeout pattern from
  `sendChannelReply` in `lib/channel.ts:110-135`).
- Mapping (in this order): WMO `weather_code` in
  {51-67, 80-82, 95-99} **or** `rain > 0.1` → `rainy`; else `temperature_2m >= 33` → `hot`;
  else `clear`.
- Cache: `let cache: { state: WorldState; at: number } | null`, TTL 10 min.
  Export `async function getWorldState(): Promise<WorldState>` and
  `function describeWorld(state: WorldState): string` producing one compact
  Vietnamese line for the prompt, e.g.
  `"Thời tiết TP.HCM: nắng nóng 36°C." + (calendarNote ? " " + calendarNote : "")`.

### 4.2 `lib/vn-calendar.ts` — NEW (deterministic, no fetch)

Export `getCalendarNote(date: Date): string | null`. Table-driven:

- Fixed-date 2026 holidays/moments (month-day keys): `01-01` Tết Dương lịch;
  `02-14` Valentine; `03-08` Quốc tế Phụ nữ; `04-30` Giải phóng miền Nam;
  `05-01` Quốc tế Lao động; `06-01` Quốc tế Thiếu nhi; `09-02` Quốc khánh;
  `10-20` Phụ nữ Việt Nam; `12-24/25` Giáng sinh; Tết Nguyên Đán 2026:
  `02-16` through `02-19` ("Tết Nguyên Đán — giao hàng có thể chậm");
  Trung thu 2026: `09-25`.
- Payday: day 1 and 15 → `"Hôm nay ngày lương 🎉"`. Friday evening → weekend
  note. Return the first match, else null.
- Keep every string short — it lands in a prompt line, not marketing copy.

### 4.3 Wire into the channel path (`lib/channel.ts`)

Today (`channel.ts:200-204`): weather comes from `getChannelWeather()`
(operator-set, in-memory), hour from real UTC+7. Change to:

1. `lib/demo.ts`: make the override **explicit and expiring** —

```ts
let channelWeatherOverride: { weather: WeatherSignal; setAt: number } | null = null;
const OVERRIDE_TTL_MS = 60 * 60 * 1000; // operator steering lasts 1h

export function getChannelWeatherOverride(): WeatherSignal | null {
  if (!channelWeatherOverride) return null;
  if (Date.now() - channelWeatherOverride.setAt > OVERRIDE_TTL_MS) return null;
  return channelWeatherOverride.weather;
}
export function setChannelWeather(weather: WeatherSignal): void {
  channelWeatherOverride = { weather, setAt: Date.now() };
}
export function clearChannelWeather(): void { channelWeatherOverride = null; }
```

   Keep the old `getChannelWeather` name **removed** — update its one caller
   (channel.ts) rather than aliasing. Update `/api/demo` to accept
   `{ weather: "live" }` → `clearChannelWeather()`.
2. `channel.ts` `forwardToAgent`: before building the runtime,

```ts
const { getWorldState, describeWorld } = await import("./worldstate");
const { getChannelWeatherOverride } = await import("./demo");
const world = await getWorldState();
const override = getChannelWeatherOverride();
const weather = override ?? world.weather;
```

   Use `weather` in `orderContext`. Append the world line to the **second,
   uncached system message** (the one carrying order state; if there is no
   order yet, emit the state message anyway with just the world line):
   `content: [orderStateLine, describeWorld(world), override ? "(weather overridden by operator)" : ""].filter(Boolean).join("\n")`
   — build it as plain string concat matching the existing template style.

### 4.4 Wire into the web path (`app/api/agent/route.ts`)

Read the file first (it's ~130 lines; context extraction near the top,
`streamText` + system message assembly around line 100-130). Then:

- The client body carries `context: { weather, hour }` set by the operator
  toggles. Semantics: **web operator toggle always wins** (the demo rail is
  the whole point of `/user`); live world state fills in when the client sent
  no explicit weather. The `/backend` weather segmented control currently has
  Nắng/Mưa/Nóng; Track 6 adds a "Live" option that sends
  `weather: undefined` → server falls back to `getWorldState()`.
- Implement: after validating body context, `const world = await
  getWorldState();` `const weather = bodyWeather ?? world.weather;` and pass a
  second system message with `describeWorld(world)` exactly like the channel
  path (this route already assembles system messages with a cache breakpoint —
  mirror the channel structure; do NOT touch the cached first message).

### 4.5 System prompt addition (static, cached — safe)

Append to Core rules:

```
- A system line may describe today's real weather/temperature/calendar in Vietnam. Weave it in naturally when it strengthens a suggestion ("trời đang mưa, thêm súp rong biển nóng nhé") — at most once per conversation, never as a weather report.
```

### 4.6 `/api/nudge` + recommender

`lib/reco/suggest.ts` already consumes `weather` from `OrderContext` — no
change needed there. `app/api/nudge/route.ts` builds the nudge from context —
read it; if it takes weather from the request/demo store, apply the same
`override ?? live` resolution.

### 4.7 Acceptance

- `tests/worldstate.test.ts` (add to `package.json` test chain): mock nothing —
  test only the pure parts: WMO mapping function (export it:
  `weatherFromObservation(code, rain, tempC)`) across the three branches, and
  `getCalendarNote` for a known holiday date, a payday, and a plain day.
- Manual: `curl localhost:3000/api/agent` chat turn (or drive `/user` with
  headless Edge, see Track 8) and confirm the reply can reference real weather;
  check server log line for Open-Meteo fetch happening once per 10 min, not
  per turn.

**Commit:** `feat(chirpy): live world signals — Open-Meteo HCMC weather + VN calendar in agent context`

---

## Track 5 — OTP: Twilio behind the interface + request rate limiting

### 5.1 Migration (apply via Supabase MCP `apply_migration`, name `otp_request_limits`)

```sql
alter table public.kfc_otp
  add column if not exists request_count integer not null default 1,
  add column if not exists window_started_at timestamptz not null default now(),
  add column if not exists last_requested_at timestamptz not null default now();
```

Mirror the same DDL into `db/schema.sql`'s kfc_otp block (edit the create
table statement itself — schema.sql uses `create table if not exists`, so ALSO
append the `alter table ... add column if not exists` lines below it for
existing DBs; keep both in sync).

### 5.2 `lib/sms.ts` — NEW

```ts
// SMS delivery for OTP. Twilio REST (no SDK — one fetch). Env-gated:
// TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM. When unset, sendSms
// reports {sent:false, reason:"not_configured"} and the OTP layer falls back
// to demo delivery (dev code in chat).
export function twilioConfigured(): boolean { /* all three env vars present */ }

export function normalizeVnPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("84")) return `+${digits}`;
  if (digits.startsWith("0")) return `+84${digits.slice(1)}`;
  return raw.startsWith("+") ? raw : `+${digits}`;
}

export async function sendSms(phone: string, body: string): Promise<{ sent: boolean; reason?: string }>
```

`sendSms`: POST
`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, header
`Authorization: Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
body `new URLSearchParams({ To: normalizeVnPhone(phone), From: process.env.TWILIO_FROM!, Body: body })`,
`Content-Type: application/x-www-form-urlencoded`, 10s AbortController timeout,
never throw (return `{sent:false, reason}` on any failure).

### 5.3 `lib/otp.ts` changes

1. **Result type** — extend:

```ts
export type OtpRequestResult =
  | { ok: true; maskedPhone: string; requestedAt: string; expiresAt: string; devCode?: string; smsSent: boolean }
  | { ok: false; code: "cooldown" | "rate_limited"; retryInSeconds: number; message: string };
```

   (Adding `ok` is a breaking shape change — fix all consumers, listed in 5.4.)
2. **Limits:** `const RESEND_COOLDOWN_MS = 60_000; const MAX_REQUESTS_PER_WINDOW = 3; const REQUEST_WINDOW_MS = 10 * 60 * 1000;`
3. **`OtpRecord`** gains `requestCount: number; windowStartedAt: number; lastRequestedAt: number` — map to/from the new columns in `SupabaseOtpProvider.load/save`; track the same fields in `MockOtpProvider`.
4. **`request()` logic (both providers — put the shared decision in a helper
   like `judge()` is for verify):** load existing record for the session key;
   if one exists and `now - lastRequestedAt < RESEND_COOLDOWN_MS` → return
   cooldown failure with `retryInSeconds`. If `now - windowStartedAt <
   REQUEST_WINDOW_MS && requestCount >= MAX_REQUESTS_PER_WINDOW` →
   rate_limited failure. Else mint a new code; `requestCount` = in-window ?
   `prev+1` : 1; reset `windowStartedAt` when the old window elapsed.
5. **Delivery:** in `requestResult(...)`, after building the success result:
   if `twilioConfigured()`, `const delivery = await sendSms(phone, `Ma xac nhan KFC cua ban: ${code}. Het han sau 5 phut.`)`
   → `smsSent = delivery.sent`, and **never set devCode when smsSent** (real
   delivery kills demo exposure even if the env flag is on). If not
   configured, `smsSent = false` and keep the existing
   `OTP_EXPOSE_DEV_CODE=1` devCode behavior. (This makes `request()` async on
   the network — it already is `async`.)

### 5.4 Consumers of `OtpRequestResult` to update

- `lib/agent.ts` `request_otp` tool (~line 314): handle the failure shape —

```ts
const requested = await otpProvider.request(ctx.sessionKey, phone);
if (!requested.ok) {
  return payloadLite({ ok: false, code: requested.code, message:
    `Chưa gửi được mã mới: đợi ${requested.retryInSeconds}s rồi thử lại.` });
}
```

  (Do **not** `recordToolError` for cooldown/rate_limited — user impatience
  must not auto-handoff.) Success path unchanged, plus the message should say
  the code was sent by SMS when `requested.smsSent`.
- `eval/run.ts:155, 167, 177` and `tests/order.test.ts:~110-120` — these call
  `otpProvider.request(...)` then read `.devCode`/`.expiresAt`; add
  `if (!requested.ok) throw new Error("otp request failed")` narrowing before
  property access (TS discriminated union will force this — follow the
  compiler). **Watch out:** `otp_verify` eval and `place_order` eval call
  `request` twice on nearby keys — they use distinct keys per case
  (`lib_<id>`), so the 60s cooldown does NOT trip. `tests/otp` scenarios that
  re-request on the SAME key must either use fresh keys or assert the cooldown
  error — check `tests/order.test.ts` around line 110-125 and adjust with
  fresh keys per assertion.
- Update the `request_otp` tool description + system prompt line 41 ("The OTP
  code is delivered...") to mention SMS delivery when configured — keep the
  demo-exception sentence intact (it's still the keyless path).

### 5.5 Add rate-limit test

`tests/otp-limits.test.ts` (MockOtpProvider directly): request → immediate
re-request returns `{ok:false, code:"cooldown"}`; simulate 3 successful
requests spaced by monkeypatching `Date.now` (or export the limits and test
the shared decision helper directly with injected timestamps — prefer the
helper approach, zero clock-mocking). Add to `package.json` test chain.

### 5.6 Acceptance

- `npx tsc --noEmit`, `npm test`, `npm run eval` all green with **no Twilio
  env** (mock path). If the user has provided Twilio keys in `.env.local`,
  ALSO do one live send to their own phone and confirm `smsSent: true`.

**Commit:** `feat(chirpy): OTP hardening — Twilio SMS behind provider interface, resend cooldown + request window`

---

## Track 6 — `/backend` → Odoo-style modules

**Decision from the user:** keep the demo-director role, reorganize into
modules. Do NOT re-aim at a store-ops persona; the director rail stays a
first-class module.

### 6.1 Structure

`app/backend/page.tsx` is 615 lines. Refactor to:

```
app/backend/page.tsx          — shell: module nav + active-module render (client component)
app/backend/modules/director.tsx   — the ENTIRE current page content, extracted verbatim
app/backend/modules/orders.tsx     — NEW: OMS queue
app/backend/modules/customers.tsx  — NEW: loyalty members + taste profile
app/backend/modules/vouchers.tsx   — NEW: voucher CRUD
app/backend/modules/stock.tsx      — NEW: OOS toggles (move the Pepsi-OOS scenario control here, keep a shortcut in director)
app/backend/modules/agent-ops.tsx  — extract the existing OpsBoard (backend/page.tsx:86) into this module
```

Top nav: brand mark left, then module tabs `Đạo diễn · Đơn hàng · Khách hàng ·
Voucher · Kho · Agent`, rendered like Odoo's app switcher — flat buttons,
active = filled. Preserve ALL existing director behavior: the BroadcastChannel
wiring must stay inside `director.tsx` and keep working when other modules are
active (mount the bus subscription in the **shell** or keep director mounted
hidden — simplest correct move: keep every module mounted, `display:none`
inactive ones, so polling/bus state never resets when the operator tabs
around; memory cost is trivial here).

**Styling:** match the existing console look (dark, red KFC accents — reuse
the classNames already in the file; no new design system, no Tailwind
additions beyond what's used).

### 6.2 Module specs

- **Orders (`orders.tsx`)** — poll `GET /api/orders` every 4s (copy the
  OpsBoard poll pattern). Kanban-ish columns or a single list grouped by
  stage: for each order show `omsOrderNumber`, time, channel chip,
  `itemsSummary`, `totalVnd` formatted (`formatVnd` from `lib/menu` is
  server-ish but pure — check its import graph; if it drags menu data into the
  client bundle, inline a tiny `vnd()` formatter in demo-shared instead), and
  **action buttons from `OMS_STAGE_FLOW[stage]`**: Nhận đơn (→preparing), Sẵn
  sàng (→ready), Hoàn tất (→completed), Hủy (→cancelled). POST
  `/api/orders`, optimistic UI update, revert on 409.
- **Customers (`customers.tsx`)** — `GET /api/loyalty` members list: customer
  id, points, lifetime, updated; row click loads `GET /api/profile?...`
  (existing route — read it for its query params) into a side panel reusing
  the taste-profile card component from demo-shared if exported, else a
  simple key/value panel. Show the binding story: subtitle "Tài khoản = danh
  tính nhắn tin (Messenger PSID / persona)".
- **Vouchers (`vouchers.tsx`)** — table from `GET /api/vouchers` (code, mô tả,
  loại, giá trị, tối thiểu, active toggle switch → POST toggle) + a small
  create form (code, description, type select, value, min) → POST create.
  Client-side uppercase the code.
- **Stock (`stock.tsx`)** — menu list with OOS checkboxes → existing
  `POST /api/demo {outOfStock: [...]}`. Get the menu client-side from the
  public Supabase read or an existing endpoint — read how `/user` renders menu
  cards (`demo-shared.tsx` MenuCards) and reuse that data source; if menu data
  is bundled (`lib/menu.ts` import), importing it in a client component is
  fine (it's static data).
- **Agent ops** — the existing OpsBoard component moved, zero behavior change.

### 6.3 Weather "Live" option (from Track 4.4)

In director's weather segmented control add a fourth option **`Live ☁️`**:
sends `weather: undefined` over the demo bus (so `/user` posts no weather →
server uses Open-Meteo) and calls `POST /api/demo { weather: "live" }` for the
channel path. Verify `/api/demo` accepts it (Track 4.3.1). Default the control
to Live.

### 6.4 Acceptance

- `npx tsc --noEmit`; `next build` compiles (build is part of Track 8 anyway
  but run it here too — App Router page splits often surface `use client`
  mistakes: every module file starts with `"use client"`).
- Manual with headless Edge (Track 8 method): open `/backend`, click through
  all six modules, place an order via `/user`, watch it appear in Orders,
  advance it placed→preparing→ready→completed, confirm buttons disable at
  terminal stages, toggle a voucher off and back.

**Commit:** `feat(chirpy): backend console reorganized into Odoo-style modules (orders/customers/vouchers/stock/agent)`

---

## Track 7 — `/voice`: VRM vtuber ordering agent

**User's chosen differentiator.** A full-screen page where the customer TALKS
to a 3D VRM avatar ("Đại sứ ảo KFC") and it talks back — same agent, same
tools, same order state machine underneath.

### 7.1 Dependencies

```
npm i three @pixiv/three-vrm
npm i -D @types/three
```

Pin whatever `@pixiv/three-vrm@^3` resolves; it requires `three >= 0.160`
roughly — accept npm's resolution, do not fight it. **package.json conflict
warning:** nothing else in the plan touches package.json except test-script
additions — do those edits in the same sitting to avoid merge fumbles.

### 7.2 The model file

Need an openly-licensed `.vrm` in `public/avatar.vrm`. Sources in order of
preference (verify the download is a real binary, >1 MB, starts with bytes
`glTF`):

1. three-vrm's own sample:
   `https://raw.githubusercontent.com/pixiv/three-vrm/dev/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm`
2. Any VRoid sample model already cached locally.
3. If neither works, STOP this track's model step and use the documented
   fallback: render a simple three.js capsule-and-sphere "chick" placeholder
   with two sphere eyes and a cone beak parented to the head bone — the
   animation/voice pipeline is identical and the page still demos. Note it in
   the commit message.

Add `public/AVATAR_LICENSE.md` noting the model's origin + license (the
three-vrm sample models are MIT-licensed with the repo; state that).

### 7.3 Page architecture — `app/voice/page.tsx` + `app/voice/vrm-stage.tsx`

Both `"use client"`. Keep three.js OUT of the main bundle for other pages:
`const VrmStage = dynamic(() => import("./vrm-stage"), { ssr: false })`.

**`vrm-stage.tsx`** — self-contained three.js component:

- Props: `{ speaking: boolean; thinking: boolean; mood: "idle" | "happy"; visemeLevel: number }`
  (visemeLevel 0..1 driven by the TTS layer).
- Setup: `WebGLRenderer` (alpha, antialias, `setPixelRatio(min(devicePixelRatio,2))`),
  `PerspectiveCamera` at roughly `(0, 1.35, 1.6)` looking at `(0, 1.3, 0)`
  (head-and-shoulders framing), ambient + directional light, KFC-red gradient
  background via CSS behind a transparent canvas.
- Load: `GLTFLoader` + `loader.register((parser) => new VRMLoaderPlugin(parser))`;
  on load `VRMUtils.removeUnnecessaryJoints(gltf.scene)`; add `vrm.scene`.
- Animation loop (single `requestAnimationFrame`, call `vrm.update(delta)`
  every frame — spring bones need it):
  - **Idle:** subtle sine bob on the hips node
    (`vrm.humanoid.getNormalizedBoneNode("hips")`) ±0.01, slow head sway.
  - **Blink:** every 2–6s randomized, `vrm.expressionManager.setValue("blink", v)`
    ramp 0→1→0 over ~150ms.
  - **Mouth:** `vrm.expressionManager.setValue("aa", visemeLevel)` each frame
    (lerp toward the prop for smoothness).
  - **Thinking:** tilt head bone ~10° + look up-left
    (`vrm.lookAt?.lookAt(target)` if present); also render a "…" indicator in
    DOM, not in-canvas.
  - **Happy (order placed):** `setValue("happy", 1)` for 2.5s plus a small
    two-hand raise if arm bones exist (rotate lower arms; keep it crude —
    charm over accuracy).
- Resize observer for canvas sizing. Dispose everything on unmount.
- **VRM 0.x vs 1.0 expression names differ** (`aa` vs `A`, `blink` vs
  `Blink`). Use `vrm.expressionManager` and probe:
  `const EXPR = { mouth: mgr.getExpression("aa") ? "aa" : "A" /* etc */ }`
  once after load, and log available expressions to console for debugging.

**`page.tsx`** — the conversation shell:

- Reuse the agent exactly as `/user` does: `useChat` from `@ai-sdk/react`
  pointed at `/api/agent` — **read `app/user/page.tsx` first** and copy its
  transport/body wiring (customerId, context), including how it extracts the
  order from message parts (`extractOrder` helper in `app/demo-shared.tsx`).
  Use customerId `voice_guest` by default (or read `?persona=` from
  searchParams like /user does, if it does).
- **STT:** copy `toggleMic()` from `app/user/page.tsx:283` (webkit
  SpeechRecognition, `lang="vi-VN"`, Chrome/Edge only) but make it push-to-talk:
  hold-or-toggle a big circular mic button; on final transcript → `sendMessage`
  (however /user submits). Show the live interim transcript as a subtitle.
- **TTS + viseme:** `lib/speech.ts` — NEW, client-safe:

```ts
export interface Speaker {
  speak(text: string, callbacks: { onLevel: (v: number) => void; onEnd: () => void }): void;
  cancel(): void;
}
export function getSpeaker(): Speaker  // BrowserSpeaker now; ElevenLabs drops in later
```

  `BrowserSpeaker`: pick voice = `speechSynthesis.getVoices().find(v => v.lang.startsWith("vi"))`
  (voices load async — listen for `voiceschanged`), rate ~1.05, pitch ~1.15
  (mascot-ish). Viseme driver: `utterance.onboundary` fires per word — on each
  boundary pulse `onLevel(0.4 + 0.5*Math.random())` and decay toward 0 in the
  stage's lerp; `onend` → `onLevel(0)` + `onEnd()`. No audio-stream analysis
  (speechSynthesis exposes none) — word-boundary flapping is the accepted
  technique.
- **What to speak:** the assistant text includes the JSON response contract.
  **Move `extractSay` + `stripMarkdown` + `extractProse` from `lib/channel.ts`
  into a new pure module `lib/say.ts`** (no `node:crypto` import — channel.ts
  currently top-imports node:crypto which breaks client bundling), re-export
  from channel.ts for existing imports (`export { extractSay } from "./say"`),
  and import `extractSay` from `lib/say` in the voice page. Speak
  `extractSay(finalAssistantText)`.
- **State machine of the page:** `idle → listening (mic) → thinking (request
  in flight / status !== "ready") → speaking (TTS) → idle`. Map to VrmStage
  props: `thinking`, `speaking`, and `mood: "happy"` for 2.5s when the order
  stage transitions to `placed` (watch the extracted order state).
- **On-screen furniture (minimal):** avatar full-bleed; bottom center mic
  button + live subtitle of what the avatar is saying; top-right compact cart
  chip (items count + total) expanding to the Receipt component from
  demo-shared; small "gõ phím" escape hatch link to `/user`. During
  `otp_requested` stage show the dev-code SMS widget if `/user` has one (read
  how /user renders the OTP dev code and reuse).
- Add a card for `/voice` on the launcher `app/page.tsx` ("Nói chuyện với Đại
  sứ ảo KFC 🎤") and a small mic-link from `/user`'s header to `/voice`.

### 7.4 Browser caveats (accept, don't fix)

- Requires Chrome/Edge (SpeechRecognition + decent vi TTS). If
  `SpeechRecognition` is missing, disable mic with a note; typing input still
  works (include a hidden-by-default text input toggle).
- `speechSynthesis` on some systems has no vi voice → fall back to default
  voice; still demos.

### 7.5 Acceptance

- `next build` clean (three.js only in the voice chunk — check build output
  sizes; `/user` first-load JS must not grow).
- Headless-Edge screenshot of `/voice` shows the avatar rendered (canvas
  non-blank). Manual mic test is on the user (needs a real mic); verify the
  full loop by typing via the escape-hatch input: reply arrives → TTS speaks
  (audible) → mouth flaps.

**Commit:** `feat(chirpy): /voice — VRM virtual ambassador with vi-VN STT/TTS, lip-sync, same agent underneath`

---

## Track 8 — Verification protocol (do all of it)

1. `npx tsc --noEmit` — zero errors.
2. `npm test` — all suites including the new `oms-store`, `otp-limits`,
   `worldstate` tests.
3. `npm run eval` — lib suite pass rates not below the README's recorded
   numbers (voucher/loyalty/place_order cases green).
4. `npm run build` — clean production build, note route sizes.
5. **End-to-end with env** (`.env.local` present in the project — check; if
   Supabase keys are set the dual stores go durable): `npm run dev`, then with
   headless Edge (per user preference memory: **verify local apps with
   headless Edge, not claude-in-chrome** — Chrome is on the user's Mac; use
   `msedge --headless=new --screenshot=... --window-size=1400,900 <url>` or
   Playwright if available):
   - `/user`: place a full order (search → add → voucher KFC20 → quote →
     request_otp → verify with dev code → place). Confirm reply mentions
     `+N điểm`.
   - Supabase MCP `execute_sql`: `select * from kfc_orders order by created_at desc limit 3;`
     row exists with stage `placed`; `kfc_order_events` has the `placed` event;
     `kfc_loyalty` shows the earn; `kfc_loyalty_events` has earn (+ redeem if
     redeemed).
   - `/backend` → Orders: advance the order to completed; ask in `/user` chat
     "đơn của mình tới đâu rồi?" → agent answers with the real stage.
   - `/backend` → Vouchers: create `TEST10` (fixed 10000, min 50000), apply it
     in a fresh chat after ≥60s (cache TTL), then toggle off.
   - `/voice`: screenshot; typed round-trip.
6. Update `README.md`: new "What's Real" rows (OMS lifecycle, loyalty ledger,
   live weather, OTP limits/Twilio, /voice), new routes list, env var table
   additions. Update `docs/PLAN.md` P0 list — mark these tracks landed with
   date 2026-07-07.
7. Final commit: `docs(chirpy): README + plan refresh for OMS/loyalty/world/OTP/voice drop`
8. Deploy only if the user asks (vercel:deploy skill).

### Env vars (full set after this plan)

| Var | Purpose | Required? |
|---|---|---|
| `AI_GATEWAY_API_KEY` | agent LLM calls | yes (already set) |
| `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | durable stores | yes (already set) |
| `AGENT_MODEL` | model override | optional |
| `MESSENGER_TOKEN` / `MESSENGER_APP_SECRET` / `MESSENGER_VERIFY_TOKEN` | real Messenger | already set in prod |
| `OTP_EXPOSE_DEV_CODE` | demo OTP in chat (keyless SMS only) | =1 today; ignored once Twilio set |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` | real OTP SMS | **user must supply**; everything works without |
| `OOS_DEMO_ITEMS` | boot-time OOS seed | optional |

### Sequencing + discipline

- Tracks 2→3→4→5 touch overlapping files (`agent.ts`, `otp.ts`, routes) — do
  them **serially in that order**. Track 6 (backend UI) and Track 7 (voice)
  are independent of each other; either order, but both after 2-4 (they
  consume the new APIs).
- Typecheck after every track, not just at the end. Commit per track with the
  given message + the standard `Co-Authored-By: Claude Fable 5
  <noreply@anthropic.com>` trailer.
- If a live external dependency flakes (Open-Meteo down, VRM download 404),
  use the documented fallback in that track and keep moving — every track has
  a keyless/offline path by design.
