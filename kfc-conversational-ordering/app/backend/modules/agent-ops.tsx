"use client";

// Agent module — the ops board. Polls /api/console every 4s: cross-channel KPIs
// (orders, AOV, take-rate, AI cost, latency, turns) plus a per-turn transaction
// feed with tool calls. Synthetic traffic is flagged and excluded from KPIs.
// Extracted verbatim from the original single-page console.

import { useEffect, useState } from "react";
import { vnd, time, secs, ChannelBadge, type ConsoleFeed } from "./shared";

type AnswerCacheStats = {
  ok: boolean;
  lookups: number;
  hits: number;
  entries: number;
  hitRate: number;
  topQuestions: Array<{ key: string; hits: number }>;
};

// Learned global answer cache panel — one customer's answered question serving
// the next. Polls its own lightweight endpoint; renders cleanly with zero data.
function AnswerCacheCard() {
  const [stats, setStats] = useState<AnswerCacheStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const response = await fetch("/api/answer-cache").catch(() => null);
      if (!response?.ok) return;
      const json = (await response.json().catch(() => null)) as AnswerCacheStats | null;
      if (!cancelled && json) setStats(json);
    }
    load();
    const timer = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const entries = stats?.entries ?? 0;
  const hits = stats?.hits ?? 0;
  const hitRate = stats?.hitRate ?? 0;

  return (
    <div className="ac-card">
      <p className="ops__subtitle">
        Bộ nhớ trả lời chung <em>(câu khách A đã hỏi phục vụ khách B tức thì)</em>
      </p>
      <div className="kpis">
        <div className="kpi">
          <small>Câu đã học</small>
          <b>{entries}</b>
          <span>{stats?.lookups ?? 0} lượt tra</span>
        </div>
        <div className="kpi">
          <small>Lượt trúng</small>
          <b>{hits}</b>
          <span>0 token · ~1ms</span>
        </div>
        <div className="kpi">
          <small>Tỉ lệ trúng</small>
          <b>{Math.round(hitRate * 100)}%</b>
          <span>trên các câu hỏi chung</span>
        </div>
      </div>
      {stats?.topQuestions.length ? (
        <ol className="ac-top">
          {stats.topQuestions.map((q) => (
            <li key={q.key}>
              <span className="ac-top__q">{q.key}</span>
              <b className="ac-top__hits">{q.hits}×</b>
            </li>
          ))}
        </ol>
      ) : (
        <p className="ops__empty">Chưa học câu trả lời nào, sẽ đầy dần khi khách hỏi.</p>
      )}
    </div>
  );
}

export function AgentOpsModule() {
  const [feed, setFeed] = useState<ConsoleFeed | null>(null);
  const [showTests, setShowTests] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const response = await fetch("/api/console").catch(() => null);
      if (!response?.ok) return;
      const json = (await response.json().catch(() => null)) as ConsoleFeed | null;
      if (!cancelled && json?.ok) setFeed(json);
    }
    load();
    const timer = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!feed) {
    return (
      <section className="ops">
        <p className="rail-title">Giao dịch &amp; phân tích, mọi kênh</p>
        <p className="ops__empty">Đang tải dữ liệu từ Supabase…</p>
      </section>
    );
  }

  const { kpis } = feed;
  const visibleTurns = showTests ? feed.turns : feed.turns.filter((turn) => !turn.synthetic);

  return (
    <section className="ops">
      <div className="ops__head">
        <p className="rail-title">Giao dịch &amp; phân tích, mọi kênh (Supabase, live)</p>
        <label className="ops__toggle">
          <input type="checkbox" checked={showTests} onChange={(event) => setShowTests(event.target.checked)} />
          hiện traffic test
        </label>
      </div>

      <div className="kpis">
        <div className="kpi">
          <small>Đơn đã đặt</small>
          <b>{kpis.orders}</b>
          <span>{kpis.distinctCustomers} khách thật</span>
        </div>
        <div className="kpi">
          <small>Giá trị đơn TB</small>
          <b>{kpis.aovVnd === null ? "—" : vnd(kpis.aovVnd)}</b>
          <span>trên {kpis.orders} đơn</span>
        </div>
        <div className="kpi">
          <small>Gợi ý được nhận</small>
          <b>{kpis.suggestions.takeRate === null ? "—" : `${Math.round(kpis.suggestions.takeRate * 100)}%`}</b>
          <span>
            {kpis.suggestions.accepted}/{kpis.suggestions.accepted + kpis.suggestions.declined} gợi ý
          </span>
        </div>
        <div className="kpi">
          <small>Chi phí AI (ước tính)</small>
          <b>{kpis.aiCost.vnd === null ? "—" : vnd(kpis.aiCost.vnd)}</b>
          <span>{kpis.aiCost.usd === null ? "" : `$${kpis.aiCost.usd.toFixed(2)} · ${kpis.aiCost.coveredTurns} lượt`}</span>
        </div>
        <div className="kpi">
          <small>Độ trễ p50 / p95</small>
          <b>
            {secs(kpis.latency.p50Ms)} <em>/ {secs(kpis.latency.p95Ms)}</em>
          </b>
          <span>trọn lượt (mọi tool call)</span>
        </div>
        <div className="kpi">
          <small>Lượt hội thoại</small>
          <b>{kpis.turns}</b>
          <span>
            web {kpis.channels.web ?? 0} · messenger {kpis.channels.messenger ?? 0}
          </span>
        </div>
      </div>

      <div className="ops__cols">
        <div className="ops__orders">
          <p className="ops__subtitle">Đơn gần nhất</p>
          {feed.orders.length ? (
            feed.orders.map((order) => (
              <div className="order-row" key={order.orderId + order.at}>
                <span className="order-row__time">{time(order.at)}</span>
                <ChannelBadge channel={order.channel} />
                <span className="order-row__customer">{order.customerId}</span>
                <span className="order-row__items">{order.itemCount} món</span>
                <b className="order-row__total">{vnd(order.totalVnd)}</b>
              </div>
            ))
          ) : (
            <p className="ops__empty">Chưa có đơn nào.</p>
          )}
        </div>

        <div className="ops__txs">
          <p className="ops__subtitle">
            Lượt hội thoại gần nhất <em>(tool calls · token · độ trễ · chi phí)</em>
          </p>
          <div className="tx-list">
            {visibleTurns.map((turn, index) => (
              <div className={`tx ${turn.placedOrder ? "tx--placed" : ""}`} key={`${turn.at}${turn.customerId}${index}`}>
                <div className="tx__meta">
                  <span className="tx__time">{time(turn.at)}</span>
                  <ChannelBadge channel={turn.channel} synthetic={turn.synthetic} />
                  <span className="tx__customer">{turn.customerId}</span>
                  {turn.placedOrder ? <span className="tx__placed">ĐẶT ĐƠN</span> : null}
                  <span className="tx__stats">
                    {secs(turn.latencyMs)}
                    {turn.costVnd !== null ? ` · ~${vnd(turn.costVnd)}` : ""}
                    {` · in ${turn.tokens.input.toLocaleString()} / cache ${turn.tokens.reads.toLocaleString()} / out ${turn.tokens.output.toLocaleString()}`}
                  </span>
                </div>
                <div className="tx__body">
                  <p className="tx__user">{turn.userText}</p>
                  <p className="tx__reply">{turn.replyText}</p>
                </div>
                {turn.tools.length ? (
                  <div className="tx__tools">
                    {turn.tools.map((tool, index) => (
                      <code key={`${tool}${index}`}>{tool}</code>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            {!visibleTurns.length ? <p className="ops__empty">Chưa có lượt hội thoại nào.</p> : null}
          </div>
        </div>
      </div>

      <AnswerCacheCard />

      <p className="console-note" style={{ marginTop: 10 }}>
        KPI chỉ tính khách thật (loại eval/probe/test). Chi phí ước tính từ token đã lưu, số chính thức là AI Gateway
        dashboard.
      </p>
    </section>
  );
}
