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
        Shared answer memory <em>(questions from customer A answer customer B instantly)</em>
      </p>
      <div className="kpis">
        <div className="kpi">
          <small>Learned answers</small>
          <b>{entries}</b>
          <span>{stats?.lookups ?? 0} lookup turns</span>
        </div>
        <div className="kpi">
          <small>Hits</small>
          <b>{hits}</b>
          <span>0 token · ~1ms</span>
        </div>
        <div className="kpi">
          <small>Hit rate</small>
          <b>{Math.round(hitRate * 100)}%</b>
          <span>on common questions</span>
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
        <p className="ops__empty">No learned answers yet. This fills as customers ask.</p>
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
        <p className="rail-title">Transactions &amp; analytics, all channels</p>
        <p className="ops__empty">Loading data from Supabase...</p>
      </section>
    );
  }

  const { kpis } = feed;
  const visibleTurns = showTests ? feed.turns : feed.turns.filter((turn) => !turn.synthetic);

  return (
    <section className="ops">
      <div className="ops__head">
        <p className="rail-title">Transactions &amp; analytics, all channels (Supabase, live)</p>
        <label className="ops__toggle">
          <input type="checkbox" checked={showTests} onChange={(event) => setShowTests(event.target.checked)} />
          show test traffic
        </label>
      </div>

      <div className="kpis">
        <div className="kpi">
          <small>Order placed</small>
          <b>{kpis.orders}</b>
          <span>{kpis.distinctCustomers} real customers</span>
        </div>
        <div className="kpi">
          <small>Average order value</small>
          <b>{kpis.aovVnd === null ? "—" : vnd(kpis.aovVnd)}</b>
          <span>across {kpis.orders} orders</span>
        </div>
        <div className="kpi">
          <small>Accepted suggestions</small>
          <b>{kpis.suggestions.takeRate === null ? "—" : `${Math.round(kpis.suggestions.takeRate * 100)}%`}</b>
          <span>
            {kpis.suggestions.accepted}/{kpis.suggestions.accepted + kpis.suggestions.declined} suggestions
          </span>
        </div>
        <div className="kpi">
          <small>AI cost (est.)</small>
          <b>{kpis.aiCost.vnd === null ? "—" : vnd(kpis.aiCost.vnd)}</b>
          <span>{kpis.aiCost.usd === null ? "" : `$${kpis.aiCost.usd.toFixed(2)} · ${kpis.aiCost.coveredTurns} turns`}</span>
        </div>
        <div className="kpi">
          <small>p50 / p95 latency</small>
          <b>
            {secs(kpis.latency.p50Ms)} <em>/ {secs(kpis.latency.p95Ms)}</em>
          </b>
          <span>full turn, all tool calls</span>
        </div>
        <div className="kpi">
          <small>Conversation turns</small>
          <b>{kpis.turns}</b>
          <span>
            web {kpis.channels.web ?? 0} · messenger {kpis.channels.messenger ?? 0}
          </span>
        </div>
      </div>

      <div className="ops__cols">
        <div className="ops__orders">
          <p className="ops__subtitle">Recent orders</p>
          {feed.orders.length ? (
            feed.orders.map((order) => (
              <div className="order-row" key={order.orderId + order.at}>
                <span className="order-row__time">{time(order.at)}</span>
                <ChannelBadge channel={order.channel} />
                <span className="order-row__customer">{order.customerId}</span>
                <span className="order-row__items">{order.itemCount} items</span>
                <b className="order-row__total">{vnd(order.totalVnd)}</b>
              </div>
            ))
          ) : (
            <p className="ops__empty">No orders yet.</p>
          )}
        </div>

        <div className="ops__txs">
          <p className="ops__subtitle">
            Recent conversation turns <em>(tool calls · tokens · latency · cost)</em>
          </p>
          <div className="tx-list">
            {visibleTurns.map((turn, index) => (
              <div className={`tx ${turn.placedOrder ? "tx--placed" : ""}`} key={`${turn.at}${turn.customerId}${index}`}>
                <div className="tx__meta">
                  <span className="tx__time">{time(turn.at)}</span>
                  <ChannelBadge channel={turn.channel} synthetic={turn.synthetic} />
                  <span className="tx__customer">{turn.customerId}</span>
                  {turn.placedOrder ? <span className="tx__placed">ORDER PLACED</span> : null}
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
            {!visibleTurns.length ? <p className="ops__empty">No conversation turns yet.</p> : null}
          </div>
        </div>
      </div>

      <AnswerCacheCard />

      <p className="console-note" style={{ marginTop: 10 }}>
        KPIs count real customers only, excluding eval/probe/test traffic. Cost is estimated from saved tokens; the
        official number is in the AI Gateway dashboard.
      </p>
    </section>
  );
}
