---
description: "Real TTS for /voice: ElevenLabs Flash via /api/tts, amplitude lip-sync, server audio cache, instant acknowledgment filler"
---

You are giving the `/voice` chicken a **real voice**: ElevenLabs TTS with true amplitude-driven
lip-sync, a server-side audio cache so repeated phrases play instantly, and an instant spoken
acknowledgment so the avatar never sits silent while the agent thinks. All work happens inside
`kfc-conversational-ordering/`.

## Context (read these files first)

- `lib/speech.ts` — a `Speaker` interface (`speak(text, {onLevel, onEnd})`, `cancel()`,
  `supported()`) with one implementation, `BrowserSpeaker` (browser `speechSynthesis`). It was
  **designed for exactly this drop-in** — the comment says so. `speakableText()` strips emoji
  before speech; every new Speaker must use it too. `onLevel(v)` drives the avatar's mouth; today
  it's a fake pulse on word boundaries because speechSynthesis exposes no audio stream.
- `app/voice/page.tsx` — calls `getSpeaker().speak(say, ...)` per completed assistant message.
- Env: `ELEVENLABS_API_KEY` may or may not be set — **everything must degrade gracefully to
  `BrowserSpeaker` when it's absent or when a request fails.** The demo must never die on quota.

## Task

1. **Server route `app/api/tts/route.ts`** (POST, `{ text: string }`):
   - Clean the text with `speakableText()`. Empty after cleaning → 400.
   - Cap input at 500 chars (agent replies are short; this bounds cost).
   - **Cache first:** an in-memory LRU `Map` keyed by a hash of the cleaned text (cap ~200
     entries). Hit → return the stored audio immediately with header `x-tts-cache: hit`.
   - Miss → call ElevenLabs: `POST https://api.elevenlabs.io/v1/text-to-speech/{voiceId}` with
     `model_id: "eleven_flash_v2_5"` (fast, supports Vietnamese), `output_format: mp3_44100_64`,
     header `xi-api-key: process.env.ELEVENLABS_API_KEY`. Voice id from `ELEVENLABS_VOICE_ID`
     env with a sensible multilingual default. Store the resulting buffer in the LRU, return it
     as `audio/mpeg` with `x-tts-cache: miss`.
   - No key configured or upstream error → **503 with empty body** (the client treats 503 as
     "use the browser voice"). Log one concise server line either way.
2. **`ElevenLabsSpeaker` in `lib/speech.ts`** implementing `Speaker`:
   - `speak()`: `fetch("/api/tts", ...)` → on 503/network failure, delegate the SAME call to
     `BrowserSpeaker` (and remember the failure for 60s so we don't re-try every utterance) →
     on success, decode via WebAudio (`AudioContext.decodeAudioData`), play through a
     `GainNode` + **`AnalyserNode`**, and run a `requestAnimationFrame` loop computing RMS from
     `getByteTimeDomainData`, mapped to 0..1, calling `onLevel(v)` — **real lip-sync from real
     amplitude**. On `source.onended` (or cancel) → stop the rAF loop, `onLevel(0)`, `onEnd()`.
   - `cancel()`: stop the current source + rAF loop safely (guard double-stops).
   - Reuse ONE `AudioContext` (created lazily on first user gesture — `/voice` already has the
     "Bắt đầu" tap from the hands-free goal; resume the context there if suspended).
   - `getSpeaker()` now returns the ElevenLabs speaker (which self-falls-back). Keep the module
     interface unchanged so `page.tsx` needs no edits for playback.
3. **Instant acknowledgment filler** (perceived latency — voice UIs are judged on
   time-to-first-sound): in `app/voice/page.tsx`, when a message is submitted, start a 700ms
   timer; if the agent is still busy when it fires, speak a short filler picked round-robin from
   `["Dạ, để em xem…", "Dạ có ngay ạ…", "Ok ạ, chờ em xíu nha…"]` (subtitle updates too). Cancel
   the filler immediately if the real reply arrives first, and make sure the real reply always
   cancels/queues after the filler cleanly (no overlapping audio — `speak` should `cancel()` any
   current utterance first, which it already does upstream; verify).
4. **Pre-warm:** on `/voice` mount, fire-and-forget POST `/api/tts` for the greeting line and the
   three fillers so their audio is cached before the first interaction.

## Acceptance checklist

- [ ] With `ELEVENLABS_API_KEY` set: the chicken speaks Vietnamese in a natural voice and the
      mouth visibly tracks loudness (not uniform pulsing).
- [ ] Speak the same phrase twice → second server response has `x-tts-cache: hit` (check the
      network tab) and starts noticeably faster.
- [ ] Remove the key (or kill the network to elevenlabs.io) → everything still works with the
      browser voice; no crash, no silent dead state.
- [ ] Ask something that takes a while → within ~1s you hear "Dạ, để em xem…", then the real
      answer, with no audio overlap.
- [ ] Emoji in replies are never spoken (existing `speakableText` rule holds).
- [ ] `npx tsc --noEmit`, `npm test`, `npm run build` pass.

## Verify, then commit

Test by talking to it on localhost with the key set AND with it unset. Commit:
`feat(voice): ElevenLabs Flash TTS with amplitude lip-sync, server audio cache, instant filler`.
