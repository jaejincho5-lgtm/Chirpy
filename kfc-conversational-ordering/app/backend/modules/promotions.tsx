"use client";

// Promotions module — staff compose a promo and blast it to customers on the
// channel they already use. Two delivery paths, one click:
//   • POST /api/broadcast → real Messenger sends to recent opted-in customers.
//   • demo bus `promo`    → the /user phone shows it instantly on stage (the
//     web demo has no server push channel, so the bus is the visible proof).

import { useEffect, useRef, useState } from "react";
import { vnd, type VoucherRow } from "./shared";
import { DEMO_BUS, type DemoBusMessage } from "../../demo-shared";

const TEMPLATES = [
  "🔥 Thứ Ba vui vẻ! Combo Gà Rán chỉ 79k hôm nay — nhắn “combo” để đặt ngay nhé!",
  "Trời mưa rồi ☔ Gà nóng giao tận nơi, đặt qua chat trong 30 giây. Bạn thèm gì?",
  "🎁 Riêng khách quen KFC: freeship cho đơn từ 150k tối nay. Đặt liền nha!",
];

export function PromotionsModule() {
  const [message, setMessage] = useState("");
  const [vouchers, setVouchers] = useState<VoucherRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ attempted: number; sent: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const bus = new BroadcastChannel(DEMO_BUS);
    busRef.current = bus;
    return () => {
      busRef.current = null;
      bus.close();
    };
  }, []);

  useEffect(() => {
    fetch("/api/vouchers")
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { ok: boolean; vouchers: VoucherRow[] } | null) => {
        if (json?.ok) setVouchers(json.vouchers.filter((v) => v.is_active));
      })
      .catch(() => null);
  }, []);

  async function send() {
    const text = message.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    setResult(null);

    // Real channel sends (Messenger). No-ops to sent:0 without MESSENGER_TOKEN.
    const res = await fetch("/api/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    }).catch(() => null);
    setBusy(false);

    if (!res?.ok) {
      const json = (await res?.json().catch(() => null)) as { error?: string } | null;
      setError(json?.error ?? "Không gửi được khuyến mãi.");
      return;
    }
    const json = (await res.json().catch(() => null)) as { attempted: number; sent: number } | null;
    setResult(json ? { attempted: json.attempted, sent: json.sent } : { attempted: 0, sent: 0 });

    // Demo mirror: show the blast on the /user phone immediately.
    busRef.current?.postMessage({ kind: "promo", text } satisfies DemoBusMessage);
  }

  return (
    <section className="ops">
      <div className="ops__head">
        <p className="rail-title">Khuyến mãi — soạn &amp; gửi tới khách</p>
        <small className="ops__subnote">Gửi qua Messenger cho khách trong 24h + hiển thị ngay trên /user (demo)</small>
      </div>
      {error ? <p className="oms-error">{error}</p> : null}

      <div className="promo-compose">
        <textarea
          className="promo-textarea"
          placeholder="Soạn nội dung khuyến mãi gửi tới khách…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={1800}
          rows={4}
        />
        <div className="promo-meta">
          <span>{message.length}/1800</span>
          <button type="button" onClick={send} disabled={busy || !message.trim()}>
            {busy ? "Đang gửi…" : "📣 Gửi tới khách"}
          </button>
        </div>
      </div>

      {result ? (
        <p className="promo-result">
          Đã gửi tới <b>{result.sent}</b>/{result.attempted} khách qua Messenger
          {result.attempted === 0 ? " (chưa có khách nào trong cửa sổ 24h — demo hiển thị trên /user)" : ""}.
        </p>
      ) : null}

      <div className="promo-templates">
        <p className="promo-templates__title">Mẫu nhanh</p>
        {TEMPLATES.map((t) => (
          <button key={t} type="button" className="promo-template" onClick={() => setMessage(t)}>
            {t}
          </button>
        ))}
      </div>

      {vouchers.length ? (
        <div className="promo-vouchers">
          <p className="promo-templates__title">Chèn mã đang chạy</p>
          <div className="promo-voucher-chips">
            {vouchers.map((v) => (
              <button
                key={v.code}
                type="button"
                className="promo-voucher-chip"
                onClick={() => setMessage((m) => `${m ? `${m.trimEnd()} ` : ""}Dùng mã ${v.code} nhé!`)}
                title={`${v.description} · đơn tối thiểu ${vnd(v.minimum_subtotal_vnd)}`}
              >
                {v.code}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
