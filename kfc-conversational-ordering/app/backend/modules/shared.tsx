"use client";

// Shared helpers, primitives + feed types for the /backend modules. The console
// reads as ONE product only if every module uses the same layout grammar
// (ModuleHeader → KpiStrip → Cards), the same money/time formatters, and the
// same status/empty treatments. These primitives are the single source of that
// grammar — build once here, adopt everywhere. All styles are namespaced `.bk-*`.

import type { ReactNode } from "react";

// ONE money formatter (VND, thousand separators) and ONE humanized timestamp.
export const fmtVnd = (value: number) => `${Math.round(value).toLocaleString("en-US")} VND`;

export function fmtTimeAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const min = Math.floor(Math.max(0, now - t) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} h ago`;
  return `${Math.floor(hr / 24)} d ago`;
}

// Kept for existing call sites; fmtVnd is the canonical formatter going forward.
export const vnd = fmtVnd;

export const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export const secs = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toFixed(1)}s`);

export function ChannelBadge({ channel, synthetic }: { channel: "web" | "messenger"; synthetic?: boolean }) {
  if (synthetic) return <span className="chan chan--test">test</span>;
  return <span className={`chan chan--${channel}`}>{channel === "messenger" ? "Messenger" : "Web"}</span>;
}

// ---- layout grammar primitives ---------------------------------------------

export function ModuleHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="bk-modhead">
      <div className="bk-modhead__text">
        <h2 className="bk-modhead__title">{title}</h2>
        {description ? <p className="bk-modhead__desc">{description}</p> : null}
      </div>
      {action ? <div className="bk-modhead__action">{action}</div> : null}
    </div>
  );
}

export function KpiStrip({ items }: { items: Array<{ label: string; value: ReactNode; delta?: ReactNode }> }) {
  return (
    <div className="bk-kpis">
      {items.map((item, index) => (
        <div className="bk-kpi" key={index}>
          <small className="bk-kpi__label">{item.label}</small>
          <b className="bk-kpi__value">{item.value}</b>
          {item.delta != null ? <span className="bk-kpi__delta">{item.delta}</span> : null}
        </div>
      ))}
    </div>
  );
}

export function Card({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`bk-card ${className ?? ""}`}>
      {title ? <div className="bk-card__title">{title}</div> : null}
      <div className="bk-card__body">{children}</div>
    </section>
  );
}

export function CardGrid({ children }: { children: ReactNode }) {
  return <div className="bk-cardgrid">{children}</div>;
}

export function EmptyState({ icon, message, action }: { icon?: ReactNode; message: string; action?: ReactNode }) {
  return (
    <div className="bk-empty">
      {icon ? (
        <div className="bk-empty__icon" aria-hidden>
          {icon}
        </div>
      ) : null}
      <p className="bk-empty__msg">{message}</p>
      {action ? <div className="bk-empty__action">{action}</div> : null}
    </div>
  );
}

// One status vocabulary for every enum in the app: colored dot plus label, so
// no raw enum string ever renders. Falls back to a neutral tone for unknowns.
const STATUS_META: Record<string, { vi: string; tone: string }> = {
  // order stages
  placed: { vi: "Placed", tone: "blue" },
  preparing: { vi: "Preparing", tone: "amber" },
  ready: { vi: "Ready", tone: "green" },
  completed: { vi: "Completed", tone: "green" },
  cancelled: { vi: "Cancelled", tone: "red" },
  // voucher / generic on-off
  active: { vi: "On", tone: "green" },
  inactive: { vi: "Off", tone: "gray" },
  on: { vi: "In stock", tone: "green" },
  off: { vi: "Out of stock", tone: "red" },
  // nudge gate outcomes
  sent: { vi: "Sent", tone: "green" },
  gated: { vi: "Blocked", tone: "amber" },
  skipped: { vi: "Skipped", tone: "gray" },
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const meta = STATUS_META[status] ?? { vi: label ?? status, tone: "gray" };
  return (
    <span className={`bk-badge bk-badge--${meta.tone}`}>
      <i className="bk-badge__dot" aria-hidden />
      {label ?? meta.vi}
    </span>
  );
}

// /api/profile — the console's live memory/take-rate/cost feed (A1/A4/C9).
export type ProfileFeed = {
  ok: boolean;
  profile: {
    orderCount: number;
    usual: { name: string; share: number } | null;
    spice: "spicy" | "original" | null;
    attachRates: { catalogId: string; name: string; rate: number }[];
    declined: { catalogId: string; name: string }[];
    avgTicketVnd: number;
  };
  suggestions: { accepted: number; declined: number; takeRate: number | null; acceptedRevenueVnd: number };
  cost: { turns: number; estUsd: number | null; estVnd: number | null; model: string } | null;
};

// /api/console — the cross-channel transaction + analysis feed.
export type ConsoleFeed = {
  ok: boolean;
  kpis: {
    orders: number;
    distinctCustomers: number;
    aovVnd: number | null;
    suggestions: { accepted: number; declined: number; takeRate: number | null };
    turns: number;
    channels: Record<string, number>;
    latency: { p50Ms: number | null; p95Ms: number | null };
    tokens: { inputTokens: number; cachedInputTokens: number; cacheWriteTokens: number; outputTokens: number };
    aiCost: { usd: number | null; vnd: number | null; coveredTurns: number };
  };
  orders: Array<{
    at: string;
    customerId: string;
    orderId: string;
    totalVnd: number;
    itemCount: number;
    channel: "web" | "messenger";
  }>;
  turns: Array<{
    at: string;
    channel: "web" | "messenger";
    customerId: string;
    synthetic: boolean;
    userText: string;
    replyText: string;
    tools: string[];
    model: string;
    tokens: { input: number; reads: number; writes: number; output: number };
    latencyMs: number;
    costVnd: number | null;
    placedOrder: boolean;
  }>;
};

// /api/orders — OMS queue.
export type OmsStage = "placed" | "preparing" | "ready" | "completed" | "cancelled";

export type OmsOrderRow = {
  id: string;
  channel: "web" | "messenger";
  customerId: string | null;
  stage: OmsStage;
  omsOrderNumber: string;
  totalVnd: number;
  itemsSummary: string;
  createdAt: string;
  updatedAt: string;
};

// /api/loyalty — members.
export type LoyaltyMember = {
  customerId: string;
  points: number;
  lifetimePoints: number;
  updatedAt: string;
};

// /api/vouchers — rules.
export type VoucherRow = {
  code: string;
  description: string;
  minimum_subtotal_vnd: number;
  discount_type: "percent" | "fixed" | "free_delivery";
  discount_value: number;
  max_discount_vnd: number | null;
  is_active: boolean;
};
