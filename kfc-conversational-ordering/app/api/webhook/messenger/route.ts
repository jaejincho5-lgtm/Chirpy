import { extractMessengerMessages, forwardToAgent, verifyMessengerSignature } from "@/lib/channel";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
// A full agent turn ran 16.5s live; never let the platform default cut the
// function off mid-turn (the reply is sent via the Send API before return).
export const maxDuration = 60;

// Facebook redelivers a webhook it hasn't seen acknowledged within ~20s — an
// agent turn near that budget means the SAME message is processed twice and
// the cart doubles (seen live 2026-07-11, two runs 19s apart). Claim each
// message.mid in kfc_webhook_events before running the agent; a unique-key
// conflict means another delivery already owns it, so drop the duplicate.
// Without Supabase (local/webhook-stub runs) dedup is skipped — single-instance
// dev never sees Facebook retries.
async function claimMessage(mid: string | undefined): Promise<boolean> {
  if (!mid) return true;
  try {
    const { error } = await supabaseAdmin().from("kfc_webhook_events").insert({ mid });
    if (error?.code === "23505") return false; // already processed by an earlier delivery
    return true; // claimed (or table missing / transient error: fail open, worst case = old behavior)
  } catch {
    return true;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const challenge = url.searchParams.get("hub.challenge");
  const token = url.searchParams.get("hub.verify_token");
  const expected = process.env.MESSENGER_VERIFY_TOKEN;

  if (mode === "subscribe" && challenge && (!expected || token === expected)) {
    return new Response(challenge, { status: 200 });
  }

  return Response.json({
    ok: true,
    channel: "messenger",
    status: "verify_stub",
    note: "Set MESSENGER_VERIFY_TOKEN before enabling the real webhook.",
  });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  // FAIL CLOSED on prod: stub mode (no MESSENGER_APP_SECRET → signature check
  // skipped) is for localhost + the channel eval harness ONLY. On the public
  // Vercel URL an unsigned POST runs the agent and burns real gateway credits —
  // verified live 2026-07-06 before this guard existed.
  if (process.env.VERCEL_ENV === "production" && !process.env.MESSENGER_APP_SECRET) {
    return Response.json(
      { ok: false, channel: "messenger", error: "webhook_disabled", note: "Set MESSENGER_APP_SECRET to enable the production webhook." },
      { status: 503 },
    );
  }

  // Verify X-Hub-Signature-256 when MESSENGER_APP_SECRET is configured.
  if (!verifyMessengerSignature(rawBody, signature, process.env.MESSENGER_APP_SECRET)) {
    return Response.json({ ok: false, channel: "messenger", error: "invalid_signature" }, { status: 401 });
  }

  let payload: unknown = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = {};
  }

  const inbound = extractMessengerMessages(payload);
  const claims = await Promise.all(inbound.map((message) => claimMessage(message.mid)));
  const fresh = inbound.filter((_, i) => claims[i]);
  const results = await Promise.all(
    fresh.map((message) => forwardToAgent("messenger", message.senderId, message.text)),
  );
  const forwardedToAgent = results.some((result) => result.forwarded);

  return Response.json(
    {
      ok: true,
      channel: "messenger",
      forwardedToAgent,
      messageCount: fresh.length,
      duplicatesDropped: inbound.length - fresh.length,
      results,
      note: inbound.length
        ? "Inbound text normalized and forwarded to the agent runtime."
        : "No text messages in payload (delivery/read events are ignored).",
    },
    { status: 202 },
  );
}
