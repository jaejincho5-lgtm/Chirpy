import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { AGENT_MODEL } from "@/lib/ai";
import { matchFaq, matchOrderOpener } from "@/lib/faq-cache";
import { lookupAnswer, storeAnswer } from "@/lib/answer-cache";
import { getContactStore, describeContactForAgent } from "@/lib/contact-store";
import { getHistoryStore } from "@/lib/history-store";
import { sendChannelReply } from "@/lib/channel";
import { verifyChannelEcho } from "@/lib/voice-links";
import { recordUsage, sumCacheWriteTokens } from "@/lib/usage-ledger";
import { logTurn } from "@/lib/turn-log";
import { createOrder, revalidateOrder, type Order } from "@/lib/order";
import { createAgentRuntime } from "@/lib/agent";
import { getWorldState, describeWorld } from "@/lib/worldstate";
import { verbosityHint } from "@/lib/verbosity";
import {
  createAgentCoreTraceContext,
  logAgentCoreObservation,
  withAgentCoreResponseHeaders,
} from "@/lib/agentcore-observability";
import { z } from "zod";

export const maxDuration = 60;

type LoosePart = {
  type?: string;
  text?: string;
  output?: unknown;
  state?: string;
};

const requestSchema = z.object({
  messages: z.array(z.custom<UIMessage>((value) => Boolean(value) && typeof value === "object")),
  customerId: z.string().regex(/^[a-z0-9_-]{1,40}$/).optional(),
  // Signed value from a redeemed Chirpy voice-link; the server verifies it
  // before echoing a receipt to Messenger, so a raw client string is inert.
  channelEcho: z.string().max(2000).optional(),
  context: z
    .object({
      weather: z.enum(["clear", "rainy", "hot"]).optional(),
      hour: z.number().int().min(0).max(23).optional(),
      daysAhead: z.number().int().min(0).max(30).optional(),
    })
    .optional(),
});

function isOrder(value: unknown): value is Order {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Order>;
  return Array.isArray(candidate.cart) && typeof candidate.stage === "string" && Boolean(candidate.totals);
}

function extractOrder(messages: UIMessage[]): Order {
  let order: Order | undefined;

  for (const message of messages) {
    for (const part of (message.parts ?? []) as LoosePart[]) {
      const output = part.output;
      if (output && typeof output === "object") {
        const maybeOrder = (output as { order?: unknown }).order;
        if (isOrder(maybeOrder)) order = maybeOrder;
      }
    }
  }

  return order ?? createOrder("web");
}

function transcriptSummary(messages: UIMessage[]) {
  return messages
    .map((message) => {
      const text = ((message.parts ?? []) as LoosePart[])
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .filter(Boolean)
        .join(" ");
      return text ? `${message.role}: ${text}` : "";
    })
    .filter(Boolean)
    .slice(-8)
    .join("\n");
}

function sessionKeyFor(messages: UIMessage[]): string {
  // Stable across turns because the client resends the full history each turn.
  const first = messages[0];
  return first?.id ? `conv_${first.id}` : "conv_anonymous";
}

export async function POST(req: Request) {
  const parsed = requestSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ ok: false, message: "Invalid chat request." }, { status: 400 });
  }

  const { messages } = parsed.data;

  // Hard per-conversation turn cap: a public deployment can't be token-drained
  // by one runaway conversation (prereq for the QR-to-judges play, E16).
  const MAX_USER_TURNS = 12;
  if (messages.filter((message) => message.role === "user").length > MAX_USER_TURNS) {
    return Response.json(
      { ok: false, message: "This chat is getting long. Please start a new session." },
      { status: 429 },
    );
  }

  const customerId = parsed.data.customerId ?? "guest";
  const sessionKey = sessionKeyFor(messages);
  const agentCoreTrace = createAgentCoreTraceContext({
    sessionKey,
    customerId,
    channel: "web",
    operation: "POST /api/agent",
  });
  logAgentCoreObservation(agentCoreTrace, {
    event: "agent.turn_start",
    model: AGENT_MODEL,
  });

  // --- instant answer cache ------------------------------------------------
  // Two local fast-paths that skip Opus entirely (lib/faq-cache):
  //   1. matchFaq          — order-neutral info questions such as opening hours.
  //   2. matchOrderOpener  — a bare category opener ("cho 1 burger") answered
  //      with a grounded "which one?" clarifier from the live catalog.
  // Both are strict + guarded: a miss falls through to the full agent below,
  // and neither ever mutates the order. Emitted as the same UI-message stream
  // the client already consumes, so /voice speaks it unchanged.
  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
  const lastUserText = ((lastUserMessage?.parts ?? []) as LoosePart[])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join(" ")
    .trim();
  const cacheStartedAt = Date.now();
  const cached = matchFaq(lastUserText) ?? (await matchOrderOpener(lastUserText));
  if (cached) {
    const cacheModel = cached.id.startsWith("opener-") ? "opener-cache" : "faq-cache";
    // Honest accounting: shows up on /backend as a zero-token, sub-second turn.
    void logTurn({
      convoKey: null,
      customerId,
      channel: "web",
      model: cacheModel,
      userText: lastUserText.slice(0, 4000),
      replyText: cached.say,
      toolCalls: [],
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - cacheStartedAt,
    });
    logAgentCoreObservation(agentCoreTrace, {
      event: "agent.cache_hit",
      model: cacheModel,
      cacheId: cached.id,
      latencyMs: Date.now() - cacheStartedAt,
    });
    const stream = createUIMessageStream({
      execute: ({ writer }) => {
        const id = `cache-${cached.id}`;
        // Marks the reply as a cache hit so /user can render the "instant
        // badge; /voice ignores unknown data parts.
        writer.write({ type: "data-cache", data: { source: cacheModel } });
        writer.write({ type: "text-start", id });
        writer.write({ type: "text-delta", id, delta: cached.say });
        writer.write({ type: "text-end", id });
      },
    });
    return withAgentCoreResponseHeaders(createUIMessageStreamResponse({ stream }), agentCoreTrace);
  }

  // --- learned global answer cache -----------------------------------------
  // A curated miss falls through to here: if some OTHER customer already got a
  // safe, tool-free answer to this exact (normalized) question, replay it in
  // ~1ms via the SAME stream shape, so /user renders and /voice speaks it
  // identically. Every never-wrong guard lives in lookupAnswer.
  const learnedStartedAt = Date.now();
  const learned = await lookupAnswer(lastUserText);
  if (learned) {
    void logTurn({
      convoKey: null,
      customerId,
      channel: "web",
      model: "learned-cache",
      userText: lastUserText.slice(0, 4000),
      replyText: learned,
      toolCalls: [],
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - learnedStartedAt,
    });
    logAgentCoreObservation(agentCoreTrace, {
      event: "agent.cache_hit",
      model: "learned-cache",
      cacheId: "learned-cache",
      latencyMs: Date.now() - learnedStartedAt,
    });
    const stream = createUIMessageStream({
      execute: ({ writer }) => {
        const id = "cache-learned";
        writer.write({ type: "data-cache", data: { source: "learned-cache" } });
        writer.write({ type: "text-start", id });
        writer.write({ type: "text-delta", id, delta: learned });
        writer.write({ type: "text-end", id });
      },
    });
    return withAgentCoreResponseHeaders(createUIMessageStreamResponse({ stream }), agentCoreTrace);
  }

  // The /user operator toggle wins when set; otherwise fill from live weather.
  const world = await getWorldState();
  const orderContext = {
    weather: parsed.data.context?.weather ?? world.weather,
    hour: parsed.data.context?.hour ?? new Date().getHours(),
  };
  const daysAhead = parsed.data.context?.daysAhead ?? 0;

  // Saved delivery contact for zero-re-entry checkout, injected below AFTER the
  // prompt-cache breakpoint (it is per-customer volatile context). completedOrder
  // count gates the "Customer quen" trusted-skip hint. Never blocks the turn.
  const [savedContact, priorOrderCount] = await Promise.all([
    getContactStore().getContact(customerId).catch(() => null),
    getHistoryStore()
      .getOrders(customerId, 25)
      .then((orders) => orders.length)
      .catch(() => 0),
  ]);
  const contactHint = describeContactForAgent(savedContact, priorOrderCount);

  // SECURITY: the Order is reconstructed from client-supplied messages, so we
  // re-validate every cart line against the catalog (name + price + options)
  // before it can drive any tool. Forged lines are dropped here; the client's
  // otp.verified is ignored entirely (OTP state is server-side, see lib/otp.ts).
  const { order: sanitizedOrder } = revalidateOrder(extractOrder(messages));

  const runtime = createAgentRuntime({
    sessionKey,
    customerId,
    orderContext,
    daysAhead,
    initialOrder: sanitizedOrder,
    transcriptSummary: () => transcriptSummary(messages),
  });

  // Learn the customer's texting style from their own messages this session and
  // mirror it: terse texters get terse replies, chatty ones get a fuller answer.
  const userTexts = messages
    .filter((message) => message.role === "user")
    .map((message) =>
      ((message.parts ?? []) as LoosePart[])
        .filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join(" "),
    )
    .filter(Boolean);
  const styleHint = verbosityHint(userTexts);

  const turnStartedAt = Date.now();
  const result = streamText({
    model: AGENT_MODEL,
    messages: [
      // Cached system message: the breakpoint covers tools + system (both are
      // byte-stable across turns), cutting time-to-first-token and input cost
      // on every multi-step chain after the first.
      {
        role: "system",
        content: runtime.system,
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      },
      // Volatile lines AFTER the cache breakpoint so they never invalidate the
      // cached prefix: today's real HCMC weather + calendar, and the learned
      // reply-length style for this customer.
      { role: "system", content: [describeWorld(world), styleHint, contactHint].filter(Boolean).join("\n") },
      ...convertToModelMessages(messages),
    ],
    tools: runtime.tools,
    stopWhen: stepCountIs(8),
    // C9: accumulate real token spend per customer for the /backend cost line,
    // cache writes included (they live in step metadata, not totalUsage).
    onFinish: ({ totalUsage, steps, text }) => {
      const cacheWriteTokens = sumCacheWriteTokens(steps);
      const toolCalls = steps.flatMap((step) => (step.toolCalls ?? []).map((call) => call.toolName));
      recordUsage(customerId, AGENT_MODEL, { ...totalUsage, cacheWriteTokens });
      // Learn this answer for the next customer — but only if it used no tools
      // and carries no personalization (storeAnswer enforces the full policy).
      // Fire-and-forget: never blocks the stream, TTS server cache (if present)
      // will then hit on the identical `say` for a free instant /voice replay.
      void storeAnswer(lastUserText, text, { toolCallCount: toolCalls.length, customerId });

      // Chirpy receipt echo: if this /voice turn (opened from a Messenger magic
      // link) just PLACED the order and carries a verified channelEcho, send a
      // compact receipt back to that Messenger thread. Only on the placed
      // transition (once per order), only when the signed key checks out, never
      // breaks the reply.
      if (parsed.data.channelEcho && sanitizedOrder.stage !== "placed") {
        const conversationKey = verifyChannelEcho(parsed.data.channelEcho);
        const finalOrder = runtime.order;
        if (conversationKey?.startsWith("messenger:") && finalOrder.stage === "placed" && finalOrder.placedOrder) {
          const senderId = conversationKey.slice("messenger:".length);
          const items = finalOrder.cart.map((line) => `• ${line.quantity}x ${line.name}`).join("\n");
          const receipt = `Order ${finalOrder.placedOrder.orderNumber} placed ✅\n${items}\nTotal: ${finalOrder.totals.displayTotal}\nPlaced by voice with Chirpy 🎙️`;
          if (senderId) void sendChannelReply("messenger", senderId, receipt).catch(() => {});
        }
      }

      // Durable turn log (fire-and-forget — never blocks the stream).
      void logTurn({
        convoKey: null,
        customerId,
        channel: "web",
        model: AGENT_MODEL,
        userText: JSON.stringify(lastUserMessage?.parts ?? "").slice(0, 4000),
        replyText: text,
        toolCalls,
        inputTokens: totalUsage.inputTokens ?? 0,
        cachedInputTokens: totalUsage.cachedInputTokens ?? 0,
        cacheWriteTokens,
        outputTokens: totalUsage.outputTokens ?? 0,
        latencyMs: Date.now() - turnStartedAt,
      });
      logAgentCoreObservation(agentCoreTrace, {
        event: "agent.turn_finish",
        model: AGENT_MODEL,
        toolCalls,
        inputTokens: totalUsage.inputTokens ?? 0,
        cachedInputTokens: totalUsage.cachedInputTokens ?? 0,
        cacheWriteTokens,
        outputTokens: totalUsage.outputTokens ?? 0,
        latencyMs: Date.now() - turnStartedAt,
      });
    },
  });

  return withAgentCoreResponseHeaders(result.toUIMessageStreamResponse(), agentCoreTrace);
}
