import { createHash } from "node:crypto";
import { speakableText } from "@/lib/speech";

// ElevenLabs Flash TTS with a server-side audio cache. Repeated phrases (the
// greeting, the three fillers, cached agent answers) play instantly on the
// second request. Degrades to 503 → the client uses the browser voice — the
// demo must never die on a missing key or a quota error.

const CACHE_MAX = 200;
// Insertion-ordered Map used as an LRU: on hit we re-insert to mark it recent.
const cache = new Map<string, Buffer>();

function lruGet(key: string): Buffer | undefined {
  const value = cache.get(key);
  if (value) {
    cache.delete(key);
    cache.set(key, value);
  }
  return value;
}

function lruSet(key: string, value: Buffer) {
  cache.set(key, value);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

function audioResponse(buf: Buffer, cacheState: "hit" | "miss") {
  // Copy into a fresh Uint8Array so the cached Buffer is never detached.
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: { "Content-Type": "audio/mpeg", "x-tts-cache": cacheState },
  });
}

export async function POST(req: Request) {
  let raw = "";
  try {
    raw = String(((await req.json()) as { text?: unknown })?.text ?? "");
  } catch {
    raw = "";
  }
  // Same emoji-stripping the browser voice uses; bound cost with a 500-char cap.
  const clean = speakableText(raw).slice(0, 500);
  if (!clean) return new Response(null, { status: 400 });

  const key = createHash("sha256").update(clean).digest("hex");
  const cached = lruGet(key);
  if (cached) return audioResponse(cached, "hit");

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.warn("[tts] ELEVENLABS_API_KEY not set — client will use the browser voice");
    return new Response(null, { status: 503 });
  }

  // Default: Jessica (premade, in every workspace — free plan can use it via API).
  // Rachel (21m00Tcm4TlvDq8ikWAM) is a LIBRARY voice → 402 paid_plan_required on free.
  const voiceId = process.env.ELEVENLABS_VOICE_ID || "cgSgspJ2msm6clMCkdW9";
  try {
    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_64`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean, model_id: "eleven_flash_v2_5" }),
      },
    );
    if (!upstream.ok) {
      const reason = await upstream.text().then((t) => t.slice(0, 300)).catch(() => "");
      console.warn(`[tts] ElevenLabs responded ${upstream.status} — falling back to browser voice. ${reason}`);
      return new Response(null, { status: 503 });
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    lruSet(key, buf);
    return audioResponse(buf, "miss");
  } catch (error) {
    console.warn("[tts] request failed:", (error as Error).message);
    return new Response(null, { status: 503 });
  }
}
