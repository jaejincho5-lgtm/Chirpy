"use client";

// Director module — the demo control room. Mirrors the /user tab live over the
// demo bus (transcript, order receipt, tool trace) and sends control commands
// back (persona, weather, hour, return-visit reset). Weather also steers the
// Messenger channel via /api/demo. This module owns the BroadcastChannel and
// stays mounted across tab switches so its live link never resets.

import { useEffect, useRef, useState } from "react";
import {
  DEMO_BUS,
  Receipt,
  TraceConsole,
  type DemoBusMessage,
  type DemoSettings,
  type ToolTrace,
  type TranscriptLine,
} from "../../demo-shared";
import type { Order } from "@/lib/order";
import { vnd, type ProfileFeed } from "./shared";

type MirrorConvo = {
  id: string;
  customerId: string;
  updatedAt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  order: Order | null;
};

export function DirectorModule() {
  const [settings, setSettings] = useState<DemoSettings>({ customerId: "linh", weather: "live", hour: 12, daysAhead: 0 });
  const [order, setOrder] = useState<Order | null>(null);
  const [traces, setTraces] = useState<ToolTrace[]>([]);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [linked, setLinked] = useState(false);
  const [pepsiOos, setPepsiOos] = useState(false);
  const [feed, setFeed] = useState<ProfileFeed | null>(null);
  const [mirrorSource, setMirrorSource] = useState<"user" | "messenger">("user");
  const [mirror, setMirror] = useState<MirrorConvo | null>(null);
  const busRef = useRef<BroadcastChannel | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const response = await fetch(`/api/profile?customerId=${encodeURIComponent(settings.customerId)}`).catch(() => null);
      if (!response?.ok) return;
      const json = (await response.json().catch(() => null)) as ProfileFeed | null;
      if (!cancelled && json?.ok) setFeed(json);
    }
    load();
    const timer = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [settings.customerId]);

  useEffect(() => {
    const bus = new BroadcastChannel(DEMO_BUS);
    busRef.current = bus;
    bus.onmessage = (event: MessageEvent<DemoBusMessage>) => {
      const message = event.data;
      if (message.kind !== "state") return;
      setLinked(true);
      setSettings(message.settings);
      setOrder(message.order);
      setTraces(message.traces);
      setTranscript(message.transcript);
      setIsBusy(message.isBusy);
    };
    bus.postMessage({ kind: "hello" } satisfies DemoBusMessage);
    return () => {
      busRef.current = null;
      bus.close();
    };
  }, []);

  useEffect(() => {
    if (mirrorSource !== "messenger") return;
    let cancelled = false;
    async function load() {
      const list = await fetch("/api/console-state")
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null);
      const newest = list?.conversations?.[0];
      if (!newest) return;
      const detail = await fetch(`/api/console-state?convo=${encodeURIComponent(newest.id)}`)
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null);
      if (!cancelled && detail?.ok) setMirror(detail.convo as MirrorConvo);
    }
    load();
    const timer = setInterval(load, 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [mirrorSource]);

  const mirrorTranscript: TranscriptLine[] =
    mirrorSource === "messenger" && mirror
      ? mirror.messages.map((message, index) => ({
          id: `${mirror.id}_${index}`,
          role: message.role,
          text: message.content,
        }))
      : transcript;
  const displayedOrder = mirrorSource === "messenger" ? (mirror?.order ?? null) : order;

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript, mirror]);

  function sendControl(control: { settings?: Partial<DemoSettings>; reset?: boolean }) {
    if (control.settings) setSettings((current) => ({ ...current, ...control.settings }));
    busRef.current?.postMessage({ kind: "control", ...control } satisfies DemoBusMessage);
  }

  function setWeather(weather: DemoSettings["weather"]) {
    // Steers BOTH paths: the /user web stage (bus) and the Messenger channel
    // (server-side context via /api/demo). "live" clears any override so both
    // paths use real Open-Meteo weather.
    sendControl({ settings: { weather } });
    void fetch("/api/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weather }),
    }).catch(() => null);
  }

  async function togglePepsiOos() {
    const next = !pepsiOos;
    const response = await fetch("/api/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outOfStock: next ? ["pepsi-medium"] : [] }),
    }).catch(() => null);
    if (response?.ok) setPepsiOos(next);
  }

  const weatherOptions: Array<{ key: DemoSettings["weather"]; label: string }> = [
    { key: "live", label: "Live ☁️" },
    { key: "clear", label: "Nắng" },
    { key: "rainy", label: "Mưa" },
    { key: "hot", label: "Nóng" },
  ];

  return (
    <div className="backend-grid">
      <aside className="director-rail">
        <p className="rail-title">Bàn điều khiển</p>
        <div className="controls">
          <label className="control">
            <span>Khách hàng</span>
            <select
              value={settings.customerId}
              onChange={(event) => sendControl({ settings: { customerId: event.target.value } })}
            >
              <option value="linh">Linh, khách quen</option>
              <option value="linh_mom">Mẹ Linh, đơn gia đình</option>
              <option value="guest">Khách mới</option>
            </select>
          </label>
          <div className="control">
            <span>Thời tiết</span>
            <div className="segmented">
              {weatherOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={settings.weather === option.key ? "is-active" : ""}
                  onClick={() => setWeather(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="control">
            <span>Thời điểm</span>
            <div className="segmented">
              <button
                type="button"
                className={settings.hour === 12 ? "is-active" : ""}
                onClick={() => sendControl({ settings: { hour: 12 } })}
              >
                Trưa
              </button>
              <button
                type="button"
                className={settings.hour === 19 ? "is-active" : ""}
                onClick={() => sendControl({ settings: { hour: 19 } })}
              >
                Tối
              </button>
            </div>
          </div>
          <div className="control">
            <span>Đồng hồ demo</span>
            <div className="segmented">
              <button
                type="button"
                className={settings.daysAhead === 0 ? "is-active" : ""}
                onClick={() => sendControl({ settings: { daysAhead: 0 } })}
              >
                Hôm nay
              </button>
              <button
                type="button"
                className={settings.daysAhead === 1 ? "is-active" : ""}
                onClick={() => sendControl({ settings: { daysAhead: 1 } })}
              >
                Ngày mai
              </button>
              <button
                type="button"
                className={settings.daysAhead === 7 ? "is-active" : ""}
                onClick={() => sendControl({ settings: { daysAhead: 7 } })}
              >
                Tuần sau
              </button>
            </div>
          </div>
          <div className="control-actions">
            <button
              type="button"
              className="btn-nudge"
              onClick={() => busRef.current?.postMessage({ kind: "nudge" } satisfies DemoBusMessage)}
            >
              Gửi tin chủ động (nudge)
              <small>opt-in · tối đa 1/tuần · tự tắt sau 2 lần bỏ qua</small>
            </button>
            <button type="button" className="btn-return" onClick={() => sendControl({ reset: true })}>
              Khách quay lại, chat mới
            </button>
            <button type="button" className={`btn-oos ${pepsiOos ? "is-active" : ""}`} onClick={togglePepsiOos}>
              {pepsiOos ? "Pepsi hết hàng, đang bật" : "Kịch bản: Pepsi hết hàng"}
            </button>
          </div>
        </div>
      </aside>

      <div>
        <div className="transcript-head">
          <p className="rail-title">Hội thoại (đồng bộ trực tiếp)</p>
          <div className="segmented segmented--mini">
            <button
              type="button"
              className={mirrorSource === "user" ? "is-active" : ""}
              onClick={() => setMirrorSource("user")}
            >
              /user
            </button>
            <button
              type="button"
              className={mirrorSource === "messenger" ? "is-active" : ""}
              onClick={() => setMirrorSource("messenger")}
            >
              Messenger (thật)
            </button>
          </div>
        </div>
        {mirrorSource === "messenger" && mirror ? (
          <p className="mirror-meta">
            {mirror.id} · cập nhật {new Date(mirror.updatedAt).toLocaleTimeString("vi-VN")}
          </p>
        ) : null}
        <div className="transcript" ref={transcriptRef}>
          {mirrorTranscript.length ? (
            mirrorTranscript.map((line) => (
              <div className={`transcript__line transcript__line--${line.role}`} key={line.id}>
                <b>{line.role === "user" ? "Khách" : "Agent"}</b>
                <span>{line.text}</span>
              </div>
            ))
          ) : (
            <p className="transcript__empty">
              {mirrorSource === "messenger"
                ? "Chưa có hội thoại Messenger nào, nhắn tin cho Page để bắt đầu."
                : linked
                  ? "Chưa có tin nhắn, thao tác ở tab /user."
                  : "Mở /user trong tab khác (cùng trình duyệt) để đồng bộ."}
            </p>
          )}
          {isBusy && mirrorSource === "user" ? <p className="transcript__busy">agent đang trả lời…</p> : null}
        </div>
      </div>

      <div className="console-col">
        <div>
          <p className="rail-title">Trạng thái đơn</p>
          <Receipt order={displayedOrder} />
        </div>
        <div>
          <p className="rail-title">Hồ sơ vị giác, bộ nhớ (live)</p>
          <div className="profile-card">
            {feed?.ok ? (
              <>
                <div className="profile-card__row profile-card__usual">
                  <span>Món quen</span>
                  <b>
                    {feed.profile.usual
                      ? `${feed.profile.usual.name} · ${Math.round(feed.profile.usual.share * 100)}%`
                      : "chưa đủ dữ liệu"}
                  </b>
                </div>
                <div className="profile-card__row">
                  <span>Vị · Số đơn · Ticket TB</span>
                  <b>
                    {feed.profile.spice === "spicy" ? "cay" : feed.profile.spice === "original" ? "truyền thống" : "—"}
                    {" · "}
                    {feed.profile.orderCount} đơn · {vnd(feed.profile.avgTicketVnd)}
                  </b>
                </div>
                {feed.profile.attachRates.length > 0 ? (
                  <div className="profile-bars">
                    {feed.profile.attachRates.map((attach) => (
                      <div className="profile-bar" key={attach.catalogId}>
                        <small>{attach.name}</small>
                        <div className="profile-bar__track">
                          <div className="profile-bar__fill" style={{ width: `${Math.round(attach.rate * 100)}%` }} />
                        </div>
                        <small>{Math.round(attach.rate * 100)}%</small>
                      </div>
                    ))}
                  </div>
                ) : null}
                {feed.profile.declined.length > 0 ? (
                  <p className="profile-declined">
                    Không gợi ý lại: {feed.profile.declined.map((item) => item.name).join(", ")}
                  </p>
                ) : null}
                <div className="profile-card__row profile-card__take">
                  <span>Gợi ý được nhận</span>
                  <b>
                    {feed.suggestions.accepted}/{feed.suggestions.accepted + feed.suggestions.declined}
                    {feed.suggestions.acceptedRevenueVnd > 0 ? ` · +${vnd(feed.suggestions.acceptedRevenueVnd)}` : ""}
                  </b>
                </div>
                {feed.cost?.estVnd != null ? (
                  <div className="profile-card__row">
                    <span>Chi phí AI phiên này</span>
                    <b>~{vnd(feed.cost.estVnd)} · {feed.cost.turns} lượt</b>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="profile-card__empty">Chưa có dữ liệu, đặt một đơn ở /user.</p>
            )}
          </div>
        </div>
        <div>
          <p className="rail-title">Bên trong agent</p>
          <TraceConsole traces={traces} />
          <p className="console-note" style={{ marginTop: 10 }}>
            Mỗi dòng là một tool call thật của model, menu, giá, voucher đều lấy từ catalog, không sinh từ LLM.
          </p>
        </div>
      </div>
    </div>
  );
}
