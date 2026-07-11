---
description: "Visual overhaul of /voice: premium kiosk look, receipt choreography, unmistakable state design, zero first-interaction jank"
---

You are doing the **visual polish pass** on the `/voice` page of `kfc-conversational-ordering/` —
it is the centerpiece of tomorrow's demo and must read *premium KFC kiosk*, not *hackathon debug
page*. Work only inside that folder. This goal is presentation-only: do NOT change the agent
request flow, recognition logic, or TTS logic (other goals own those).

## Context (read first)

- `app/voice/page.tsx` — structure: phone frame (`voice-phone` + notch), header (brand + status
  dot + cart chip), avatar stage (`voice-glow`, `voice-floor`, VRM canvas, subtitle bubble,
  receipt aside), controls (mic + typed fallback). Derived `state` drives `voice-stage--{state}`.
- `app/voice/chicken-stage.tsx` — the three.js VRM chicken (don't restructure; you may adjust
  lighting/camera/backdrop values).
- `app/globals.css` — all `voice-*` styles live here, plus the project's oklch palette and fonts
  (Be Vietnam Pro, Bricolage Grotesque, Spline Sans Mono). Reuse those tokens; add no new fonts.
- The demo runs on a **phone (390×844)** mirrored to a projector, possibly in sunlight — contrast
  and size matter more than subtlety.

## Task — work through this checklist top to bottom

1. **Stage depth.** The chicken must sit IN a space, not float on a flat color: radial-gradient
   floor pool of light, soft contact shadow under the avatar, subtle vignette at the phone-frame
   edges, KFC red anchored (use it decisively in the header + mic ring; keep the stage itself
   warm neutral so the red pops).
2. **State choreography — each state unmistakable at a glance from 2 meters:**
   - `listen`: animated green pulse rings radiating from the mic + a slim "listening" waveform or
     ring around the avatar.
   - `think`: the glow shifts to amber and slowly breathes; status label animates ("đang nghĩ…"
     with cycling dots).
   - `speak`: warm white/red glow synced-feeling (it already receives `visemeLevel` via the
     stage; add a CSS-level glow intensity tied to the `is-speaking` class).
   - `idle`: everything calm, slow breathing scale on the glow. Transitions between states are
     eased (~250ms), never a hard snap.
3. **Subtitle bubble.** Min font-size 20px, high contrast, max ~3 lines with ellipsis, smooth
   enter (translateY + fade). User interim text visually distinct from the chicken's speech
   (different accent border + the existing "Bạn"/"Đại sứ Gà" tag made more prominent). It must
   NEVER overlap the receipt — reserve layout space.
4. **Receipt choreography.** The receipt aside slides in the first time an item lands; each new
   line item animates in (fade + slight rise); the total **ticks** when it changes (brief scale +
   color flash on the total row). Prices in the mono font with tabular figures. When the order
   reaches `placed`, the receipt gets a "✓ Đã đặt — #<order>" stamp treatment.
5. **Header.** Cart chip: item count + total, animates on change. Status dot colors match the
   state choreography. Tidy alignment at 390px — nothing wraps or collides.
6. **Zero first-interaction jank.** Preload so the FIRST exchange is smooth on stage: the VRM
   should be loading immediately on mount (verify `dynamic` import mounts the stage right away
   behind the start overlay, not after first interaction); if a start overlay exists (hands-free
   goal), style it as a proper branded cover (logo, one large button, one line of copy) — that's
   the first thing judges see.
7. **Small screens sweep.** At 390×844: no horizontal scroll, mic reachable by thumb, receipt
   doesn't cover the chicken's face, safe-area padding at the bottom.
8. Keep all existing class names/behavior hooks working (`voice-stage--*`, `is-speaking`,
   `is-listening`) — other goals depend on them.

## Acceptance checklist

- [ ] Side-by-side before/after screenshot at 390×844 looks like a different (real) product.
- [ ] A stranger can tell listening vs thinking vs speaking WITHOUT reading the label.
- [ ] Add item → receipt slides in, line animates, total ticks. Place order → placed stamp.
- [ ] No layout shift or overlap in any state at 390×844 and at desktop width.
- [ ] `npm run build` passes; no console errors on `/voice`.

## Verify, then commit

Open `/voice` in responsive mode at 390×844, run one full order, watch every transition. Commit:
`feat(voice): premium kiosk visual pass — stage depth, state choreography, receipt animation`.
