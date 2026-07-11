// Channel webhook helpers: signature verification + payload normalization +
// forwarding into the agent. Signature checks are structured for the real
// provider (Messenger X-Hub-Signature-256) and are skipped only when
// the corresponding secret is unset (stub / local mode).

import { createHmac, timingSafeEqual } from "node:crypto";
import { extractSay } from "./say";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Messenger signs the raw request body with the app secret:
 *   X-Hub-Signature-256: sha256=<hex hmac>
 * Returns true (skip) when no app secret is configured.
 */
export function verifyMessengerSignature(rawBody: string, header: string | null, appSecret?: string): boolean {
  if (!appSecret) return true;
  if (!header) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  return safeEqual(header, expected);
}

type MessengerPayload = {
  entry?: Array<{
    messaging?: Array<{
      sender?: { id?: string };
      message?: { text?: string; mid?: string };
    }>;
  }>;
};

export function extractMessengerMessages(
  payload: unknown,
): Array<{ senderId: string; text: string; mid?: string }> {
  const out: Array<{ senderId: string; text: string; mid?: string }> = [];
  const entries = (payload as MessengerPayload)?.entry ?? [];
  for (const entry of entries) {
    for (const event of entry.messaging ?? []) {
      const text = event.message?.text;
      if (text) out.push({ senderId: event.sender?.id ?? "unknown", text, mid: event.message?.mid });
    }
  }
  return out;
}

// extractSay moved to lib/say.ts (pure, no node:crypto) so the client /voice
// bundle can use it. Re-exported here for existing server-side importers.
export { extractSay };

export type ChannelSendResult = { sent: boolean; status?: number; reason?: string };

/**
 * Deliver a reply back through the channel's send API. No-ops (sent:false)
 * when the channel token is not configured, so local/simulated runs still work.
 */
export async function sendChannelReply(
  channel: "messenger",
  senderId: string,
  text: string,
): Promise<ChannelSendResult> {
  // Messenger caps text messages at 2000 chars.
  const body = text.length > 1900 ? `${text.slice(0, 1900)}…` : text;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const token = process.env.MESSENGER_TOKEN;
    if (!token) return { sent: false, reason: "MESSENGER_TOKEN not set" };
    const response = await fetch(
      `https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: senderId },
          messaging_type: "RESPONSE",
          message: { text: body },
        }),
        signal: controller.signal,
      },
    );
    return { sent: response.ok, status: response.status, reason: response.ok ? undefined : await response.text() };
  } catch (error) {
    return { sent: false, reason: (error as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * B7 — typing indicator kills dead air on the real phone while the agent runs
 * its tool chain; fire-and-forget so it can never delay or fail the actual reply.
 */
function sendTypingIndicator(channel: "messenger", senderId: string) {
  const token = process.env.MESSENGER_TOKEN;
  if (!token) return;
  void fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: senderId }, sender_action: "typing_on" }),
  }).catch(() => undefined);
}

// B8 — if the model is still working after this long, send one interim note so
// the customer never stares at silence. Single timer → never duplicates.
// 10s, not 6s: p50 turn latency is ~9s, so a 6s threshold fired the interim on
// almost EVERY turn — the customer saw "đợi mình chút nhé" before every single
// reply (real-phone transcript, 2026-07-06). At 10s it only covers the genuinely
// slow tail; the typing indicator carries the normal case.
const INTERIM_REPLY_AFTER_MS = 10_000;

/**
 * Forward a normalized inbound message into the agent runtime with full
 * conversation continuity: history + cart are loaded from the server-side
 * conversation store (a webhook delivers one message, unlike the web chat
 * which resends its whole history), the stored order is re-validated against
 * the catalog before it can drive any tool, and the reply is delivered back
 * through the channel's send API when a token is configured.
 */
// Proactive-notification opt-out/in must work deterministically (the nudge
// message promises 'Nhắn "dừng"'), so it is intercepted BEFORE the LLM: a
// guardrail the model cannot mis-handle, and it works keyless.
//
// Two tiers, because bare words collide with order talk: the full phrases
// always opt out, but bare "dừng"/"stop" mid-order means "stop the ORDER" and
// must reach the agent. "dung" (no diacritics) is deliberately absent — it is
// how "đúng" ("correct") is typed on a diacritic-less keyboard, and swallowing
// a customer's "yes" as an opt-out would be catastrophic.
const OPT_OUT_PHRASES = /^(tắt thông báo|tat thong bao|dừng thông báo|dung thong bao)$/i;
const OPT_OUT_BARE = /^(dừng|stop)[.!]?$/i;
const OPT_IN_WORDS = /^(bật thông báo|bat thong bao|start)$/i;
const MID_FUNNEL_STAGES = new Set(["cart", "quoted", "otp_requested"]);

async function interceptOptOut(
  channel: "messenger",
  senderId: string,
  text: string,
): Promise<string | null> {
  const trimmed = text.trim().toLowerCase();
  const optIn = OPT_IN_WORDS.test(trimmed);
  let optOut = OPT_OUT_PHRASES.test(trimmed);

  if (!optOut && !optIn && OPT_OUT_BARE.test(trimmed)) {
    // Bare stop word: only an opt-out when there is no active order to stop.
    const { getConvoStore, convoId } = await import("./convo-store");
    const convo = await getConvoStore().get(convoId(channel, senderId)).catch(() => null);
    const stage = convo?.order?.stage ?? "browsing";
    if (MID_FUNNEL_STAGES.has(stage)) return null; // the agent owns "stop my order"
    optOut = true;
  }
  if (!optOut && !optIn) return null;

  const { channelCustomerId } = await import("./convo-store");
  const { getReengageStore } = await import("./reengage-store");
  const store = getReengageStore();
  const customerId = channelCustomerId(channel, senderId);
  await store.setOptOut(customerId, optOut).catch(() => null);
  if (optIn) await store.setMuted(customerId, null).catch(() => null);
  return optOut
    ? "Đã tắt thông báo chủ động. Bạn vẫn đặt hàng bình thường bất cứ lúc nào, nhắn \"bật thông báo\" nếu muốn nhận lại. 🙏"
    : "Đã bật lại thông báo chủ động. Hẹn gặp bạn đúng bữa! 🍗";
}

// Chirpy handoff — ".chirpy" mints a magic link to /voice with the SAME
// identity. Intercepted BEFORE the LLM (same placement/zero-cost as the "dừng"
// opt-out), and deliberately conservative so it can never hijack a real order.
function baseAppUrl(): string {
  // Trailing slash stripped: NEXT_PUBLIC_APP_URL set as "https://x.app/" would
  // mint ".../​/voice?t=..." and Next's redirect to /voice DROPS the token, so
  // the chirpy link silently loses the customer's identity (seen live 2026-07-11).
  const configured = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  return (configured || "http://localhost:3000").replace(/\/+$/, "");
}

async function interceptChirpy(channel: "messenger", senderId: string, text: string): Promise<string | null> {
  const { normalize } = await import("./faq-cache");
  const norm = normalize(text);
  const padded = ` ${norm} `;
  const isTrigger =
    norm === "chirpy" ||
    padded.includes(" chirpy ") ||
    norm.includes("noi chuyen voi chirpy") ||
    norm.includes("goi dien") ||
    padded.includes(" voice ");
  if (!isTrigger) return null;

  const { mintVoiceLink } = await import("./voice-links");
  const { convoId, channelCustomerId } = await import("./convo-store");
  const customerId = channelCustomerId(channel, senderId);
  const conversationKey = convoId(channel, senderId);
  const { token } = await mintVoiceLink(customerId, conversationKey);
  return `Bấm vào đây để nói chuyện với em nhé, em nhớ đơn của mình rồi 🐔 ${baseAppUrl()}/voice?t=${token}`;
}

export async function forwardToAgent(
  channel: "messenger",
  senderId: string,
  text: string,
): Promise<{ forwarded: boolean; reply?: string; sent?: boolean; sendReason?: string; note?: string }> {
  // Human takeover — checked before EVERY automation (agent, opt-out, chirpy):
  // when an operator owns this conversation, the inbound message is parked in
  // the transcript for them and nothing auto-replies. The store fails closed
  // to "agent answers", so a takeover-store outage can never strand a customer.
  {
    const { getTakeoverStore } = await import("./takeover-store");
    const { getConvoStore, convoId, channelCustomerId } = await import("./convo-store");
    const id = convoId(channel, senderId);
    const takenOver = await getTakeoverStore()
      .isActive(id)
      .catch(() => false);
    if (takenOver) {
      const store = getConvoStore();
      const convo = await store.get(id).catch(() => null);
      await store
        .save({
          id,
          customerId: channelCustomerId(channel, senderId),
          order: convo?.order ?? null,
          messages: [...(convo?.messages ?? []), { role: "user", content: text }],
          updatedAt: new Date().toISOString(),
        })
        .catch(() => null);
      return { forwarded: false, note: "Human takeover active; message parked for the operator, agent not invoked." };
    }
  }

  // One-tap stop for proactive notifications — never reaches the LLM. The
  // exchange still persists like every other reply path: the opt-out is the
  // single most consequential message in the relationship, and the transcript
  // and turn-log must show it (audit trail + next-turn LLM context).
  const optReply = await interceptOptOut(channel, senderId, text);
  if (optReply) {
    const delivery = await sendChannelReply(channel, senderId, optReply);
    const { getConvoStore, convoId, channelCustomerId } = await import("./convo-store");
    const store = getConvoStore();
    const id = convoId(channel, senderId);
    const customerId = channelCustomerId(channel, senderId);
    const convo = await store.get(id).catch(() => null);
    await store
      .save({
        id,
        customerId,
        order: convo?.order ?? null,
        messages: [
          ...(convo?.messages ?? []),
          { role: "user", content: text },
          { role: "assistant", content: optReply },
        ],
        updatedAt: new Date().toISOString(),
      })
      .catch(() => null);
    const { logTurn } = await import("./turn-log");
    void logTurn({
      convoKey: id,
      customerId,
      channel,
      model: "optout-intercept",
      userText: text,
      replyText: optReply,
      toolCalls: ["optout-intercept"],
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    });
    return { forwarded: true, reply: optReply, sent: delivery.sent, sendReason: delivery.reason };
  }

  // Chirpy handoff — mint a /voice magic link and reply with it. Never invokes
  // the LLM. Persist the exchange like every other path (audit + next-turn ctx).
  const chirpyReply = await interceptChirpy(channel, senderId, text);
  if (chirpyReply) {
    const delivery = await sendChannelReply(channel, senderId, chirpyReply);
    const { getConvoStore, convoId, channelCustomerId } = await import("./convo-store");
    const store = getConvoStore();
    const id = convoId(channel, senderId);
    const customerId = channelCustomerId(channel, senderId);
    const convo = await store.get(id).catch(() => null);
    await store
      .save({
        id,
        customerId,
        order: convo?.order ?? null,
        messages: [
          ...(convo?.messages ?? []),
          { role: "user", content: text },
          { role: "assistant", content: chirpyReply },
        ],
        updatedAt: new Date().toISOString(),
      })
      .catch(() => null);
    const { logTurn } = await import("./turn-log");
    void logTurn({
      convoKey: id,
      customerId,
      channel,
      model: "chirpy-link",
      userText: text,
      replyText: chirpyReply,
      toolCalls: ["chirpy-link"],
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    });
    return { forwarded: true, reply: chirpyReply, sent: delivery.sent, sendReason: delivery.reason };
  }

  // Instant answer caches — the same three fast-paths as the web /api/agent
  // route (curated FAQ, grounded order-opener clarifier, learned global cache).
  // Every never-wrong guard lives in lib/faq-cache / lib/answer-cache; a miss
  // falls through to the full agent. Deliberately BEFORE the gateway-key check:
  // cache hits are keyless, so common questions work even without the LLM.
  {
    const cacheStartedAt = Date.now();
    const { matchFaq, matchOrderOpener } = await import("./faq-cache");
    const { lookupAnswer } = await import("./answer-cache");
    const curated = matchFaq(text) ?? (await matchOrderOpener(text));
    const say = curated?.say ?? (await lookupAnswer(text));
    if (say) {
      const cacheModel = curated
        ? curated.id.startsWith("opener-")
          ? "opener-cache"
          : "faq-cache"
        : "learned-cache";
      const delivery = await sendChannelReply(channel, senderId, say);
      const { getConvoStore, convoId, channelCustomerId } = await import("./convo-store");
      const store = getConvoStore();
      const id = convoId(channel, senderId);
      const customerId = channelCustomerId(channel, senderId);
      const convo = await store.get(id).catch(() => null);
      await store
        .save({
          id,
          customerId,
          order: convo?.order ?? null,
          messages: [
            ...(convo?.messages ?? []),
            { role: "user", content: text },
            { role: "assistant", content: say },
          ],
          updatedAt: new Date().toISOString(),
        })
        .catch(() => null);
      const { logTurn } = await import("./turn-log");
      void logTurn({
        convoKey: id,
        customerId,
        channel,
        model: cacheModel,
        userText: text,
        replyText: say,
        toolCalls: [],
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        latencyMs: Date.now() - cacheStartedAt,
      });
      return { forwarded: true, reply: say, sent: delivery.sent, sendReason: delivery.reason };
    }
  }

  if (!process.env.AI_GATEWAY_API_KEY) {
    return {
      forwarded: false,
      note: "Message normalized; AI_GATEWAY_API_KEY not set so the agent was not invoked.",
    };
  }
  try {
    const { generateText, stepCountIs } = await import("ai");
    const { createAgentRuntime } = await import("./agent");
    const { AGENT_MODEL } = await import("./ai");
    const { revalidateOrder, compactOrderState } = await import("./order");
    const { getConvoStore, convoId, channelCustomerId, CONVO_MESSAGE_CAP } = await import("./convo-store");

    const store = getConvoStore();
    const id = convoId(channel, senderId);
    const customerId = channelCustomerId(channel, senderId);
    const convo = await store.get(id).catch(() => null);

    // Never trust persisted cart lines blindly — rebuild them from the catalog.
    const initialOrder = convo?.order ? revalidateOrder(convo.order).order : undefined;
    const history = (convo?.messages ?? []).slice(-CONVO_MESSAGE_CAP);

    const { getWorldState, describeWorld } = await import("./worldstate");
    const { getChannelWeatherOverride } = await import("./demo");
    const world = await getWorldState();
    const weatherOverride = getChannelWeatherOverride();
    const weather = weatherOverride ?? world.weather;

    const runtime = createAgentRuntime({
      sessionKey: id,
      customerId,
      initialOrder,
      // World knowledge: real Vietnam local hour (the server runs in UTC) and
      // the weather signal — live Open-Meteo unless an operator override is
      // active (/backend → /api/demo → here).
      orderContext: {
        weather,
        hour: (new Date().getUTCHours() + 7) % 24,
      },
      transcriptSummary: () =>
        [...history, { role: "user", content: text }]
          .slice(-8)
          .map((message) => `${message.role}: ${message.content}`)
          .join("\n"),
    });

    // Two system messages, deliberately split for prompt caching: the base
    // prompt is byte-stable across every turn and carries the cache breakpoint
    // (caching tools + system, ~0.1x input price on reads); the volatile order
    // state goes in a second, uncached system message AFTER the breakpoint so
    // it never invalidates the prefix.
    //
    // The state message exists because channel history persists only
    // user/assistant text (no tool calls) — without it the model cannot see the
    // cart from the transcript alone and re-adds items each turn.
    // Volatile world + order state goes AFTER the cache breakpoint so it never
    // invalidates the cached prefix. Always emit it (even with no cart) so the
    // agent sees today's real weather/calendar line.
    const worldLine = describeWorld(world) + (weatherOverride ? " (thời tiết do điều phối viên đặt)" : "");
    const stateLine = initialOrder
      ? `Current server-side order state (source of truth; these lines are ALREADY in the cart — never re-add them): ${JSON.stringify(compactOrderState(initialOrder))}`
      : "";
    // Mirror the customer's texting style (terse ↔ chatty) from their own turns.
    const { verbosityHint } = await import("./verbosity");
    const styleLine =
      verbosityHint([...history.filter((m) => m.role === "user").map((m) => m.content), text]) ?? "";
    const systemMessages = [
      {
        role: "system" as const,
        content: runtime.system,
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" as const } } },
      },
      {
        role: "system" as const,
        content: [worldLine, stateLine, styleLine].filter(Boolean).join("\n"),
      },
    ];

    sendTypingIndicator(channel, senderId);
    const interimTimer = setTimeout(() => {
      void sendChannelReply(channel, senderId, "Đợi mình chút nhé, đang kiểm tra… 🍗");
    }, INTERIM_REPLY_AFTER_MS);

    let result;
    const turnStartedAt = Date.now();
    try {
      result = await generateText({
        model: AGENT_MODEL,
        messages: [...systemMessages, ...history, { role: "user" as const, content: text }],
        tools: runtime.tools,
        stopWhen: stepCountIs(8),
      });
    } finally {
      clearTimeout(interimTimer);
    }

    // C9: same per-customer cost accounting as the web route. Cache writes come
    // from step metadata (totalUsage only carries reads).
    const { recordUsage, sumCacheWriteTokens } = await import("./usage-ledger");
    const cacheWriteTokens = sumCacheWriteTokens(result.steps);
    recordUsage(customerId, AGENT_MODEL, { ...result.totalUsage, cacheWriteTokens });

    const reply = extractSay(result.text) || "Xin lỗi, bạn nhắn lại giúp mình nhé?";

    // Feed the learned global cache (same never-wrong write policy as the web
    // route): a safe, tool-free answer here serves the NEXT asker in ~1ms.
    const { storeAnswer } = await import("./answer-cache");
    void storeAnswer(text, reply, {
      toolCallCount: result.steps.flatMap((step) => step.toolCalls ?? []).length,
      customerId,
    });

    // Durable turn log (fire-and-forget — never blocks or breaks the reply).
    const { logTurn } = await import("./turn-log");
    void logTurn({
      convoKey: id,
      customerId,
      channel,
      model: AGENT_MODEL,
      userText: text,
      replyText: reply,
      toolCalls: result.steps.flatMap((step) => (step.toolCalls ?? []).map((call) => call.toolName)),
      inputTokens: result.totalUsage.inputTokens ?? 0,
      cachedInputTokens: result.totalUsage.cachedInputTokens ?? 0,
      cacheWriteTokens,
      outputTokens: result.totalUsage.outputTokens ?? 0,
      latencyMs: Date.now() - turnStartedAt,
    });

    await store
      .save({
        id,
        customerId,
        order: runtime.order,
        messages: [...history, { role: "user", content: text }, { role: "assistant", content: reply }],
        updatedAt: new Date().toISOString(),
      })
      .catch(() => null);

    const delivery = await sendChannelReply(channel, senderId, reply);
    return { forwarded: true, reply, sent: delivery.sent, sendReason: delivery.reason };
  } catch (error) {
    return { forwarded: false, note: `Agent forward failed: ${(error as Error).message}` };
  }
}
