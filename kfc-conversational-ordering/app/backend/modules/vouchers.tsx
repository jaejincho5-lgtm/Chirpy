"use client";

// Vouchers module — list all rules (active + inactive) and create/toggle them.
// Writes go to /api/vouchers which invalidates the runtime cache; the agent's
// apply_voucher picks up changes within the 60s cache TTL.

import { useEffect, useState } from "react";
import { vnd, type VoucherRow } from "./shared";

const TYPE_LABEL: Record<VoucherRow["discount_type"], string> = {
  percent: "Percent",
  fixed: "Amount",
  free_delivery: "Free delivery",
};

function valueLabel(row: VoucherRow) {
  if (row.discount_type === "percent") return `${row.discount_value}%${row.max_discount_vnd ? ` (max ${vnd(row.max_discount_vnd)})` : ""}`;
  if (row.discount_type === "fixed") return vnd(row.discount_value);
  return "—";
}

export function VouchersModule() {
  const [rows, setRows] = useState<VoucherRow[] | null>(null);
  const [source, setSource] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [discountType, setDiscountType] = useState<VoucherRow["discount_type"]>("fixed");
  const [discountValue, setDiscountValue] = useState("");
  const [minSubtotal, setMinSubtotal] = useState("");

  async function load() {
    const res = await fetch("/api/vouchers").catch(() => null);
    if (!res?.ok) return;
    const json = (await res.json().catch(() => null)) as { ok: boolean; vouchers: VoucherRow[]; source: string } | null;
    if (json?.ok) {
      setRows(json.vouchers);
      setSource(json.source);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggle(row: VoucherRow) {
    setBusy(true);
    const res = await fetch("/api/vouchers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle", code: row.code, isActive: !row.is_active }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const json = (await res?.json().catch(() => null)) as { error?: string } | null;
      setMsg(json?.error ?? "Could not update voucher (Supabase required).");
      return;
    }
    setMsg(null);
    load();
  }

  async function create() {
    if (!code.trim()) return;
    setBusy(true);
    const res = await fetch("/api/vouchers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        code: code.trim().toUpperCase(),
        description: description.trim() || code.trim().toUpperCase(),
        discountType,
        discountValue: Number(discountValue) || 0,
        minimumSubtotalVnd: Number(minSubtotal) || 0,
      }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const json = (await res?.json().catch(() => null)) as { error?: string } | null;
      setMsg(json?.error ?? "Could not create voucher (Supabase required).");
      return;
    }
    setMsg(null);
    setCode("");
    setDescription("");
    setDiscountValue("");
    setMinSubtotal("");
    load();
  }

  return (
    <section className="ops">
      <div className="ops__head">
        <p className="rail-title">Vouchers, promotion management</p>
        {source ? <small className="ops__subnote">source: {source === "db" ? "Supabase" : "default (offline)"}</small> : null}
      </div>
      {msg ? <p className="oms-error">{msg}</p> : null}

      <div className="vch-create">
        <input placeholder="CODE" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={20} />
        <input placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        <select value={discountType} onChange={(e) => setDiscountType(e.target.value as VoucherRow["discount_type"])}>
          <option value="fixed">Amount (VND)</option>
          <option value="percent">Percent (%)</option>
          <option value="free_delivery">Free delivery</option>
        </select>
        <input
          placeholder="Value"
          value={discountValue}
          onChange={(e) => setDiscountValue(e.target.value.replace(/\D/g, ""))}
          disabled={discountType === "free_delivery"}
        />
        <input
          placeholder="Minimum order"
          value={minSubtotal}
          onChange={(e) => setMinSubtotal(e.target.value.replace(/\D/g, ""))}
        />
        <button type="button" onClick={create} disabled={busy || !code.trim()}>
          Create
        </button>
      </div>

      <div className="vch-list">
        {rows === null ? (
          <p className="ops__empty">Loading...</p>
        ) : rows.length ? (
          rows.map((row) => (
            <div className={`vch-row ${row.is_active ? "" : "vch-row--off"}`} key={row.code}>
              <b className="vch-row__code">{row.code}</b>
              <span className="vch-row__desc">{row.description}</span>
              <span className="vch-row__type">{TYPE_LABEL[row.discount_type]}</span>
              <span className="vch-row__val">{valueLabel(row)}</span>
              <span className="vch-row__min">≥ {vnd(row.minimum_subtotal_vnd)}</span>
              <button
                type="button"
                className={`vch-toggle ${row.is_active ? "is-on" : "is-off"}`}
                disabled={busy}
                onClick={() => toggle(row)}
              >
                {row.is_active ? "On" : "Off"}
              </button>
            </div>
          ))
        ) : (
          <p className="ops__empty">No vouchers yet.</p>
        )}
      </div>
    </section>
  );
}
