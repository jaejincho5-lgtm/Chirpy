import { sendChannelReply } from "@/lib/channel";
import { getConvoStore } from "@/lib/convo-store";
import { getTakeoverStore } from "@/lib/takeover-store";
import { logTurn } from "@/lib/turn-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// /api/takeover: human-in-the-loop console behind /backend Inbox.
// Gated by the ops cookie in proxy.ts (same stance as /api/console).
//
//   GET                                     → recent conversations + transcript + takeover flags
//   POST {action:"set", convoId, active}    → pause/resume the agent on one conversation
//   POST {action:"reply", convoId, text}    → send a human reply through the channel Send API
//
// A human reply auto-activates takeover: replying IS stepping in, and it
// refreshes the TTL so the conversation stays theirs while they're typing.

function parseConvoId(convoId: unknown): { channel: "messenger"; senderId: string } | null {
  if (typeof convoId !== "string") return null;
  const [channel, ...rest] = convoId.split(":");
  const senderId = rest.join(":");
  if (channel !== "messenger" || !senderId) return null;
  return { channel, senderId };
}

export async function GET() {
  try {
    const [convos, activeIds] = await Promise.all([
      getConvoStore().listRecent(20),
      getTakeoverStore().listActive(),
    ]);
    const active = new Set(activeIds);
    return Response.json({
      ok: true,
      conversations: convos.map((convo) => ({
        id: convo.id,
        customerId: convo.customerId,
        updatedAt: convo.updatedAt,
        takeover: active.has(convo.id),
        lastMessage: convo.messages.at(-1) ?? null,
        messages: convo.messages,
      })),
    });
  } catch (error) {
    return Response.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: { action?: string; convoId?: string; active?: boolean; text?: string } = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const parsed = parseConvoId(body.convoId);
  if (!parsed) return Response.json({ ok: false, error: "invalid_convoId" }, { status: 400 });
  const { channel, senderId } = parsed;
  const convoId = body.convoId as string;

  if (body.action === "set") {
    if (typeof body.active !== "boolean") {
      return Response.json({ ok: false, error: "active_must_be_boolean" }, { status: 400 });
    }
    try {
      await getTakeoverStore().set(convoId, body.active);
    } catch (error) {
      return Response.json({ ok: false, error: (error as Error).message }, { status: 500 });
    }
    return Response.json({ ok: true, convoId, takeover: body.active });
  }

  if (body.action === "reply") {
    const text = (body.text ?? "").trim();
    if (!text) return Response.json({ ok: false, error: "empty_text" }, { status: 400 });

    // Replying claims (or extends) the takeover BEFORE sending, so a customer
    // message racing in during the send parks for the human instead of waking
    // the agent mid-handover. Fail the whole reply if the claim fails —
    // otherwise the human and the agent would both answer this customer.
    try {
      await getTakeoverStore().set(convoId, true);
    } catch (error) {
      return Response.json({ ok: false, error: (error as Error).message }, { status: 500 });
    }

    const delivery = await sendChannelReply(channel, senderId, text);

    // Persist like every other reply path: the transcript is the next-turn
    // LLM context when the agent resumes, so the human's words must be in it.
    const store = getConvoStore();
    const convo = await store.get(convoId).catch(() => null);
    const customerId = convo?.customerId ?? `msgr_${senderId.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`.slice(0, 40);
    await store
      .save({
        id: convoId,
        customerId,
        order: convo?.order ?? null,
        messages: [...(convo?.messages ?? []), { role: "assistant", content: text }],
        updatedAt: new Date().toISOString(),
      })
      .catch(() => null);

    void logTurn({
      convoKey: convoId,
      customerId,
      channel,
      model: "human-operator",
      userText: [...(convo?.messages ?? [])].reverse().find((m) => m.role === "user")?.content ?? "(operator initiated)",
      replyText: text,
      toolCalls: ["human-takeover"],
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    });

    return Response.json({ ok: true, convoId, sent: delivery.sent, sendReason: delivery.reason });
  }

  return Response.json({ ok: false, error: "unknown_action" }, { status: 400 });
}
