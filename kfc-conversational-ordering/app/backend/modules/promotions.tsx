"use client";

// Promotions module — staff compose a promo and blast it to customers on the
// channel they already use. Two delivery paths, one click:
//   • POST /api/broadcast → real Messenger sends to recent opted-in customers.
//   • demo bus `promo`    → the /user phone shows it instantly on stage (the
//     web demo has no server push channel, so the bus is the visible proof).

import { useEffect, useRef, useState } from "react";
import { vnd, type VoucherRow } from "./shared";
import { DEMO_BUS, type DemoBusMessage } from "../../demo-shared";

// One-click demo blast: pre-written "suggestion of the day" so the operator
// can fire a believable promo without typing anything on stage.
const SUGGESTED_PROMO =
  "Hot lunch, no need to head out? Get crispy fried chicken with a cold Pepsi delivered in 30 minutes. Use code KFC20 for 20% off, capped at 60,000 VND, on orders from 80,000 VND. Reply \"combo\" to order now.";

const TEMPLATES = [
  "Tuesday deal: Fried Chicken Combo for only 79k today. Reply \"combo\" to order now.",
  "Rainy day? Hot chicken delivered to your door, ordered by chat in 30 seconds. What are you craving?",
  "For loyal KFC customers tonight: free delivery on orders from 150k. Order now.",
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

  // Accepts an override so the suggested-promo card can send in one click
  // without a compose step; the textarea still mirrors what went out.
  async function send(textOverride?: string) {
    const text = (textOverride ?? message).trim();
    if (!text) return;
    if (textOverride) setMessage(textOverride);
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
      setError(json?.error ?? "Could not send promotion.");
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
        <p className="rail-title">Promotions, compose &amp; send</p>
        <small className="ops__subnote">Send through Messenger to customers in the 24h window and mirror instantly on /user (demo)</small>
      </div>
      {error ? <p className="oms-error">{error}</p> : null}

      <div className="promo-suggest">
        <div className="promo-suggest__text">
          <b>✨ Today's suggestion · hot lunch + KFC20 is active</b>
          <p>{SUGGESTED_PROMO}</p>
        </div>
        <button type="button" className="promo-suggest__send" disabled={busy} onClick={() => send(SUGGESTED_PROMO)}>
          {busy ? "Sending..." : "Send now"}
        </button>
      </div>

      <div className="promo-compose">
        <textarea
          className="promo-textarea"
          placeholder="Write a promotional message for customers..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={1800}
          rows={4}
        />
        <div className="promo-meta">
          <span>{message.length}/1800</span>
          <button type="button" onClick={() => send()} disabled={busy || !message.trim()}>
            {busy ? "Sending..." : "Send to customers"}
          </button>
        </div>
      </div>

      {result ? (
        <p className="promo-result">
          Sent to <b>{result.sent}</b>/{result.attempted} customers through Messenger
          {result.attempted === 0 ? " (no customers are currently in the 24h window, demo still mirrors on /user)" : ""}.
        </p>
      ) : null}

      <div className="promo-templates">
        <p className="promo-templates__title">Quick templates</p>
        {TEMPLATES.map((t) => (
          <button key={t} type="button" className="promo-template" onClick={() => setMessage(t)}>
            {t}
          </button>
        ))}
      </div>

      {vouchers.length ? (
        <div className="promo-vouchers">
          <p className="promo-templates__title">Insert active code</p>
          <div className="promo-voucher-chips">
            {vouchers.map((v) => (
              <button
                key={v.code}
                type="button"
                className="promo-voucher-chip"
                onClick={() => setMessage((m) => `${m ? `${m.trimEnd()} ` : ""}Use code ${v.code}!`)}
                title={`${v.description} · minimum order ${vnd(v.minimum_subtotal_vnd)}`}
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
