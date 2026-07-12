// Text-to-speech for the /voice ambassador, behind a swappable interface so a
// higher-quality provider (ElevenLabs) can drop in later. Today: browser
// speechSynthesis with a Vietnamese voice. The viseme "level" that drives the
// avatar's mouth is pulsed on each word boundary (speechSynthesis exposes no
// audio stream to analyze), then decayed toward 0 by the render loop.

export interface Speaker {
  speak(text: string, callbacks: { onLevel: (v: number) => void; onEnd: () => void }): void;
  cancel(): void;
  supported(): boolean;
}

/**
 * What the voice actually says. The agent's replies carry emoji for the chat
 * bubble, but TTS engines verbalize them ("gà rán" followed by "poultry leg
 * emoji" kills the illusion) — so every pictograph, variation selector, ZWJ,
 * skin-tone modifier, and regional-indicator pair is stripped before the
 * utterance. The display text keeps its emoji; only the speech is cleaned.
 * Exported so any future Speaker (ElevenLabs) applies the same rule.
 */
export function speakableText(text: string): string {
  return text
    .replace(
      // pictographs · skin tones · regional indicators · ZWJ · variation selectors · combining keycap
      /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}\u200D\uFE0E\uFE0F\u20E3]/gu,
      "",
    )
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,!?…])/g, "$1")
    .trim();
}

class BrowserSpeaker implements Speaker {
  private current: SpeechSynthesisUtterance | null = null;

  supported(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  private pickVoice(): SpeechSynthesisVoice | null {
    const voices = window.speechSynthesis.getVoices();
    return (
      voices.find((v) => v.lang.toLowerCase().startsWith("vi")) ??
      voices.find((v) => v.lang.toLowerCase().startsWith("en")) ??
      voices[0] ??
      null
    );
  }

  speak(text: string, callbacks: { onLevel: (v: number) => void; onEnd: () => void }): void {
    const speakable = speakableText(text);
    if (!this.supported() || !speakable) {
      callbacks.onEnd();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(speakable);
    const voice = this.pickVoice();
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang ?? "vi-VN";
    utterance.rate = 1.05;
    utterance.pitch = 1.15; // slightly bright — mascot-ish
    // Word-boundary pulses drive the beak flap; the loop decays between them.
    utterance.onboundary = () => callbacks.onLevel(0.4 + Math.random() * 0.5);
    utterance.onend = () => {
      callbacks.onLevel(0);
      callbacks.onEnd();
    };
    utterance.onerror = () => {
      callbacks.onLevel(0);
      callbacks.onEnd();
    };
    this.current = utterance;
    window.speechSynthesis.speak(utterance);
  }

  cancel(): void {
    if (this.supported()) window.speechSynthesis.cancel();
    this.current = null;
  }
}

/**
 * Real voice: ElevenLabs Flash via /api/tts, played through WebAudio with an
 * AnalyserNode so the avatar's mouth tracks true amplitude (RMS), not a fake
 * pulse. Self-falls-back to BrowserSpeaker when the server returns 503 (no key /
 * quota) or the network fails — and remembers that failure for 60s so it does
 * not re-hit a dead endpoint on every utterance. The module interface is
 * unchanged, so page.tsx needs no edits for playback.
 */
class ElevenLabsSpeaker implements Speaker {
  private fallback = new BrowserSpeaker();
  private audioCtx: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private rafId: number | null = null;
  private failedUntil = 0;

  supported(): boolean {
    if (typeof window === "undefined") return false;
    const hasAudio = "AudioContext" in window || "webkitAudioContext" in window;
    return hasAudio || this.fallback.supported();
  }

  // One shared AudioContext, created lazily. Browsers start it suspended until a
  // user gesture; we resume on each speak (the first speak follows a tap/mic).
  private ctx(): AudioContext | null {
    if (typeof window === "undefined") return null;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    if (!this.audioCtx) this.audioCtx = new AC();
    if (this.audioCtx.state === "suspended") void this.audioCtx.resume().catch(() => {});
    return this.audioCtx;
  }

  speak(text: string, callbacks: { onLevel: (v: number) => void; onEnd: () => void }): void {
    const speakable = speakableText(text);
    if (!speakable) {
      callbacks.onEnd();
      return;
    }
    // Cancel any current utterance first so audio never overlaps.
    this.cancel();
    if (Date.now() < this.failedUntil) {
      this.fallback.speak(text, callbacks);
      return;
    }
    void this.playRemote(speakable, text, callbacks);
  }

  private async playRemote(
    speakable: string,
    original: string,
    callbacks: { onLevel: (v: number) => void; onEnd: () => void },
  ): Promise<void> {
    const ctx = this.ctx();
    if (!ctx) {
      this.fallback.speak(original, callbacks);
      return;
    }
    let buffer: AudioBuffer;
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: speakable }),
      });
      if (response.status === 503 || !response.ok) throw new Error(`tts ${response.status}`);
      buffer = await ctx.decodeAudioData(await response.arrayBuffer());
    } catch {
      // Remember the failure so we don't re-try the network every utterance.
      this.failedUntil = Date.now() + 60_000;
      this.fallback.speak(original, callbacks);
      return;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const gain = ctx.createGain();
    source.connect(analyser);
    analyser.connect(gain);
    gain.connect(ctx.destination);
    this.currentSource = source;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      callbacks.onLevel(Math.min(1, rms * 3.2)); // speech RMS is small — scale to 0..1
      this.rafId = requestAnimationFrame(tick);
    };

    source.onended = () => {
      this.stopLoop();
      callbacks.onLevel(0);
      this.currentSource = null;
      callbacks.onEnd();
    };
    this.rafId = requestAnimationFrame(tick);
    source.start(0);
  }

  private stopLoop() {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  cancel(): void {
    this.fallback.cancel();
    this.stopLoop();
    if (this.currentSource) {
      // Suppress onended so a cancelled utterance never fires its onEnd.
      this.currentSource.onended = null;
      try {
        this.currentSource.stop();
      } catch {
        // already stopped — safe to ignore
      }
      this.currentSource = null;
    }
  }
}

let speaker: Speaker | null = null;

// Pitch-day kill-switch: the browser engine's cancel() is synchronous, so two
// utterances can never overlap. The ElevenLabs path can double-speak — an
// in-flight /api/tts fetch survives cancel() and still calls source.start()
// (seen live 2026-07-12: filler + reply talking at once). Flip back to
// ElevenLabsSpeaker only after that fetch race is generation-guarded.
const USE_ELEVENLABS = false;

export function getSpeaker(): Speaker {
  if (!speaker) speaker = USE_ELEVENLABS ? new ElevenLabsSpeaker() : new BrowserSpeaker();
  return speaker;
}
