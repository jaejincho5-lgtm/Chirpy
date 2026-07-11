---
description: "/backend standards pass: one layout grammar across all modules, real icons, disciplined data display, empty states — judge-clickable"
---

You are doing the **standards pass** on the `/backend` operator console of
`kfc-conversational-ordering/`. Judges WILL click around it — it currently reads as eight modules
built by eight different people. Your job: make every module follow ONE visual grammar so the
console looks like a shipped product. **Zero functional changes** — visuals, structure, and
shared components only. All work happens inside `kfc-conversational-ordering/`.

## Context (read first)

- `app/backend/page.tsx` — the shell: module tabs, every module stays MOUNTED (hidden via CSS)
  so the Director's BroadcastChannel + polling never reset. **Do not change that mechanism.**
- `app/backend/modules/*.tsx` — director, orders, customers, reengage, vouchers, promotions,
  stock, agent-ops. `shared.tsx` exists — push common pieces INTO it.
- `app/globals.css` — the oklch palette + fonts (Be Vietnam Pro, Bricolage Grotesque, Spline
  Sans Mono). Build on these tokens; add CSS variables for anything repeated.
- The Director module powers the live demo link to `/user` — after every change, verify its
  controls still steer `/user` in a second tab.

## Task

### 1. Shared primitives (build once in `modules/shared.tsx`, then adopt everywhere)

- `ModuleHeader` — module title + one-line description + primary action slot. Same size/spacing
  in every module.
- `KpiStrip` — a row of stat tiles (label, value, optional delta). Values in tabular-nums.
- `Card` / `CardGrid` — one radius, one border, one padding scale. Kill all ad-hoc card styles.
- `EmptyState` — icon + one sentence + optional action. EVERY list/table that can be empty gets
  one (a judge clicking a module with no data must see something designed, never a blank div).
- `StatusBadge` — colored dot + Vietnamese label for every enum in the app (order stages
  placed/preparing/ready/completed/cancelled, voucher active/inactive, stock on/off, nudge gate
  results). No raw enum strings anywhere in the UI.
- `fmtVnd` / `fmtTimeAgo` — ONE money formatter (₫, thousand separators, consistent) and ONE
  humanized timestamp ("3 phút trước") — replace every inline formatting expression.

### 2. Layout grammar (apply to each module, in this order)

director → orders → customers → reengage → vouchers → promotions → stock → agent.
Every module becomes: `ModuleHeader` → (optional) `KpiStrip` → content in `Card`s. Consistent
paddings, aligned grids, capped content width (~1200px), compact operator-density rows (this is
a console — cut dead vertical space). Numbers right-aligned, text left-aligned, timestamps
humanized with the shared formatter.

### 3. Chrome polish

- Replace the emoji tab icons in `page.tsx`'s `MODULES` with a small consistent inline-SVG icon
  set (single stroke style, `currentColor` so active/inactive tinting is free). Keep labels.
- Active tab: clear selected treatment + a subtle animated underline/indicator.
- Loading: any module that fetches shows a lightweight skeleton or spinner INSIDE its cards on
  first load, not a blank area.

### 4. Guardrails

- Do not rename module files, exported component names, API calls, polling intervals, or state
  logic. Presentation-layer edits only.
- Do not touch `/user` or `/voice` styles (other goals own them). Shared `globals.css` additions
  must be namespaced (`.bk-*` or under a `.stage` scope) so nothing leaks.
- Commit module-by-module if the session is long, so a mistake never loses the whole pass.

## Acceptance checklist

- [ ] All 8 modules: header/KPI/cards grammar, no ad-hoc card styles remaining.
- [ ] Zero raw enum strings, zero unformatted VND amounts, zero ISO timestamps visible.
- [ ] Every emptiable list has an EmptyState (verify by fresh-booting with no data).
- [ ] Tabs use the SVG icons; active state is obvious; nothing shifts on hover.
- [ ] Director → `/user` live steering still works (two-tab test). Orders can still be advanced.
      Vouchers can still be created/toggled.
- [ ] `npx tsc --noEmit`, `npm test`, `npm run build` pass; no console errors clicking through
      all modules.

## Verify, then commit

Click through every module with dev tools open, then run the two-tab Director test. Commit per
module or one commit: `refactor(backend): unified console grammar — shared primitives, icons,
formatters, empty states`.
