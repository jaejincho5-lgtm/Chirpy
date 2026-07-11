import { extractMessengerMessages, forwardToAgent, verifyMessengerSignature } from "@/lib/channel";

export const runtime = "nodejs";

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
  const results = await Promise.all(
    inbound.map((message) => forwardToAgent("messenger", message.senderId, message.text)),
  );
  const forwardedToAgent = results.some((result) => result.forwarded);

  return Response.json(
    {
      ok: true,
      channel: "messenger",
      forwardedToAgent,
      messageCount: inbound.length,
      results,
      note: inbound.length
        ? "Inbound text normalized and forwarded to the agent runtime."
        : "No text messages in payload (delivery/read events are ignored).",
    },
    { status: 202 },
  );
}
