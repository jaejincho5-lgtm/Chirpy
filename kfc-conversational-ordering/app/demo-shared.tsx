"use client";

// Shared pieces for the split demo surfaces:
//   /user    — the customer's phone (chat only, no operator chrome)
//   /backend — the director's console (script, controls, receipt, tool trace)
// The two tabs sync over a BroadcastChannel bus (same browser, same origin):
// /user broadcasts state after every change; /backend broadcasts control
// commands and greets with "hello" so a late-opened console gets a snapshot.

import type { Order } from "@/lib/order";

/* ---------- bus protocol ---------- */

export const DEMO_BUS = "colonel-demo";

export type DemoSettings = {
  customerId: string;
  // "live" defers to the server's real Open-Meteo weather (no client override).
  weather: "clear" | "rainy" | "hot" | "live";
  hour: number;
  /** Demo clock: pretend this many days have passed (0 = today). */
  daysAhead: number;
};

export type TranscriptLine = { id: string; role: "user" | "assistant"; text: string };

export type DemoBusMessage =
  | {
      kind: "state";
      settings: DemoSettings;
      order: Order | null;
      traces: ToolTrace[];
      transcript: TranscriptLine[];
      isBusy: boolean;
    }
  | { kind: "control"; settings?: Partial<DemoSettings>; reset?: boolean }
  | { kind: "nudge" }
  // Proactive order-status update mirrored from /backend's Orders module into
  // the /user phone. `customerId` gates it so it only lands in the matching
  // customer's chat.
  | { kind: "order-status"; customerId: string; text: string }
  // Staff promo blast mirrored from /backend's Promotions module into /user.
  | { kind: "promo"; text: string }
  | { kind: "hello" };

/* ---------- chat data types ---------- */

export type ChatPart = {
  type: string;
  text?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  toolCallId?: string;
};

export type MenuMatch = {
  catalogId: string;
  matchId: string;
  name: string;
  vietnameseName: string;
  description: string;
  displayPrice: string;
  category: string;
};

export type AddonSuggestion = {
  catalogId: string;
  name: string;
  displayPrice: string;
  reason: string;
};

export type BillProposal = {
  swapId: string;
  displaySavings: string;
  summary: string;
};

export type ResponseContract = {
  say: string;
  order_state?: unknown;
  next_action?: string | null;
};

export type ToolTrace = {
  id: string;
  name: string;
  ok: boolean;
  summary: string;
};

/* ---------- demo content ---------- */

export const quickReplies = [
  "Cho mình 1 combo gà rán 1 miếng và 1 Pepsi",
  "Áp mã KFC20 và dùng điểm của mình",
  "Xác nhận giao tới nhà, SĐT 0901234567",
  "Đơn này sai rồi, cho mình gặp nhân viên",
];

export const emptyPrompts = [
  "Cho mình 1 burger zinger và khoai tây",
  "Thèm gì đó giòn giòn cay cay, dưới 100k",
  "Áp mã KFC20 giúp mình",
];

export const demoBeats = [
  { label: "Gọi món bằng tiếng Việt", hint: "search_menu → add_to_cart" },
  { label: "Gợi ý theo ngữ cảnh", hint: "trời mưa → súp rong biển nóng" },
  { label: "Voucher + điểm thưởng", hint: "KFC20, loyalty redeem" },
  { label: "Combo Math tiết kiệm", hint: "optimize_bill → swap" },
  { label: "OTP → đặt hàng", hint: "kịch bản hết hàng tự xử lý" },
  { label: "Khách quay lại", hint: "“như mọi khi?”, taste memory" },
];

/* ---------- helpers ---------- */

export function getPartOutput<T>(part: ChatPart): T | undefined {
  if (part.output && typeof part.output === "object") return part.output as T;
  return undefined;
}

export function getLatestOrder(messages: { parts?: unknown[] }[]) {
  let latest: Order | undefined;
  for (const message of messages) {
    for (const part of (message.parts ?? []) as ChatPart[]) {
      const output = getPartOutput<{ order?: Order }>(part);
      if (output?.order) latest = output.order;
    }
  }
  return latest;
}

export function getToolTraces(messages: { id: string; parts?: unknown[] }[]): ToolTrace[] {
  const traces: ToolTrace[] = [];
  for (const message of messages) {
    for (const [index, part] of ((message.parts ?? []) as ChatPart[]).entries()) {
      if (!part.type.startsWith("tool-")) continue;
      const name = part.type.replace(/^tool-/, "");
      const output = getPartOutput<Record<string, any>>(part);
      traces.push({
        id: part.toolCallId ?? `${message.id}-${index}`,
        name,
        ok: output?.ok !== false,
        summary: summarizeToolOutput(name, output),
      });
    }
  }
  return traces;
}

export function summarizeToolOutput(name: string, output?: Record<string, any>) {
  if (!output) return "running";
  if (name === "suggest_addons") {
    return output.decision === "suggest" && output.suggestion
      ? `${output.suggestion.catalogId} (${output.suggestion.source ?? "signal"})`
      : "silent";
  }
  if (name === "optimize_bill") {
    return output.proposal ? `save ${output.proposal.displaySavings}` : "no proposal";
  }
  if (name === "place_order" && output.code === "item_out_of_stock") return "item out of stock";
  if (name === "interpret_craving") {
    const count = Array.isArray(output.matches) ? output.matches.length : 0;
    return count ? `${count} matches` : "no match";
  }
  if (name === "add_to_cart" && output.added) return `${output.added.quantity}x ${output.added.catalogId}`;
  if (output.message) return String(output.message);
  if (output.order_state?.stage) return String(output.order_state.stage);
  return output.ok === false ? "failed" : "ok";
}

/** Chat-native rendering of the model's text: paragraphs + **bold** only. */
export function renderSay(say: string) {
  return say.split(/\*\*(.+?)\*\*/g).map((chunk, index) =>
    index % 2 === 1 ? <b key={index}>{chunk}</b> : <span key={index}>{chunk}</span>,
  );
}

export function parseContract(text: string): ResponseContract {
  const trimmed = text.trim();

  // Models sometimes speak first, then append the JSON contract in a ```json
  // fence. Show the prose; read the contract for next_action; never show raw JSON.
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/);
  if (fence && typeof fence.index === "number") {
    const prose = trimmed.slice(0, fence.index).trim();
    try {
      const parsed = JSON.parse(fence[1]) as Partial<ResponseContract>;
      if (typeof parsed.say === "string") {
        return {
          say: prose || parsed.say,
          order_state: parsed.order_state,
          next_action: parsed.next_action ?? null,
        };
      }
    } catch {
      // fall through to prose-only
    }
    if (prose) return { say: prose };
  }

  // Unfenced trailing contract: prose followed by a raw {"say": ...} object.
  // Hide everything from the marker even mid-stream (partial JSON never shows).
  const marker = trimmed.search(/\{\s*"say"\s*:/);
  if (marker > 0) {
    const prose = trimmed.slice(0, marker).trim();
    const tail = trimmed.slice(marker);
    try {
      const parsed = JSON.parse(tail.slice(0, tail.lastIndexOf("}") + 1)) as Partial<ResponseContract>;
      if (typeof parsed.say === "string") {
        return {
          say: prose || parsed.say,
          order_state: parsed.order_state,
          next_action: parsed.next_action ?? null,
        };
      }
    } catch {
      // partial or malformed contract — show the prose only
    }
    return { say: prose || "…" };
  }

  if (!trimmed.startsWith("{")) return { say: text };

  try {
    const parsed = JSON.parse(trimmed) as Partial<ResponseContract>;
    if (typeof parsed.say === "string") {
      return {
        say: parsed.say,
        order_state: parsed.order_state,
        next_action: parsed.next_action ?? null,
      };
    }
  } catch {
    return { say: text };
  }

  return { say: text };
}

export function buildTranscript(messages: { id: string; role: string; parts?: unknown[] }[]): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  for (const message of messages) {
    const text = ((message.parts ?? []) as ChatPart[])
      .filter((part) => part.type === "text" && part.text)
      .map((part) => parseContract(part.text as string).say.replace(/\*\*(.+?)\*\*/g, "$1"))
      .join(" ")
      .trim();
    if (text) {
      lines.push({ id: message.id, role: message.role === "user" ? "user" : "assistant", text });
    }
  }
  return lines;
}

/* ---------- icons ---------- */

export function KfcMark() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M21.893 8.23c-4.187.001-5.249 2.365-5.42 3.97-.194 1.802 1.053 3.57 4.127 3.57 1.294 0 2.14-.225 2.44-.32a.215.215 0 00.147-.166l.173-.91a.184.184 0 00-.236-.21c-.336.106-.93.252-1.685.252-1.469 0-2.53-.882-2.395-2.4.13-1.47 1.121-2.59 2.485-2.59.82 0 1.183.43 1.156 1.003v.033a.184.184 0 00.182.193h.557c.086 0 .16-.06.18-.143l.39-1.76a.215.215 0 00-.15-.255 7.21 7.21 0 00-1.95-.266zm-20.157.116a.2.2 0 00-.195.156l-.108.484a.198.198 0 00.13.23l.033.01c.208.082.45.266.348.748l-.792 3.62c-.207.987-.542 1.19-.86 1.226h-.01a.2.2 0 00-.176.157l-.102.464a.192.192 0 00.187.233h3.487c.085 0 .159-.06.177-.142l.12-.543a.184.184 0 00-.112-.21l-.022-.01c-.177-.07-.418-.224-.356-.51l.405-1.85c1.389 2.535 1.848 3.266 3.514 3.265H8.91a.181.181 0 00.177-.142l.105-.47a.195.195 0 00-.186-.238c-.376-.006-.56-.093-.935-.575l-1.932-2.614 2.51-2.088c.337-.264.748-.338.976-.368l.022-.002a.185.185 0 00.163-.144l.103-.464a.184.184 0 00-.18-.223h-3.02a.199.199 0 00-.193.155l-.102.46a.2.2 0 00.138.235c.178.069.217.24.063.366L4.046 11.7l.44-2.014a.683.683 0 01.477-.487l.025-.008a.199.199 0 00.135-.147l.106-.477a.181.181 0 00-.177-.22zm8.88 0a.2.2 0 00-.194.156l-.107.483a.19.19 0 00.122.221l.02.008c.204.077.487.274.364.758l-1.21 5.48a.182.182 0 00.178.222h2.777c.086 0 .16-.06.179-.143l.12-.547a.174.174 0 00-.098-.196 1.558 1.558 0 01-.027-.013c-.176-.086-.438-.285-.35-.67.009-.05.27-1.24.27-1.24h2.362c.086 0 .16-.06.18-.143l.221-1a.183.183 0 00-.18-.224h-2.28l.427-1.94 1.592-.003c.515 0 .672.27.642.728l-.002.024a.184.184 0 00.183.205h.587c.086 0 .16-.06.178-.144l.4-1.8a.184.184 0 00-.18-.222z" />
    </svg>
  );
}

export function VerifiedBadge() {
  return (
    <svg className="oa-verified" width="15" height="15" viewBox="0 0 20 20" fill="currentColor" aria-label="Official Account">
      <path d="M10 1.5l2.09 1.7 2.66-.42 1 2.5 2.5 1-.42 2.66L19.5 10l-1.67 2.06.42 2.66-2.5 1-1 2.5-2.66-.42L10 19.5l-2.09-1.7-2.66.42-1-2.5-2.5-1 .42-2.66L.5 10l1.67-2.06-.42-2.66 2.5-1 1-2.5 2.66.42L10 1.5zm-1.2 11.3l5-5-1.06-1.06-3.94 3.94-1.74-1.74L6 10l2.8 2.8z" />
    </svg>
  );
}

export function MicIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0014 0M12 18v3" />
    </svg>
  );
}

export function SendIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  );
}

/* ---------- in-chat artifact components ---------- */

export function MenuCards({ matches }: { matches: MenuMatch[] }) {
  if (!matches?.length) return null;

  return (
    <div className="menu-card-strip">
      {matches.slice(0, 3).map((match) => (
        <div className="menu-card" key={match.matchId}>
          <p className="menu-card__cat">{match.category}</p>
          <h3>{match.name}</h3>
          <p className="menu-card__desc">{match.description}</p>
          <span className="menu-card__price">{match.displayPrice}</span>
        </div>
      ))}
    </div>
  );
}

export function SuggestionChip({
  traceId,
  suggestion,
  dismissed,
  onAccept,
  onDecline,
}: {
  traceId: string;
  suggestion: AddonSuggestion;
  dismissed: boolean;
  onAccept: (suggestion: AddonSuggestion) => void;
  onDecline: (traceId: string, suggestion: AddonSuggestion) => void;
}) {
  if (dismissed) return null;

  return (
    <div className="addon-chip">
      <span className="addon-chip__label">Gợi ý cho bạn</span>
      <div className="addon-chip__head">
        <b>{suggestion.name}</b>
        <span>{suggestion.displayPrice}</span>
      </div>
      <p>{suggestion.reason}</p>
      <div className="addon-chip__actions">
        <button type="button" onClick={() => onAccept(suggestion)}>
          Thêm vào đơn
        </button>
        <button type="button" onClick={() => onDecline(traceId, suggestion)}>
          Không, cảm ơn
        </button>
      </div>
    </div>
  );
}

export function BillSwapCard({ proposal, onAccept }: { proposal: BillProposal; onAccept: (proposal: BillProposal) => void }) {
  return (
    <div className="bill-swap-card">
      <span className="bill-swap-card__label">Combo Math</span>
      <b>Tiết kiệm {proposal.displaySavings}</b>
      <p>{proposal.summary}</p>
      <button type="button" onClick={() => onAccept(proposal)}>
        Đổi luôn
      </button>
    </div>
  );
}

export function Receipt({ order }: { order?: Order | null }) {
  return (
    <div className="receipt">
      <div className="receipt__head">
        <span>Đơn hàng</span>
        <b>{order ? order.stage.replace("_", " ") : "chưa có"}</b>
      </div>
      {order && order.cart.length ? (
        <div className="receipt__lines">
          {order.cart.map((line) => (
            <div key={line.lineId}>
              <span>
                {line.quantity}× {line.name}
              </span>
              <b>{line.displayTotalPrice}</b>
            </div>
          ))}
        </div>
      ) : (
        <p className="receipt__empty">Giỏ hàng trống, khách chưa gọi món.</p>
      )}
      {order ? (
        <div className="receipt__meta">
          {order.voucher ? <span>Voucher {order.voucher.code} · −{order.totals.displayVoucherDiscount}</span> : null}
          {order.loyalty ? <span>Điểm thưởng · −{order.loyalty.displayDiscount}</span> : null}
          {order.quote ? <span>{order.quote.fulfillment === "delivery" ? "Giao hàng" : "Đến lấy"} · {order.quote.etaMinutes} phút</span> : null}
          {order.otp ? <span className={order.otp.verified ? "is-good" : ""}>OTP {order.otp.verified ? "đã xác thực" : `→ ${order.otp.maskedPhone}`}</span> : null}
          {order.placedOrder ? <span className="is-good">Mã đơn {order.placedOrder.orderNumber}</span> : null}
          {order.handoff ? <span>Chuyển nhân viên · {order.handoff.ticketId}</span> : null}
        </div>
      ) : null}
      <div className="receipt__total">
        <span>Tổng</span>
        <b>{order ? order.totals.displayTotal : "0 VND"}</b>
      </div>
    </div>
  );
}

export function TraceConsole({ traces }: { traces: ToolTrace[] }) {
  return (
    <div className="trace-console">
      <div className="trace-console__head">
        <span>Agent tool calls</span>
        <b>{traces.length}</b>
      </div>
      <div className="trace-console__list">
        {traces.length ? (
          traces.map((trace) => (
            <div className={`trace-row ${trace.ok ? "trace-row--ok" : "trace-row--fail"}`} key={trace.id}>
              <b>{trace.ok ? "✓" : "×"}</b>
              <span>{trace.name}</span>
              <small>{trace.summary}</small>
            </div>
          ))
        ) : (
          <p className="trace-console__empty">Chưa có tool call, gửi tin nhắn để xem agent làm việc.</p>
        )}
      </div>
    </div>
  );
}
