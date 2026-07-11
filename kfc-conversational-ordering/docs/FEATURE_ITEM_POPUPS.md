# Feature Spec — Floating Item Popups + Side Menu GUI (`/voice`)

**Status:** proposed
**Surface:** `app/voice/page.tsx` (the KFC virtual-ambassador voice kiosk)
**Author:** handoff draft, 2026-07-11

---

## 1. Summary

Give the `/voice` kiosk a **visual channel for the menu** that runs alongside the
spoken conversation:

1. **Item popups** — whenever the ambassador *talks about* a menu item, a floating
   card for that item animates in over the stage. If the agent brings up several
   items in one turn (e.g. "mình có Zinger, gà rán, và popcorn nha"), **all of them
   appear** as a small stack/cluster of cards.
2. **Tap to add** — tapping a popup card **adds that item to the cart** (quantity 1,
   sensible default options), with spoken + visual confirmation from the agent.
3. **Floating side menu** — a persistent, collapsible panel pinned to the side of the
   phone frame that shows the **full KFC catalog**, grouped by category. Every row is
   tappable and adds to the cart through the same path as the popups.

The point: a customer can *see and touch* the menu at any moment, while still
ordering hands-free by voice. Popups make the agent's words tangible; the side menu
is the always-available fallback for anyone who'd rather browse and tap.

---

## 2. Why this fits the existing architecture

Two facts from the current code decide the whole design — read them before building.

### 2.1 The agent already tells us which items it's talking about

We do **not** need to NLP-parse the ambassador's prose. Every time the agent brings
up menu items it does so through a tool call, and those tool results are already in
the `useChat` message stream as typed parts:

| Tool (`lib/agent.ts`) | Output field | Shape |
| --- | --- | --- |
| `search_menu` | `output.matches` | `MenuMatch[]` |
| `interpret_craving` | `output.matches` | `MenuMatch[]` (craving → up to 3 items) |
| `reorder_usual` | `output.applied` | names replayed into the cart |

`MenuMatch` (see `lib/menu.ts`) already carries everything a card needs **and**
everything `add_to_cart` needs:

```ts
type MenuMatch = {
  matchId: string;      // required by add_to_cart
  catalogId: string;    // required by add_to_cart
  name: string;
  vietnameseName: string;
  description: string;
  displayPrice: string; // e.g. "56.000 VND"
  category: MenuCategory;
  priceVnd: number;
  options: MenuOption[];
  score: number;
};
```

A `search_menu` tool call surfaces as a message part of `type: "tool-search_menu"`
with `state: "output-available"` and `output.matches`. The `/voice` page already
walks `message.parts` (see `getLatestOrder` / `getPartOutput` in `app/demo-shared.tsx`)
— we reuse exactly that pattern.

### 2.2 The cart is server-authoritative — clicks must go through the agent

The cart is a typed order state machine (`lib/order.ts`). The client **never** mutates
it directly:

- The live `Order` is reconstructed from tool outputs in the message history
  (`getLatestOrder`).
- On every request the server re-validates the reconstructed order
  (`sanitizeReconstructedOrder` → `revalidateOrder`), **rebuilding each cart line from
  the authoritative catalog** so a forged client line is dropped before it can reach
  `place_order`.
- Items enter the cart only via the agent's `add_to_cart` tool, which requires a
  `catalogId` + `matchId` that came from `search_menu`.

**Consequence:** "tap to add" is implemented by **sending a message** that the agent
turns into `add_to_cart`. We already hold the exact `catalogId`/`matchId` on the card,
so the add is unambiguous and deterministic — but it still flows through the same
guardrailed path as a spoken order. We deliberately do **not** invent a client-side
cart mutation (see §7 for the rejected alternative and why).

---

## 3. UX behaviour

### 3.1 Item popups

- **Trigger:** a new assistant turn completes (the same moment the page speaks it —
  see the "Speak each newly completed assistant message" effect in `page.tsx`) and
  that turn's tool parts contain one or more `MenuMatch` items.
- **Which items show:** the union of `matches` from that turn's `search_menu` /
  `interpret_craving` parts, filtered to the ones the agent actually *mentioned*:
  - Normalize the spoken `say` text (`normalizeText` from `lib/menu.ts`) and keep any
    match whose `name` / `vietnameseName` token appears in it.
  - **Fallback:** if the text-match yields nothing (the model paraphrased), show the
    **top 3** matches by `score`. This guarantees "agent brought up items → cards
    appear" without ever showing a wall of 6 cards.
- **Multiple items:** render as a horizontal cluster / fanned stack of up to ~4 cards,
  centred low over the avatar so they don't cover the face. More than 4 → cap and add
  a "+N nữa" affordance that opens the side menu.
- **Motion:** cards spring in staggered (40–60 ms apart), gently bob, and are
  dismissable. Reuse the existing `.menu-card` visual language from
  `app/demo-shared.tsx` (category tag, name, description, price) so it looks native.
- **Auto-dismiss:** fade out when (a) the next assistant turn arrives, (b) the item is
  added, or (c) after a timeout (~12 s) so the stage doesn't stay cluttered. A card the
  user is hovering/holding does not time out.
- **Out-of-stock:** if the item is flagged out of stock (see §5.3), the card renders
  disabled with a "tạm hết" ribbon and is not tappable.

### 3.2 Tap to add

On tap of a popup card:

1. Optimistic UI: the card flips to an "Đang thêm…" state and the mic loop is paused
   (a tap is a user action, same as speaking).
2. Dispatch `quickAdd(match)` (§4.2), which calls `submit()` with a deterministic
   Vietnamese add phrase.
3. The agent runs `search_menu → add_to_cart → suggest_addons`, speaks the new total,
   and the receipt (`Receipt` in `voice-receipt`) updates from `getLatestOrder`.
4. The card resolves: brief "✓ Đã thêm" then dismiss.

Because `submit()` already guards on `isBusy` and cancels in-flight speech, a rapid
double-tap is naturally debounced; disable the card while `isBusy` too.

### 3.3 Floating side menu

- A collapsible panel docked to the right edge of `.voice-phone` (desktop) or a
  slide-over sheet from the bottom/side on narrow/kiosk screens.
- **Content:** the full catalog grouped by `MenuCategory` (`chicken`, `combo`,
  `burger`, `rice`, `side`, `drink`, `dessert`), each row showing name + Vietnamese
  name + price + a small category glyph. `popular` items get a "🔥 Bán chạy" tag.
- **Search box** at the top filters rows client-side via `normalizeText` (accent-
  insensitive, matches the agent's own search).
- **Tap a row → same `quickAdd`** path as popups.
- **Collapsed state:** a slim tab/handle ("Thực đơn") the user can pull out; collapsed
  by default on first load so it never competes with the "Bắt đầu" gate.
- **Cart mirror (optional):** the panel footer can show the running `n món · total`
  chip that already exists in the header, for a one-glance basket.

---

## 4. Implementation

### 4.1 New / changed files

| File | Change |
| --- | --- |
| `app/voice/item-popups.tsx` | **New.** `<ItemPopups>` — derives surfaced items from `messages`, renders the floating card cluster, calls `quickAdd`. |
| `app/voice/menu-panel.tsx` | **New.** `<MenuPanel>` — the collapsible side GUI over the full catalog with search + tap-to-add. |
| `app/voice/page.tsx` | Wire in both components; add the `quickAdd` callback; pass `messages`, `latestOrder`, `isBusy`, `started`. |
| `app/globals.css` | New `.voice-popup*` and `.voice-menu*` classes (reuse `.menu-card` tokens). |
| `lib/voice-items.ts` | **New (optional but recommended).** Pure helper `surfacedItems(messages)` + text-mention filter, unit-testable without React. |
| `app/api/menu/route.ts` | **New (optional).** `GET` returning `loadCatalog()` + current out-of-stock set so the side menu matches what the agent sees (see §5.3). |

No changes to `lib/agent.ts`, `lib/order.ts`, or the agent route are required — the
feature is purely a client surface over existing tool outputs.

### 4.2 The `quickAdd` callback (in `page.tsx`)

```ts
// Deterministic tap-to-add: we already hold the exact catalogId/matchId, but the
// cart is server-authoritative, so we route the add through the agent exactly like a
// spoken order. The phrase names the item so the model's search_menu → add_to_cart is
// unambiguous. Reuses submit() → cancels speech, guards isBusy, feeds the same loop.
const quickAdd = useCallback(
  (match: { name: string; vietnameseName: string }) => {
    if (isBusy) return;
    submit(`Cho mình 1 ${match.name}`);
  },
  [isBusy], // submit is stable in the component scope
);
```

> Note: `submit` is defined inside `VoicePage`; either lift it into a `useCallback` or
> pass it down. Keep the guard on `isBusy` so taps during a turn are ignored.

### 4.3 Deriving surfaced items (`lib/voice-items.ts`)

```ts
import { normalizeText, type MenuMatch } from "./menu";
import { extractSay } from "./say";

type Part = { type: string; state?: string; output?: unknown; text?: string };
type Msg = { role: string; parts?: Part[] };

const SEARCH_TOOLS = new Set(["tool-search_menu", "tool-interpret_craving"]);

/** Items the agent surfaced in its most recent turn, filtered to those it named. */
export function surfacedItems(messages: Msg[], max = 4): MenuMatch[] {
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  if (!lastAssistant) return [];

  const say = normalizeText(
    extractSay(
      (lastAssistant.parts ?? [])
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join(""),
    ),
  );

  const found = new Map<string, MenuMatch>();
  for (const part of lastAssistant.parts ?? []) {
    if (!SEARCH_TOOLS.has(part.type)) continue;
    const out = part.output as { matches?: MenuMatch[] } | undefined;
    for (const m of out?.matches ?? []) found.set(m.catalogId, m);
  }
  const all = [...found.values()];

  // Prefer items actually named in the spoken line; fall back to top-by-score.
  const named = all.filter(
    (m) => say.includes(normalizeText(m.name)) || say.includes(normalizeText(m.vietnameseName)),
  );
  const chosen = (named.length ? named : all).sort((a, b) => b.score - a.score);
  return chosen.slice(0, max);
}
```

### 4.4 `<ItemPopups>` responsibilities

- Recompute `surfacedItems(messages)` when `messages` changes, **keyed by the last
  assistant message id** so it only refreshes on a genuinely new turn (mirror the
  `spokenCountRef` guard already used for speech).
- Hold a local dismissed-set + a per-turn timeout for auto-fade.
- Render the card cluster; each card `onClick={() => quickAdd(match)}`, disabled when
  `isBusy` or out-of-stock.
- Hidden entirely before `started` (pre-"Bắt đầu" gate) and when the set is empty.

---

## 5. Data & edge cases

### 5.1 Duplicate / repeat mentions
Dedupe by `catalogId` (the `Map` in §4.3). If the same item is surfaced across
consecutive turns, treat it as a fresh popup for the new turn only.

### 5.2 `reorder_usual`
`reorder_usual` adds straight to the cart and returns `applied` names, not `matches`.
It doesn't need popups (items are already in the cart) — the receipt animation covers
it. Leave it out of `surfacedItems`.

### 5.3 Out-of-stock consistency
The client catalog (`MENU_CATALOG`) is static, but availability is dynamic
(`lib/demo.ts` `isOutOfStock`, staff toggle in `/backend`). The agent sees OOS on the
server; the side menu / popups won't unless we tell them. Options:

- **Ship v1 without live OOS** on the side menu (acceptable — the agent still refuses a
  genuinely OOS item at `place_order` with the existing substitute-recovery flow).
- **Better:** add `GET /api/menu` returning `{ catalog, outOfStock: string[], catalogVersion }`
  (wrap `loadCatalog()` + the demo OOS set). The side menu fetches once on mount and
  greys out matching rows; popups check the same set. Low cost, keeps the visual menu
  honest with what the agent will actually accept.

### 5.4 Voice-first invariants must survive
- Tapping counts as a user turn: pause the mic loop via the existing echo-guard (a
  `submit()` sets `isBusy`, which the guard already reacts to). No barge-in changes.
- Never let a popup or the panel cover the avatar's face or the mic button — they are
  the primary controls.
- The feature must be **purely additive**: with popups disabled the page behaves
  exactly as today. Gate behind a simple flag (`showMenuVisuals`, default on for demo).

---

## 6. Styling & accessibility

- Reuse `.menu-card` tokens; new classes namespaced `.voice-popup__*` and
  `.voice-menu__*` to match the `voice-*` convention.
- Cluster sits in a non-interactive layer except the cards themselves (so it never
  blocks the tap-to-repeat avatar hit area).
- Cards are real `<button>`s: `aria-label="Thêm {name} vào giỏ — {price}"`,
  keyboard-focusable, Enter/Space add. The side panel is a labelled `<aside>` with a
  toggle button (`aria-expanded`).
- Respect `prefers-reduced-motion`: skip the spring/bob, just fade.
- Popups and panel must not trigger layout shift of the phone frame — position
  `absolute`/`fixed` relative to `.voice-phone`.

---

## 7. Rejected alternative: client-side optimistic cart mutation

**Idea:** on tap, synthesize an `add_to_cart` tool-result message client-side (we hold
`catalogId`/`matchId`) and skip the agent round-trip for instant cart update.

**Why not:**
- The server re-validates and **rebuilds every cart line from the catalog** each turn
  (`sanitizeReconstructedOrder`). A synthetic line either gets dropped or forces us to
  weaken that guardrail — which is the exact protection that keeps `place_order`
  trustworthy.
- It splits the source of truth for the cart between client and agent, breaking
  `suggest_addons`, auto-voucher, and bill-optimization which all run in the agent loop
  after an add.
- The agent round-trip is cheap in the demo and gives spoken confirmation for free
  (the whole point of the voice surface).

If instant feedback is ever required, the right move is a **dedicated deterministic
tool/endpoint** the agent or client calls that still writes through
`lib/order.ts::addToCart` server-side — not a client-only mutation. Out of scope here.

---

## 8. Phased rollout

1. **P1 — popups (read-only):** `surfacedItems` + `<ItemPopups>` rendering only, no
   tap. Verifies detection against real conversations. *(No cart risk.)*
2. **P2 — tap to add:** wire `quickAdd`; confirm the agent reliably adds the tapped
   item and the receipt updates.
3. **P3 — side menu:** `<MenuPanel>` over `MENU_CATALOG`, search, tap-to-add.
4. **P4 — live OOS:** `GET /api/menu`, grey-out disabled items in panel + popups.

Each phase is independently shippable and additive.

## 9. Testing

- **Unit (`lib/voice-items.test.ts`):** feed canned `messages` (a `search_menu` turn, a
  craving turn, a paraphrase-only turn) → assert the right `MenuMatch[]` and the
  top-3 fallback. Pure function, no React.
- **Manual voice pass:** "cho mình xem burger" → cards for the burgers appear → tap
  Zinger → agent adds it, total updates, "✓ Đã thêm". Then open the side menu, search
  "com", tap Fried Chicken Rice → added. Verify mic mutes during each add and resumes.
- Regression: with the flag off, `/voice` is byte-for-byte the current behaviour.

## 10. Open questions

- Cluster vs. carousel when >4 items — cap at 4 + "+N" into the side menu is the
  proposed default.
- Should the side menu default open on desktop (wide viewport) but collapsed on the
  phone-framed kiosk? Proposed: collapsed everywhere until first interaction.
- Do popups also appear for items the agent *added* (not just searched)? Proposed: no —
  the receipt animation already covers adds; popups are for *offered* items.
