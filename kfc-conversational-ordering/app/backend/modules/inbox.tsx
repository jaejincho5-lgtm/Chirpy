"use client";

// Inbox module — live Messenger conversations with human takeover. Polls
// /api/takeover every 3s: left rail lists recent conversations (takeover
// badge), right pane shows the transcript. "Tiếp quản" pauses the agent for
// this conversation (webhook parks inbound messages); the composer sends a
// human reply through the same Send API the agent uses. "Trả lại AI" resumes —
// the agent sees the human's messages as normal transcript context.

import { useEffect, useRef, useState } from "react";
import { time } from "./shared";

type InboxMessage = { role: "user" | "assistant"; content: string };

type InboxConvo = {
  id: string;
  customerId: string;
  updatedAt: string;
  takeover: boolean;
  lastMessage: InboxMessage | null;
  messages: InboxMessage[];
};

export function InboxModule() {
  const [convos, setConvos] = useState<InboxConvo[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  async function load() {
    const res = await fetch("/api/takeover").catch(() => null);
    if (!res?.ok) return;
    const json = (await res.json().catch(() => null)) as { ok: boolean; conversations: InboxConvo[] } | null;
    if (json?.ok) setConvos(json.conversations);
  }

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (!cancelled) void load();
    };
    tick();
    const timer = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const convo = convos?.find((item) => item.id === selected) ?? null;

  // Keep the transcript pinned to the newest message while polling refreshes it.
  const messageCount = convo?.messages.length ?? 0;
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [selected, messageCount]);

  async function setTakeover(convoId: string, active: boolean) {
    setNotice(null);
    const res = await fetch("/api/takeover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set", convoId, active }),
    }).catch(() => null);
    if (!res?.ok) {
      setNotice("Không đổi được chế độ, thử lại nhé.");
      return;
    }
    setConvos((prev) => prev?.map((c) => (c.id === convoId ? { ...c, takeover: active } : c)) ?? prev);
  }

  async function sendReply() {
    if (!convo || !draft.trim() || sending) return;
    setSending(true);
    setNotice(null);
    const text = draft.trim();
    const res = await fetch("/api/takeover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reply", convoId: convo.id, text }),
    }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { ok?: boolean; sent?: boolean; sendReason?: string } | null;
    setSending(false);
    if (!json?.ok) {
      setNotice("Gửi thất bại, thử lại nhé.");
      return;
    }
    setDraft("");
    // Optimistic append; the 3s poll reconciles with the server copy.
    setConvos(
      (prev) =>
        prev?.map((c) =>
          c.id === convo.id
            ? { ...c, takeover: true, messages: [...c.messages, { role: "assistant", content: text }] }
            : c,
        ) ?? prev,
    );
    if (json.sent === false) {
      setNotice(`Đã lưu vào hội thoại nhưng Messenger chưa nhận: ${json.sendReason ?? "không rõ lý do"}.`);
    }
  }

  return (
    <section className="ops">
      <div className="ops__head">
        <p className="rail-title">Hộp thư &amp; tiếp quản</p>
        <small className="ops__subnote">Tiếp quản = agent tạm dừng trên hội thoại đó, nhân viên trả lời tay</small>
      </div>
      <div className="cust-cols inbox-cols">
        <div className="cust-list">
          {convos === null ? (
            <p className="ops__empty">Đang tải…</p>
          ) : convos.length ? (
            convos.map((item) => (
              <button
                type="button"
                className={`cust-row ${selected === item.id ? "is-active" : ""}`}
                key={item.id}
                onClick={() => setSelected(item.id)}
              >
                <div className="cust-row__id">
                  <b>{item.customerId}</b>
                  <span className="cust-row__chan">
                    {item.lastMessage ? `${item.lastMessage.role === "user" ? "Khách" : "Trả lời"}: ${item.lastMessage.content.slice(0, 48)}` : "chưa có tin nhắn"}
                  </span>
                </div>
                <div className="cust-row__pts">
                  <span className={`inbox-badge ${item.takeover ? "inbox-badge--human" : ""}`}>
                    {item.takeover ? "🧑 Người" : "🤖 AI"}
                  </span>
                  <small>{time(item.updatedAt)}</small>
                </div>
              </button>
            ))
          ) : (
            <p className="ops__empty">Chưa có hội thoại Messenger nào.</p>
          )}
        </div>

        <div className="cust-detail inbox-pane">
          {!convo ? (
            <p className="ops__empty">Chọn một hội thoại để xem và tiếp quản.</p>
          ) : (
            <>
              <div className="inbox-pane__head">
                <b>{convo.customerId}</b>
                <button
                  type="button"
                  className={`inbox-toggle ${convo.takeover ? "inbox-toggle--human" : ""}`}
                  onClick={() => setTakeover(convo.id, !convo.takeover)}
                >
                  {convo.takeover ? "Trả lại AI 🤖" : "Tiếp quản 🧑"}
                </button>
              </div>

              <div className="inbox-transcript" ref={transcriptRef}>
                {convo.messages.length ? (
                  convo.messages.map((message, index) => (
                    <p
                      key={`${index}-${message.content.slice(0, 16)}`}
                      className={`inbox-msg ${message.role === "user" ? "inbox-msg--user" : "inbox-msg--bot"}`}
                    >
                      {message.content}
                    </p>
                  ))
                ) : (
                  <p className="ops__empty">Hội thoại trống.</p>
                )}
              </div>

              <div className="inbox-composer">
                <textarea
                  rows={2}
                  placeholder={
                    convo.takeover
                      ? "Nhắn khách với tư cách nhân viên…"
                      : "Gửi sẽ tự động tiếp quản (agent tạm dừng)…"
                  }
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendReply();
                    }
                  }}
                />
                <button type="button" className="inbox-send" disabled={sending || !draft.trim()} onClick={() => void sendReply()}>
                  {sending ? "Đang gửi…" : "Gửi"}
                </button>
              </div>
              {notice ? <p className="inbox-notice">{notice}</p> : null}
              <p className="console-note">
                Tiếp quản tự trả lại AI sau 60 phút không hoạt động. Tin nhắn của bạn nằm trong transcript nên agent
                tiếp tục mạch hội thoại khi nhận lại.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
