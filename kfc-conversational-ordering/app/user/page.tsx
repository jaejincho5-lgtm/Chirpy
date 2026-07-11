"use client";

// /user — the customer's phone. Chat only: no operator controls, no tool
// console. Controls arrive from /backend over the demo bus; state (order,
// traces, transcript) is broadcast back after every change.

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  BillSwapCard,
  DEMO_BUS,
  KfcMark,
  MenuCards,
  MicIcon,
  SendIcon,
  SuggestionChip,
  VerifiedBadge,
  buildTranscript,
  emptyPrompts,
  getLatestOrder,
  getPartOutput,
  getToolTraces,
  parseContract,
  quickReplies,
  renderSay,
  type AddonSuggestion,
  type BillProposal,
  type ChatPart,
  type DemoBusMessage,
  type MenuMatch,
} from "../demo-shared";

function ToolOutput({
  part,
  traceId,
  dismissedSuggestions,
  onSuggestionAccept,
  onSuggestionDecline,
  onBillSwapAccept,
}: {
  part: ChatPart;
  traceId: string;
  dismissedSuggestions: Set<string>;
  onSuggestionAccept: (suggestion: AddonSuggestion) => void;
  onSuggestionDecline: (traceId: string, suggestion: AddonSuggestion) => void;
  onBillSwapAccept: (proposal: BillProposal) => void;
}) {
  const name = part.type.replace(/^tool-/, "");
  const output = getPartOutput<{
    matches?: MenuMatch[];
    message?: string;
    devCode?: string;
    ok?: boolean;
    code?: string;
    decision?: "suggest" | "silent";
    suggestion?: AddonSuggestion | null;
    proposal?: BillProposal | null;
  }>(part);

  const showError = output?.ok === false && output.message;

  return (
    <>
      {output?.matches ? <MenuCards matches={output.matches} /> : null}
      {name === "suggest_addons" && output?.decision === "suggest" && output.suggestion ? (
        <SuggestionChip
          traceId={traceId}
          suggestion={output.suggestion}
          dismissed={dismissedSuggestions.has(traceId)}
          onAccept={onSuggestionAccept}
          onDecline={onSuggestionDecline}
        />
      ) : null}
      {name === "optimize_bill" && output?.proposal ? (
        <BillSwapCard proposal={output.proposal} onAccept={onBillSwapAccept} />
      ) : null}
      {showError ? <p className="sys-error">{output.message}</p> : null}
      {output?.devCode ? <code className="otp-code">OTP demo: {output.devCode}</code> : null}
    </>
  );
}

function MessageBubble({
  message,
  dismissedSuggestions,
  onSuggestionAccept,
  onSuggestionDecline,
  onBillSwapAccept,
}: {
  message: { id: string; role: string; parts?: unknown[] };
  dismissedSuggestions: Set<string>;
  onSuggestionAccept: (suggestion: AddonSuggestion) => void;
  onSuggestionDecline: (traceId: string, suggestion: AddonSuggestion) => void;
  onBillSwapAccept: (proposal: BillProposal) => void;
}) {
  const isUser = message.role === "user";

  return (
    <div className={`message-row ${isUser ? "message-row--user" : "message-row--assistant"}`}>
      {!isUser ? (
        <div className="bot-avatar" aria-hidden>
          <KfcMark />
        </div>
      ) : null}
      <div className="bubble">
        {((message.parts ?? []) as ChatPart[]).map((part, index) => {
          if (part.type === "text" && part.text) {
            const contract = parseContract(part.text);
            return (
              <div key={`${message.id}-${index}`} className="bubble__text">
                <p>{renderSay(contract.say)}</p>
              </div>
            );
          }
          if (part.type.startsWith("tool-")) {
            const traceId = part.toolCallId ?? `${message.id}-${index}`;
            return (
              <ToolOutput
                key={`${message.id}-${index}`}
                part={part}
                traceId={traceId}
                dismissedSuggestions={dismissedSuggestions}
                onSuggestionAccept={onSuggestionAccept}
                onSuggestionDecline={onSuggestionDecline}
                onBillSwapAccept={onBillSwapAccept}
              />
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

export default function UserPhone() {
  const [input, setInput] = useState("");
  const [customerId, setCustomerId] = useState("linh");
  // "live" = defer to the server's real Open-Meteo weather (send no override).
  const [weather, setWeather] = useState<"clear" | "rainy" | "hot" | "live">("live");
  const [hour, setHour] = useState(12);
  const [daysAhead, setDaysAhead] = useState(0);
  const [dismissedSuggestions, setDismissedSuggestions] = useState(() => new Set<string>());
  const [listening, setListening] = useState(false);
  const busRef = useRef<BroadcastChannel | null>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const settingsRef = useRef({ customerId, weather, hour, daysAhead });
  settingsRef.current = { customerId, weather, hour, daysAhead };

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/agent",
        prepareSendMessagesRequest: ({ id, messages, body, trigger, messageId }) => ({
          body: {
            ...body,
            id,
            messages,
            trigger,
            messageId,
            customerId,
            // Omit weather when "live" so the server fills from Open-Meteo.
            context: { weather: weather === "live" ? undefined : weather, hour, daysAhead },
          },
        }),
      }),
    [customerId, weather, hour, daysAhead],
  );
  const { messages, sendMessage, status, setMessages } = useChat({
    transport,
  });
  const latestOrder = useMemo(() => getLatestOrder(messages), [messages]);
  const traces = useMemo(() => getToolTraces(messages), [messages]);
  const isBusy = status === "submitted" || status === "streaming";
  const stage = latestOrder?.stage.replace("_", " ") ?? "sẵn sàng";
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // F18 — soft pop when an assistant message lands (nudge arrivals included).
  // WebAudio needs a prior user gesture; the AudioContext is created lazily on
  // first play and silently no-ops if the browser blocks it.
  const audioRef = useRef<AudioContext | null>(null);
  const assistantCountRef = useRef(0);
  const playPop = () => {
    try {
      audioRef.current ??= new AudioContext();
      const ctx = audioRef.current;
      if (ctx.state === "suspended") void ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } catch {
      // Autoplay policy or missing WebAudio — sound is a garnish, never an error.
    }
  };
  useEffect(() => {
    const assistantCount = messages.filter((message) => message.role === "assistant").length;
    // Fire when a NEW assistant message appears, but not while it is still
    // streaming (one pop per reply, on completion).
    if (assistantCount > assistantCountRef.current && !isBusy) {
      assistantCountRef.current = assistantCount;
      playPop();
    }
    if (assistantCount < assistantCountRef.current) assistantCountRef.current = assistantCount;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, isBusy]);

  // Inject a server-initiated assistant message (nudge, proactive status,
  // promo) as an incoming OA bubble. setMessages is stable, so the empty-dep
  // bus effect below can safely close over this.
  function injectAssistant(text: string) {
    setMessages((current) => [
      ...current,
      {
        id: `push_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        role: "assistant",
        parts: [{ type: "text", text }],
      } as (typeof current)[number],
    ]);
  }

  // Demo bus: apply /backend control commands, answer hello with a snapshot.
  useEffect(() => {
    const bus = new BroadcastChannel(DEMO_BUS);
    busRef.current = bus;
    bus.onmessage = (event: MessageEvent<DemoBusMessage>) => {
      const message = event.data;
      if (message.kind === "control") {
        if (message.settings?.customerId) setCustomerId(message.settings.customerId);
        if (message.settings?.weather) setWeather(message.settings.weather);
        if (typeof message.settings?.hour === "number") setHour(message.settings.hour);
        if (typeof message.settings?.daysAhead === "number") setDaysAhead(message.settings.daysAhead);
        if (message.reset) {
          setMessages([]);
          setDismissedSuggestions(new Set());
          setInput("");
        }
      }
      if (message.kind === "nudge") {
        // The proactive re-order nudge: composed server-side from this
        // customer's real history, injected as an incoming OA message.
        const { customerId: cid, weather: w, hour: h, daysAhead: d } = settingsRef.current;
        void fetch("/api/nudge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerId: cid,
            context: { weather: w === "live" ? undefined : w, hour: h, daysAhead: d },
          }),
        })
          .then((response) => response.json())
          .then((result: { ok: boolean; message?: string }) => {
            if (result.message) injectAssistant(result.message);
          })
          .catch(() => null);
      }
      if (message.kind === "order-status") {
        // Proactive OMS status update from /backend. Only inject into the chat
        // if it's for THIS customer (the bus is shared across demo tabs).
        if (message.customerId === settingsRef.current.customerId) {
          injectAssistant(message.text);
        }
      }
      if (message.kind === "promo") {
        // Staff promo blast — always shown on the demo phone.
        injectAssistant(message.text);
      }
      if (message.kind === "hello") setHelloTick((tick) => tick + 1);
    };
    return () => {
      busRef.current = null;
      bus.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [helloTick, setHelloTick] = useState(0);

  // Broadcast a state snapshot on every meaningful change (and on hello).
  useEffect(() => {
    busRef.current?.postMessage({
      kind: "state",
      settings: { customerId, weather, hour, daysAhead },
      order: latestOrder ?? null,
      traces,
      transcript: buildTranscript(messages),
      isBusy,
    } satisfies DemoBusMessage);
  }, [customerId, weather, hour, daysAhead, latestOrder, traces, messages, isBusy, helloTick]);

  // Real voice input via the browser speech API (vi-VN). Chrome/Edge only;
  // elsewhere the button falls back to pre-filling a sample message.
  function toggleMic() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const SpeechRecognitionImpl =
      (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionImpl) {
      setInput("Cho mình một combo gà rán classic, không cay");
      return;
    }
    const recognition = new SpeechRecognitionImpl();
    recognition.lang = "vi-VN";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results as ArrayLike<any>)
        .map((result) => result[0]?.transcript ?? "")
        .join("")
        .trim();
      if (transcript) setInput(transcript);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  function submitMessage(text: string) {
    const value = text.trim();
    if (!value || isBusy) return;
    sendMessage({ text: value });
    setInput("");
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitMessage(input);
  }

  async function postFeedback(suggestion: AddonSuggestion, action: "accepted" | "declined") {
    await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId, catalogId: suggestion.catalogId, action }),
    }).catch(() => null);
  }

  function acceptSuggestion(suggestion: AddonSuggestion) {
    void postFeedback(suggestion, "accepted");
    submitMessage(`Thêm 1 ${suggestion.name}`);
  }

  function declineSuggestion(traceId: string, suggestion: AddonSuggestion) {
    void postFeedback(suggestion, "declined");
    setDismissedSuggestions((current) => new Set(current).add(traceId));
  }

  function acceptBillSwap(proposal: BillProposal) {
    submitMessage(`Đồng ý đổi combo (swap ${proposal.swapId})`);
  }

  return (
    <main className="user-stage">
      <div className="phone">
        <header className="phone__header">
          <div className="oa-avatar" aria-hidden>
            <KfcMark />
          </div>
          <div>
            <span className="oa-name">
              KFC Việt Nam <VerifiedBadge />
            </span>
            <small>Official Account · trả lời trong vài giây</small>
          </div>
          <Link href="/voice" className="phone__voice-link" title="Nói chuyện với Đại sứ ảo">
            🎤
          </Link>
          <span className={`stage-pill ${latestOrder?.placedOrder ? "stage-pill--placed" : ""}`}>{stage}</span>
        </header>

        <div className="messages" aria-live="polite" ref={messagesRef}>
          {messages.length === 0 ? (
            <div className="empty-state">
              <span>Gà nóng, chat là tới. Hôm nay bạn thèm gì?</span>
              <p>Nhắn tiếng Việt tự nhiên — agent tự tra menu, giá thật, không bịa.</p>
              <div className="empty-prompts">
                {emptyPrompts.map((prompt) => (
                  <button key={prompt} type="button" onClick={() => submitMessage(prompt)} disabled={isBusy}>
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                dismissedSuggestions={dismissedSuggestions}
                onSuggestionAccept={acceptSuggestion}
                onSuggestionDecline={declineSuggestion}
                onBillSwapAccept={acceptBillSwap}
              />
            ))
          )}
          {isBusy ? (
            <div className="typing" aria-label="Assistant đang trả lời">
              <i />
              <i />
              <i />
            </div>
          ) : null}
        </div>

        {messages.length > 0 ? (
          <div className="suggestions">
            {quickReplies.map((reply) => (
              <button key={reply} type="button" onClick={() => submitMessage(reply)} disabled={isBusy}>
                {reply}
              </button>
            ))}
          </div>
        ) : null}

        <form className="composer" onSubmit={onSubmit}>
          <button
            className={`composer__voice ${listening ? "is-listening" : ""}`}
            type="button"
            onClick={toggleMic}
            title={listening ? "Đang nghe... bấm để dừng" : "Nói tiếng Việt (Chrome/Edge)"}
            aria-pressed={listening}
          >
            <MicIcon />
          </button>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Nhắn cho KFC..."
            disabled={isBusy}
          />
          <button className="composer__send" type="submit" disabled={isBusy || !input.trim()} aria-label="Gửi">
            <SendIcon />
          </button>
        </form>
      </div>
    </main>
  );
}
