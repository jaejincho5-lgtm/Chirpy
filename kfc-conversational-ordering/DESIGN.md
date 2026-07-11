# Design

Captured from the live hand-rolled system in `app/globals.css` (single stylesheet, ~2,450
lines, no framework). Scene: bright hackathon hall, projector at 3–10m plus judges' own
phones. Strategy: committed KFC red on a warm cream canvas; Messenger blue lives only inside
the phone chat so it reads as the customer's real channel.

## Color

All tokens OKLCH, defined on `:root` in `app/globals.css`. Light scheme only
(`color-scheme: light`); the engineering console panel is the one dark surface.

| Role | Token | Value |
|---|---|---|
| Canvas | `--cream` | `oklch(0.965 0.014 82)` |
| Canvas deep | `--cream-deep` | `oklch(0.935 0.02 80)` |
| Ink | `--ink` | `oklch(0.245 0.02 40)` |
| Ink soft / faint | `--ink-soft` / `--ink-faint` | `oklch(0.42 0.015 40)` / `oklch(0.58 0.012 45)` |
| Brand red | `--red` | `oklch(0.545 0.215 27)` |
| Red deep (hover) | `--red-deep` | `oklch(0.46 0.2 27)` |
| Red tint (fills) | `--red-tint` | `oklch(0.93 0.035 27)` |
| Hairline | `--line` | `oklch(0.885 0.015 75)` |
| Chat canvas | `--chat-bg` | `oklch(0.945 0.01 250)` |
| User bubble | `--bubble-user` / `--bubble-user-ink` | `oklch(0.895 0.05 255)` / `oklch(0.3 0.05 258)` |
| Bot bubble | `--bubble-bot` | `oklch(0.995 0.003 80)` |
| Success | `--green` | `oklch(0.58 0.13 152)` |
| Console (dark) | `--console` / `--console-line` / `--console-ink` / `--console-faint` | dark warm-gray set |

Rules: no pure black/white anywhere (all neutrals warm-tinted, hue 38–82). Red is
*committed* (topbar marks, primary buttons, active states), not a ≤10% accent. Blue exists
only inside the phone. Green only for success/placed states.

## Typography

Loaded via `next/font/google` in `app/layout.tsx`:

- `--font-ui` — **Be Vietnam Pro** (300–700): all UI and body text.
- `--font-display` — **Bricolage Grotesque**: display/headline moments.
- `--font-mono` — **IBM Plex Mono**: numbers, prices, codes, trace rows. Chosen specifically
  for full Vietnamese coverage; NEVER swap in a mono without Vietnamese subsets (Spline Sans
  Mono regression, fixed 2026-07-11). Vietnamese *sentences* never render in mono — only
  numerals/codes.

## Elevation & Shape

- `--shadow-phone` — deep double shadow reserved for the phone mock.
- `--shadow-card` — soft small+ambient pair for cards/panels.
- Radii in use: 11px (inputs/buttons), 18px (cards), larger for the phone frame. Hairline
  borders use `--line`; full borders only, never side-stripe accents.

## Motion

- `--ease-out` = `cubic-bezier(0.16, 1, 0.3, 1)` (quint-like) is the only easing.
- 150–300ms state transitions; `prefers-reduced-motion` fully supported (~line 1976).
- The chicken's procedural animation lives in /voice and is off-limits for restyling.

## Layout & Components

Single stylesheet, BEM-ish naming (`.block__part`, state via `aria-*` or modifier class):

- **Stage frame** (`.stage`, `.topbar`): cream canvas, hairline-divided topbar with red
  brand mark.
- **Three-panel workspace** (`/`): director rail · phone mock (`.phone`) · dark engineering
  console (`.trace-console`).
- **Phone mock**: the customer surface — Messenger-style header, chat bubbles, quick-reply
  chips, suggestion accept/decline chips, bill-swap card, typing indicator.
- **/backend console grid**: Odoo-style module switcher + dense operator modules
  (orders queue, customers, reengage predictor, vouchers, promotions, stock, agent-ops).
- **/decisions matrix**: server-rendered decision-matrix table with a fixed 6-slot
  categorical palette (documented in-file, contrast-checked with visible labels).
- **/backend/login** (`.ops-login`): centered card gate, red primary button.

## Breakpoints

10 media queries, key ones at 1280/1024/900/760px; module grids collapse to single column,
phone mock stays centered. No horizontal scroll at any width.

## Copy conventions

Customer-facing: Vietnamese only, warm, anh/chị/em etiquette, ≤1 emoji per message.
Operator-facing: Vietnamese labels with established English internals (KPI names, trace).
Buttons are verbs; no trailing periods on labels.
