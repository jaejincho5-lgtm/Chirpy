---
description: "/voice becomes always-listening (driver mode): auto speech detection, mic button = mute toggle, echo-guarded"
---

You are implementing the **hands-free driver mode** for the `/voice` page of
`kfc-conversational-ordering/`. All work happens inside that folder.

## Context (read these files first)

- `app/voice/page.tsx` — the voice page. Today it is **push-to-talk**: `startListening()` creates
  a one-shot `SpeechRecognition` (`continuous: false`, `lang: "vi-VN"`), the mic `<button>` uses
  `onMouseDown/onMouseUp/onTouchStart/onTouchEnd` to hold-to-talk, and `recognition.onend` submits
  the final transcript. State: `listening`, `speaking`, `isBusy`, plus a derived
  `state: "think" | "listen" | "speak" | "idle"` that drives `voice-stage--*` CSS classes.
- `lib/speech.ts` — `getSpeaker()` returns the TTS `Speaker`; `speaking` is true while it talks.
- `app/globals.css` — contains the `voice-*` styles.

**The scenario:** the user is driving. They cannot hold a button. The page must listen by itself,
detect when they stop talking, and submit — the button's only job is to MUTE.

## Task

1. **Always-listening loop.** Replace push-to-talk with an auto-restarting recognition loop:
   - Keep `continuous: false` and `interimResults: true` — the browser's own endpointing decides
     when an utterance is finished (recognition fires `onend` after silence). On `onend`: if a
     non-empty final transcript exists, `submit()` it; then **restart the loop** (unless muted,
     or the agent is busy, or TTS is speaking).
   - Add a safety net: some Chrome builds hang without firing `onend`. Track the last
     interim-update timestamp; if there's a non-empty transcript and no change for **1400ms**,
     call `recognition.stop()` to force finalization.
   - Start the loop automatically once the user has interacted with the page at least once
     (browsers require a gesture before mic + audio). Concretely: show a single large
     **"Bắt đầu" (Start)** overlay button on first load; tapping it requests mic permission,
     speaks the greeting, and starts the loop. After that, everything is hands-free.
2. **Echo guard (critical).** The chicken's own TTS voice WILL trigger the mic. While
   `speaking === true` OR `isBusy === true`, the recognition loop must be **paused** (stop the
   recognizer, don't restart). Resume the loop automatically the moment both are false again
   (hook the existing `onEnd` callback of `getSpeaker().speak` and the `isBusy` transitions via a
   `useEffect`). No barge-in in this version — safe demo mode.
3. **Mic button = mute toggle.** Replace the hold-to-talk handlers with a single `onClick` that
   toggles a new `muted` state:
   - Muted: stop recognition, show a red mic-with-slash state, label **"Mic đang tắt — chạm để
     bật"**. The status dot goes gray.
   - Unmuted: resume the loop, label **"Đang nghe — chạm để tắt mic"**, green pulsing ring.
   - The button must be BIG (≥72px tap target) and its state readable at arm's length.
4. **Error handling.** `onerror` cases: `"not-allowed"`/`"service-not-allowed"` → set `muted`,
   show the typed-input fallback with the existing message; `"no-speech"`/`"aborted"` → silently
   restart the loop; anything else → restart once, and if it errors twice in a row, fall back to
   showing the typed input. Never leave the page in a dead state with no way to interact.
5. **Status UX.** Update the `statusLabel` texts for the new model (`"đang nghe…"` should be the
   *default* state now). Keep the interim transcript display in the bubble exactly as it works
   today. Keep the typed-input fallback fully working (it's the on-stage fallback).
6. Do NOT touch `lib/speech.ts` internals, the transport, or the agent request body — this goal
   is interaction-model only.

## Acceptance checklist

- [ ] Open `/voice` in Chrome/Edge → tap "Bắt đầu" once → speak "cho mình một burger zinger" and
      then stop talking → it submits by itself, no button touched.
- [ ] While the chicken is speaking its reply, saying something does NOT get picked up (mic
      paused, visible in the status). When it finishes, listening resumes automatically.
- [ ] Tap the mic button → muted (red, clear label), nothing is picked up. Tap again → resumes.
- [ ] Deny mic permission in a fresh profile → page falls back to typed input with a clear message.
- [ ] Multiple turns in a row work without any manual restart (loop survives ≥4 exchanges).
- [ ] `npx tsc --noEmit`, `npm test`, and `npm run build` all pass.

## Verify, then commit

Run the dev server (`npm run dev`, use localhost) and walk the checklist above out loud — this is
a voice feature, test it by talking. Then propose a commit:
`feat(voice): hands-free driver mode — auto-listen loop, mute-toggle mic, echo guard`.
