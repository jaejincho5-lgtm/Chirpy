"use client";

// /voice — the KFC virtual ambassador. Talk to a VRM avatar; it talks back.
// Same agent, same tools, same typed Order state machine as /user underneath —
// only the surface changes (speech in, speech + lip-sync out).

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import dynamic from "next/dynamic";
import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import { getLatestOrder, KfcMark, MicIcon, Receipt } from "../demo-shared";
import { extractSay } from "@/lib/say";
import { getSpeaker } from "@/lib/speech";
import type { MenuItem, MenuMatch } from "@/lib/menu";
import ItemPopups from "./item-popups";
import MenuPanel from "./menu-panel";

const VrmStage = dynamic(() => import("./chicken-stage"), { ssr: false });

// Kill-switch for the visual menu layer (popups + side panel) — §5.4 of
// docs/FEATURE_ITEM_POPUPS.md: with this off, /voice behaves exactly as before.
const SHOW_MENU_VISUALS = true;

const VOICE_GREETING = "Chào anh/chị! Em là Đại sứ Gà đây, mình muốn dùng gì hôm nay ạ? 🐔";
// Spoken while the agent is still thinking, so the avatar never sits silent.
const FILLERS = ["Dạ, để em xem…", "Dạ có ngay ạ…", "Ok ạ, chờ em xíu nha…"];

// Concatenate the text parts of a message into raw assistant text.
function messageText(message: { parts?: Array<{ type?: string; text?: string }> }): string {
  return (message.parts ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}

export default function VoicePage() {
  const [customerId, setCustomerId] = useState("voice_guest");
  const [channelEcho, setChannelEcho] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [subtitle, setSubtitle] = useState(VOICE_GREETING);
  const [visemeLevel, setVisemeLevel] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [mood, setMood] = useState<"idle" | "happy">("idle");
  const [showType, setShowType] = useState(false);
  const [showCaptions, setShowCaptions] = useState(false);
  const [typed, setTyped] = useState("");
  // Hands-free driver mode: the page listens by itself; the mic button only mutes.
  const [muted, setMuted] = useState(false);
  const [started, setStarted] = useState(false);
  // Visual menu layer (docs/FEATURE_ITEM_POPUPS.md): side panel + the agent's
  // LIVE catalog + OOS set (one /api/menu fetch; null catalog = fetch pending
  // or failed, panel falls back to the static copy).
  const [menuOpen, setMenuOpen] = useState(false);
  const [liveCatalog, setLiveCatalog] = useState<MenuItem[] | null>(null);
  const [outOfStock, setOutOfStock] = useState<Set<string>>(new Set());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const spokenCountRef = useRef(0);
  const lastStageRef = useRef<string | null>(null);
  const lastSpokenRef = useRef<string | null>(VOICE_GREETING);
  const speechTokenRef = useRef(0);
  // Live mirrors so the recognition callbacks (created once) read current state.
  const mutedRef = useRef(false);
  const startedRef = useRef(false);
  const busyRef = useRef(false);
  const speakingRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalTextRef = useRef("");
  const errorStreakRef = useRef(0);

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
            // Present only after a Chirpy magic-link redemption — a signed value
            // the server verifies before echoing a receipt back to Messenger.
            channelEcho: channelEcho ?? undefined,
            // No weather override — the server uses real Open-Meteo weather.
            context: { hour: new Date().getHours() },
          },
        }),
      }),
    [customerId, channelEcho],
  );
  const { messages, sendMessage, status } = useChat({ transport });
  const latestOrder = useMemo(() => getLatestOrder(messages), [messages]);
  const isBusy = status === "submitted" || status === "streaming";

  const speakLine = useCallback((text: string, options: { meaningful?: boolean; cancelFirst?: boolean } = {}) => {
    if (options.cancelFirst) {
      speechTokenRef.current += 1;
      getSpeaker().cancel();
    }
    const token = speechTokenRef.current + 1;
    speechTokenRef.current = token;
    if (options.meaningful) lastSpokenRef.current = text;
    setSubtitle(text);
    setSpeaking(true);
    getSpeaker().speak(text, {
      onLevel: (v) => {
        if (speechTokenRef.current === token) setVisemeLevel(v);
      },
      onEnd: () => {
        if (speechTokenRef.current !== token) return;
        setSpeaking(false);
        setVisemeLevel(0);
      },
    });
  }, []);

  function cancelSpeech() {
    speechTokenRef.current += 1;
    getSpeaker().cancel();
    setSpeaking(false);
    setVisemeLevel(0);
  }

  function repeatLastSpoken() {
    if (!started || isBusy) return;
    speakLine(lastSpokenRef.current ?? VOICE_GREETING, { meaningful: true, cancelFirst: true });
  }

  function handleAvatarKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    repeatLastSpoken();
  }

  // Chirpy handoff: if the URL carries a magic-link token, redeem it once on
  // mount to adopt the Messenger identity (shared cart/taste/loyalty), speak the
  // personalized greeting, and keep the signed channelEcho for the receipt echo.
  const redeemedRef = useRef(false);
  useEffect(() => {
    if (redeemedRef.current) return;
    const token = new URLSearchParams(window.location.search).get("t");
    if (!token) return;
    redeemedRef.current = true;
    (async () => {
      const response = await fetch(`/api/voice-link?t=${encodeURIComponent(token)}`).catch(() => null);
      const json = response ? await response.json().catch(() => null) : null;
      // Drop the token from the URL either way so a refresh can't re-redeem.
      window.history.replaceState(null, "", window.location.pathname);
      if (json?.ok) {
        setCustomerId(json.customerId);
        setChannelEcho(json.channelEcho ?? null);
        const greeting = String(json.greeting ?? "");
        if (greeting) {
          speakLine(greeting, { meaningful: true });
        }
      } else {
        setShowCaptions(true);
        setSubtitle('Link đã hết hạn, nhắn "chirpy" trong Messenger để lấy link mới nhé 🐔');
      }
    })();
  }, [speakLine]);

  // One-shot availability fetch for the visual menu (§5.3). Failure is fine —
  // no OOS info just means no greyed-out rows; place_order still enforces it.
  useEffect(() => {
    if (!started || !SHOW_MENU_VISUALS) return;
    let alive = true;
    fetch("/api/menu")
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => {
        if (!alive) return;
        if (Array.isArray(json?.outOfStock)) setOutOfStock(new Set<string>(json.outOfStock));
        if (Array.isArray(json?.catalog)) setLiveCatalog(json.catalog as MenuItem[]);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [started]);

  // Tap-to-add (§3.2/§4.2): we hold the exact item, but the cart is
  // server-authoritative, so the add rides the same agent path as a spoken
  // order — submit() cancels speech, guards isBusy, and the echo-guard pauses
  // the mic exactly like any other turn.
  function quickAdd(match: MenuMatch) {
    if (!started || isBusy) return;
    setMenuOpen(false);
    // Vietnamese name + "1 phần", not the English name: "Cho mình 1 Fried
    // Chicken Rice" made the agent match "1 Fried Chicken" (leading-digit
    // collision, verified live). The VN name is what the menu search is tuned
    // for, and "1 phần X" keeps the quantity unambiguous for any item name.
    submit(`Cho mình 1 phần ${match.vietnameseName} nha`);
  }

  // Pre-warm the server audio cache on mount so the first spoken lines (greeting
  // + fillers) are instant. Fire-and-forget; 503 (no key) is a harmless no-op.
  useEffect(() => {
    for (const line of [VOICE_GREETING, ...FILLERS]) {
      void fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: line }),
      }).catch(() => {});
    }
  }, []);

  // Instant acknowledgment filler: if the agent is still busy 700ms after a
  // submit, speak a short filler (round-robin) so there's no dead air. The real
  // reply's speak() cancels any current utterance, so nothing overlaps.
  const fillerIndexRef = useRef(0);
  const fillerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isBusy) {
      fillerTimerRef.current = setTimeout(() => {
        const filler = FILLERS[fillerIndexRef.current % FILLERS.length];
        fillerIndexRef.current += 1;
        speakLine(filler);
      }, 700);
    }
    return () => {
      if (fillerTimerRef.current) {
        clearTimeout(fillerTimerRef.current);
        fillerTimerRef.current = null;
      }
    };
  }, [isBusy, speakLine]);

  // Speak each newly completed assistant message; drive mouth + subtitle.
  useEffect(() => {
    if (isBusy) return;
    const assistant = messages.filter((m) => m.role === "assistant");
    if (assistant.length <= spokenCountRef.current) return;
    spokenCountRef.current = assistant.length;
    const raw = messageText(assistant[assistant.length - 1]);
    const say = extractSay(raw).trim();
    if (!say) return;
    speakLine(say, { meaningful: true });
  }, [messages, isBusy, speakLine]);

  // Happy burst when the order transitions into "placed".
  useEffect(() => {
    const stage = latestOrder?.stage ?? null;
    if (stage === "placed" && lastStageRef.current !== "placed") {
      setMood("happy");
      const timer = setTimeout(() => setMood("idle"), 2500);
      return () => clearTimeout(timer);
    }
    lastStageRef.current = stage;
  }, [latestOrder?.stage]);

  // Keep refs in sync (declared before the loop effect so it reads fresh values).
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  useEffect(() => {
    startedRef.current = started;
  }, [started]);
  useEffect(() => {
    busyRef.current = isBusy;
  }, [isBusy]);
  useEffect(() => {
    speakingRef.current = speaking;
  }, [speaking]);

  function submit(text: string) {
    const value = text.trim();
    if (!value || isBusy) return;
    cancelSpeech();
    setInterim("");
    sendMessage({ text: value });
  }

  function getRecognitionImpl(): (new () => unknown) | null {
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => unknown) | null;
  }

  // True only when the loop is allowed to be listening right now.
  function canListen(): boolean {
    return startedRef.current && !mutedRef.current && !busyRef.current && !speakingRef.current;
  }

  function clearSilenceTimer() {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }

  // Safety net: some Chrome builds never fire onend after silence. If we have a
  // non-empty transcript that hasn't changed for 1400ms, force finalization.
  function armSilenceTimer() {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      if (recognitionRef.current && finalTextRef.current.trim()) {
        try {
          recognitionRef.current.stop();
        } catch {
          /* already stopping */
        }
      }
    }, 1400);
  }

  // Stop the recognizer WITHOUT letting it restart (echo guard / mute / errors).
  function pauseRecognition() {
    clearSilenceTimer();
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) {
      rec.onend = null;
      rec.onerror = null;
      rec.onresult = null;
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    }
    setListening(false);
  }

  // Start one recognition utterance; the auto-restart lives in onend/onerror.
  function beginRecognition() {
    if (recognitionRef.current || !canListen()) return;
    const Impl = getRecognitionImpl();
    if (!Impl) {
      setShowType(true);
      setShowCaptions(true);
      setSubtitle("Trình duyệt chưa hỗ trợ nhận giọng nói, anh/chị gõ giúp em nhé.");
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition: any = new Impl();
    recognition.lang = "vi-VN";
    recognition.interimResults = true;
    recognition.continuous = false;
    finalTextRef.current = "";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results as ArrayLike<any>)
        .map((result) => result[0]?.transcript ?? "")
        .join("")
        .trim();
      finalTextRef.current = transcript;
      setInterim(transcript);
      armSilenceTimer();
    };
    recognition.onend = () => {
      clearSilenceTimer();
      recognitionRef.current = null;
      setListening(false);
      const text = finalTextRef.current.trim();
      finalTextRef.current = "";
      if (text) {
        errorStreakRef.current = 0;
        setInterim("");
        submit(text); // busy/speak effect resumes the loop when the reply is done
        return;
      }
      setInterim("");
      if (canListen()) beginRecognition(); // heard nothing, keep listening
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (event: any) => {
      clearSilenceTimer();
      recognitionRef.current = null;
      setListening(false);
      const err = event?.error;
      if (err === "not-allowed" || err === "service-not-allowed") {
        setMuted(true);
        setShowType(true);
        setShowCaptions(true);
        setSubtitle("Em chưa được cấp quyền mic, anh/chị bật quyền hoặc gõ giúp em nhé.");
        return;
      }
      if (err === "no-speech" || err === "aborted") {
        if (canListen()) beginRecognition(); // benign, restart quietly
        return;
      }
      errorStreakRef.current += 1;
      if (errorStreakRef.current >= 2) {
        setShowType(true);
        setShowCaptions(true);
        setSubtitle("Nhận giọng nói đang trục trặc, anh/chị gõ giúp em nhé.");
        return;
      }
      if (canListen()) beginRecognition();
    };

    recognitionRef.current = recognition;
    setListening(true);
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setListening(false);
    }
  }

  // Echo guard + loop driver: pause while the chicken speaks or the agent is
  // busy or the mic is muted; resume the moment all three are clear. No barge-in.
  useEffect(() => {
    if (!started) return;
    if (muted || speaking || isBusy) {
      pauseRecognition();
    } else if (!recognitionRef.current) {
      beginRecognition();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, muted, speaking, isBusy]);

  // First interaction: a browser gesture is required before mic + audio. Tapping
  // "Bắt đầu" requests mic permission, speaks the greeting, then goes hands-free.
  async function handleStart() {
    startedRef.current = true;
    setStarted(true);
    try {
      await navigator.mediaDevices?.getUserMedia?.({ audio: true });
    } catch {
      setMuted(true);
      setShowType(true);
      setShowCaptions(true);
      setSubtitle("Em chưa được cấp quyền mic, anh/chị bật quyền hoặc gõ giúp em nhé.");
      return;
    }
    speakLine(lastSpokenRef.current ?? VOICE_GREETING, { meaningful: true });
  }

  function toggleMute() {
    setMuted((m) => !m); // echo-guard effect stops/resumes the loop
  }

  // Hands-free: "listen" is the resting state (not a momentary flag), so the
  // stage doesn't flicker between recognition restarts.
  const state: "think" | "listen" | "speak" | "idle" = isBusy
    ? "think"
    : speaking
      ? "speak"
      : started && !muted
        ? "listen"
        : "idle";
  const statusLabel = isBusy
    ? "đang nghĩ…"
    : speaking
      ? "đang nói…"
      : muted
        ? "mic đang tắt"
        : started
          ? "đang nghe…"
          : "chạm để bắt đầu";
  const captionWho = interim ? "Bạn" : speaking ? "Đại sứ Gà" : null;

  return (
    <main className={`voice-stage voice-stage--${state}`}>
      <div className="voice-phone">
      <span className="voice-phone__notch" aria-hidden />
      {!started ? (
        <button type="button" className="voice-start" onClick={handleStart}>
          <span className="voice-start__mark" aria-hidden>
            <KfcMark />
          </span>
          <b className="voice-start__title">Đại sứ Gà KFC</b>
          <span className="voice-start__cta">Bắt đầu</span>
          <small className="voice-start__hint">Chạm để nói chuyện, em nghe rảnh tay, không cần giữ nút</small>
        </button>
      ) : null}
      <header className="voice-top">
        <div className="voice-brand">
          <div className="brand-mark" aria-hidden>
            <KfcMark />
          </div>
          <div>
            <b>Đại sứ ảo KFC</b>
            <small>Nói chuyện để đặt món</small>
          </div>
        </div>
        <div className="voice-top__right">
          <button
            type="button"
            className={`voice-cc ${showCaptions ? "is-on" : ""}`}
            aria-pressed={showCaptions}
            onClick={() => setShowCaptions((visible) => !visible)}
          >
            Phụ đề
          </button>
          <div className="voice-status">
            <span className={`voice-dot voice-dot--${state}`} />
            {statusLabel}
          </div>
          {latestOrder && latestOrder.cart.length > 0 ? (
            <span className="voice-cart__chip">
              <span className="voice-cart__count">{latestOrder.cart.length} món</span>
              <b>{latestOrder.totals.displayTotal}</b>
            </span>
          ) : null}
        </div>
      </header>

      <div className="voice-avatar">
        <div
          className="voice-avatar__tap"
          role="button"
          tabIndex={0}
          aria-label="Chạm để Đại sứ nói lại"
          onClick={repeatLastSpoken}
          onKeyDown={handleAvatarKeyDown}
        >
          <div className={`voice-glow ${speaking ? "is-speaking" : ""}`} aria-hidden />
          <div className="voice-floor" aria-hidden />
          <VrmStage speaking={speaking} thinking={isBusy} mood={mood} visemeLevel={visemeLevel} />
          {showCaptions ? (
            <div className={`voice-bubble ${interim ? "is-user" : ""} ${speaking ? "is-speaking" : ""}`}>
              {captionWho ? <span className="voice-bubble__who">{captionWho}</span> : null}
              <p className="voice-subtitle">{interim || subtitle}</p>
            </div>
          ) : null}
        </div>
        {SHOW_MENU_VISUALS && started ? (
          <ItemPopups
            messages={messages}
            isBusy={isBusy}
            outOfStock={outOfStock}
            onAdd={quickAdd}
            onOpenMenu={() => setMenuOpen(true)}
          />
        ) : null}
        {latestOrder && latestOrder.cart.length > 0 ? (
          <aside className={`voice-receipt ${latestOrder.stage === "placed" ? "is-placed" : ""}`}>
            <div className="voice-receipt__head">
              <span>Đơn của bạn</span>
              {latestOrder.stage === "placed" && latestOrder.placedOrder ? (
                <span className="voice-receipt__placed">✓ Đã đặt · #{latestOrder.placedOrder.orderNumber}</span>
              ) : null}
            </div>
            <Receipt order={latestOrder} />
          </aside>
        ) : null}
      </div>

      <div className="voice-controls">
        <button
          type="button"
          className={`voice-mic ${muted ? "is-muted" : "is-listening"} ${listening ? "is-capturing" : ""}`}
          onClick={toggleMute}
          aria-pressed={muted}
          aria-label={muted ? "Mic đang tắt, chạm để bật" : "Đang nghe, chạm để tắt mic"}
        >
          <span className="voice-mic__rings" aria-hidden>
            <i />
            <i />
          </span>
          <span className="voice-mic__icon" aria-hidden>
            <MicIcon />
          </span>
          <span className="voice-mic__label">
            {muted ? "Mic đang tắt, chạm để bật" : "Đang nghe, chạm để tắt mic"}
          </span>
        </button>

        {showType ? (
          <form
            className="voice-type"
            onSubmit={(e) => {
              e.preventDefault();
              submit(typed);
              setTyped("");
            }}
          >
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Gõ tin nhắn cho Đại sứ…"
              disabled={isBusy}
            />
            <button type="submit" disabled={isBusy || !typed.trim()}>
              Gửi
            </button>
          </form>
        ) : (
          <button type="button" className="voice-type-toggle" onClick={() => setShowType(true)}>
            hoặc gõ phím
          </button>
        )}
      </div>
      {SHOW_MENU_VISUALS && started ? (
        <MenuPanel
          open={menuOpen}
          onToggle={setMenuOpen}
          isBusy={isBusy}
          outOfStock={outOfStock}
          latestOrder={latestOrder}
          onAdd={quickAdd}
          catalog={liveCatalog}
        />
      ) : null}
      </div>
    </main>
  );
}
