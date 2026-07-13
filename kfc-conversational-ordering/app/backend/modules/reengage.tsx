"use client";

import { useEffect, useMemo, useState } from "react";
import { time, vnd, type LoyaltyMember } from "./shared";
import type { ReengageCustomerDecision, ReengageGate } from "../../../lib/reengage";
import type { ReengageNotification, ReengagePrefs } from "../../../lib/reengage-store";

type TimelineEntry = {
  placedAt: string;
  vnHour: number;
  label: string;
  totalVnd: number;
};

type ReengageFeed = {
  ok: true;
  decision: ReengageCustomerDecision;
  timeline: TimelineEntry[];
  notifications: ReengageNotification[];
  prefs: ReengagePrefs;
};

type SimDay = {
  day: number;
  orderTimeLabel: string;
  predictedTimeLabel: string | null;
  sendTimeLabel: string | null;
  confidence: number;
  sampleCount: number;
  resultantLength: number;
  spreadMinutes: number | null;
  errorMinutes: number | null;
  genericErrorMinutes: number;
};

type SimResult = {
  ok: true;
  trueHourLabel: string;
  noiseMinutes: number;
  seed: number;
  minConfidence: number;
  days: SimDay[];
};

const GATE_LABELS: Record<ReengageGate, string> = {
  ok: "Ready to send",
  opted_out: "Off (stopped)",
  muted: "Auto-muted (2 ignores)",
  insufficient_history: "Not enough history",
  not_overdue: "Not overdue",
  context_mismatch: "Outside appetite window",
  cooldown: "In cooldown",
  low_confidence: "Low confidence",
  quiet_hours: "Outside allowed hours",
};

function channelOf(customerId: string) {
  return customerId.startsWith("msgr_") ? "Messenger" : "Web";
}

function percent(value: number) {
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

function formatDays(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)} days`;
}

function truncate(value: string, length = 120) {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

async function fetchDecision(customerId: string, daysAhead: number, hour: number | null) {
  const params = new URLSearchParams({ customerId });
  if (daysAhead > 0) params.set("daysAhead", String(daysAhead));
  // Without an hour override the API uses the real wall-clock VN hour, which
  // freezes the daypart/quiet-hours gates at "right now" — the override is
  // what lets an operator preview the customer's actual send moment.
  if (hour !== null) params.set("hour", String(hour));
  const res = await fetch(`/api/reengage?${params.toString()}`).catch(() => null);
  if (!res?.ok) return null;
  const json = (await res.json().catch(() => null)) as ReengageFeed | null;
  return json?.ok ? json : null;
}

export function ReengageModule() {
  const [members, setMembers] = useState<LoyaltyMember[] | null>(null);
  const [membersError, setMembersError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [daysAhead, setDaysAhead] = useState(0);
  const [hourOverride, setHourOverride] = useState<number | null>(null);
  const [feed, setFeed] = useState<ReengageFeed | null>(null);
  const [decisionLoading, setDecisionLoading] = useState(false);
  const [decisionError, setDecisionError] = useState(false);
  const [mutating, setMutating] = useState(false);

  const [trueHour, setTrueHour] = useState(11.5);
  const [noiseMinutes, setNoiseMinutes] = useState(25);
  const [simDays, setSimDays] = useState(8);
  const [simResult, setSimResult] = useState<SimResult | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch("/api/loyalty").catch(() => null);
      if (!res?.ok) {
        if (!cancelled) setMembersError(true);
        return;
      }
      const json = (await res.json().catch(() => null)) as { ok: boolean; members: LoyaltyMember[] } | null;
      if (!cancelled && json?.ok) {
        setMembers(json.members);
        setMembersError(false);
      }
    }
    load();
    const timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!selected) {
      setFeed(null);
      return;
    }
    let cancelled = false;
    setDecisionLoading(true);
    setDecisionError(false);
    fetchDecision(selected, daysAhead, hourOverride).then((nextFeed) => {
      if (cancelled) return;
      setFeed(nextFeed);
      setDecisionError(nextFeed === null);
      setDecisionLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [selected, daysAhead, hourOverride]);

  const maxSimError = useMemo(() => {
    if (!simResult?.days.length) return 1;
    return Math.max(1, ...simResult.days.flatMap((day) => [day.errorMinutes ?? 0, day.genericErrorMinutes]));
  }, [simResult]);

  const unlockDay = useMemo(() => {
    if (!simResult) return null;
    return simResult.days.find((day) => day.confidence >= simResult.minConfidence)?.day ?? null;
  }, [simResult]);

  async function refreshDecision() {
    if (!selected) return;
    setDecisionLoading(true);
    setDecisionError(false);
    const nextFeed = await fetchDecision(selected, daysAhead, hourOverride);
    setFeed(nextFeed);
    setDecisionError(nextFeed === null);
    setDecisionLoading(false);
  }

  async function postPrefs(action: "optOut" | "unmute", optedOut?: boolean) {
    if (!selected || mutating) return;
    setMutating(true);
    const body =
      action === "optOut"
        ? { action, customerId: selected, optedOut: Boolean(optedOut) }
        : { action, customerId: selected };
    const res = await fetch("/api/reengage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (res?.ok) await refreshDecision();
    setMutating(false);
  }

  async function runSimulation() {
    setSimLoading(true);
    setSimError(false);
    const res = await fetch("/api/reengage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "simulate", trueHour, noiseMinutes, days: simDays }),
    }).catch(() => null);
    const json = res?.ok ? ((await res.json().catch(() => null)) as SimResult | null) : null;
    setSimResult(json?.ok ? json : null);
    setSimError(!json?.ok);
    setSimLoading(false);
  }

  return (
    <section className="ops">
      <div className="ops__head">
        <p className="rail-title">Nudge v2 · Smart Nudges</p>
        <small className="ops__subnote">Predicted order time, send gate, and notification history by customer</small>
      </div>

      <div className="cust-cols">
        <div className="cust-list">
          {membersError ? (
            <p className="ops__empty">Could not load loyalty list.</p>
          ) : members === null ? (
            <p className="ops__empty">Loading...</p>
          ) : members.length ? (
            members.map((member) => (
              <button
                type="button"
                className={`cust-row ${selected === member.customerId ? "is-active" : ""}`}
                key={member.customerId}
                onClick={() => setSelected(member.customerId)}
              >
                <div className="cust-row__id">
                  <b>{member.customerId}</b>
                  <span className="cust-row__chan">{channelOf(member.customerId)}</span>
                </div>
                <div className="cust-row__pts">
                  <b>{member.points.toLocaleString("en-US")} points</b>
                  <small>lifetime {member.lifetimePoints.toLocaleString("en-US")}</small>
                </div>
              </button>
            ))
          ) : (
            <p className="ops__empty">No loyalty members yet for return-cycle checks.</p>
          )}
        </div>

        <div className="cust-detail">
          {!selected ? (
            <p className="ops__empty">Select a customer to view the Nudge v2 send decision.</p>
          ) : decisionLoading && !feed ? (
            <p className="ops__empty">Calculating decision...</p>
          ) : decisionError || !feed ? (
            <p className="ops__empty">Could not load the re-engagement decision for this customer.</p>
          ) : (
            <div className="reng-detail">
              <div className="reng-clock">
                <label htmlFor="reengage-days-ahead">Demo clock +N days</label>
                <input
                  id="reengage-days-ahead"
                  type="number"
                  min="0"
                  max="14"
                  value={daysAhead}
                  onChange={(event) => setDaysAhead(Math.max(0, Math.min(14, Number(event.target.value) || 0)))}
                />
                <label htmlFor="reengage-hour">Hour (VN)</label>
                <select
                  id="reengage-hour"
                  value={hourOverride === null ? "auto" : String(hourOverride)}
                  onChange={(event) =>
                    setHourOverride(event.target.value === "auto" ? null : Number(event.target.value))
                  }
                >
                  <option value="auto">now</option>
                  {Array.from({ length: 24 }, (_, hour) => (
                    <option key={hour} value={hour}>
                      {String(hour).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
              </div>

              <DecisionCard feed={feed} />
              <Timeline entries={feed.timeline} predictedHour={feed.decision.prediction.predictedHour} />
              <MessagePreview decision={feed.decision} />
              <Notifications notifications={feed.notifications} />

              <div className="reng-card reng-prefs">
                <div>
                  <b>Contact preferences</b>
                  <span>
                    {feed.prefs.optedOut
                      ? "Customer opted out of proactive notifications."
                      : feed.prefs.mutedAt
                        ? `Auto-muted since ${time(feed.prefs.mutedAt)}.`
                        : "Eligible to send when the customer is inside the allowed window."}
                  </span>
                </div>
                <div className="reng-actions">
                  <button
                    type="button"
                    className={`oms-btn ${feed.prefs.optedOut ? "reng-btn--good" : "oms-btn--cancelled"}`}
                    disabled={mutating}
                    onClick={() => postPrefs("optOut", !feed.prefs.optedOut)}
                  >
                    {feed.prefs.optedOut ? "Opt back in" : "Opt out"}
                  </button>
                  {feed.prefs.mutedAt ? (
                    <button
                      type="button"
                      className="oms-btn reng-btn--good"
                      disabled={mutating}
                      onClick={() => postPrefs("unmute")}
                    >
                      Unmute
                    </button>
                  ) : null}
                </div>
              </div>

              <p className="reng-honesty">
                Proactive Messenger sends outside the standard 24h window require an approved message tag or paid message.
                The scanner sends only when the customer is inside the allowed window.
              </p>
            </div>
          )}
        </div>
      </div>

      <section className="reng-sim" aria-labelledby="reengage-sim-title">
        <div className="ops__head">
          <div>
            <p className="rail-title" id="reengage-sim-title">
              Convergence simulation
            </p>
            <small className="ops__subnote">Compare personalized timing error against a fixed 12:00 blast by day</small>
          </div>
          <div className="reng-sim__controls">
            <label>
              True hour
              <input
                type="number"
                min="0"
                max="23.75"
                step="0.25"
                value={trueHour}
                onChange={(event) => setTrueHour(Math.max(0, Math.min(23.75, Number(event.target.value) || 0)))}
              />
            </label>
            <label>
              Noise minutes
              <input
                type="number"
                min="0"
                max="180"
                value={noiseMinutes}
                onChange={(event) => setNoiseMinutes(Math.max(0, Number(event.target.value) || 0))}
              />
            </label>
            <label>
              Days
              <input
                type="number"
                min="2"
                max="30"
                value={simDays}
                onChange={(event) => setSimDays(Math.max(2, Math.min(30, Number(event.target.value) || 2)))}
              />
            </label>
            <button type="button" className="promo-submit" disabled={simLoading} onClick={runSimulation}>
              {simLoading ? "Running..." : "Run simulation"}
            </button>
          </div>
        </div>

        {simError ? <p className="ops__empty">Could not run convergence simulation.</p> : null}
        {simResult ? (
          <>
            <div className="reng-sim__legend">
              <span>
                <i className="reng-bar--personal" /> Personalized error (minutes)
              </span>
              <span>
                <i className="reng-bar--generic" /> 12:00 blast error (minutes)
              </span>
            </div>
            <div className="reng-sim__chart">
              {simResult.days.map((day) => {
                // sqrt scale — the generic-blast error can be 50× the personal
                // one; on a linear scale the red bars vanish into dots.
                const scale = (minutes: number) => Math.max(4, Math.sqrt(minutes / maxSimError) * 100);
                const unlocked = unlockDay === day.day;
                return (
                  <div className="reng-sim__day" key={day.day}>
                    <div
                      className="reng-sim__bars"
                      title={`Day ${day.day} · ordered at ${day.orderTimeLabel} · personalized error ${day.errorMinutes ?? "—"} min, blast error ${day.genericErrorMinutes} min`}
                    >
                      {unlocked ? <span className="reng-unlock">send unlocked</span> : null}
                      <span className="reng-bar reng-bar--personal" style={{ height: `${scale(day.errorMinutes ?? 0)}%` }}>
                        <em>{day.errorMinutes ?? "—"}</em>
                      </span>
                      <span className="reng-bar reng-bar--generic" style={{ height: `${scale(day.genericErrorMinutes)}%` }} />
                    </div>
                    <b>Day {day.day}</b>
                    <small>{percent(day.confidence)}%</small>
                  </div>
                );
              })}
            </div>
            <p className="reng-sim__verdict">
              After {simResult.days.length} days: personalized send error is{" "}
              <b>{simResult.days[simResult.days.length - 1].errorMinutes ?? "—"} min</b> from the customer's real order time;
              fixed 12:00 blast is off by <b>{simResult.days[simResult.days.length - 1].genericErrorMinutes} min</b>.
            </p>
          </>
        ) : (
          <p className="ops__empty">Run the simulation to see personalized error shrink as history accumulates.</p>
        )}
      </section>
    </section>
  );
}

function DecisionCard({ feed }: { feed: ReengageFeed }) {
  const { decision } = feed;
  const confidencePct = percent(decision.confidence);
  return (
    <div className="reng-card">
      <div className="reng-decision__head">
        <div>
          <small>Predicted order</small>
          <b>{decision.predictedOrderTime ?? "—"}</b>
        </div>
        <div>
          <small>Recommended send</small>
          <b>{decision.recommendedSendTime ?? "—"}</b>
        </div>
        <span className={`reng-gate ${decision.shouldSend ? "reng-gate--ok" : ""}`}>{GATE_LABELS[decision.gate]}</span>
      </div>

      <div className="reng-confidence">
        <div className="reng-confidence__track">
          <span className="reng-confidence__fill" style={{ width: `${confidencePct}%` }} />
          <span className="reng-confidence__threshold" style={{ left: "60%" }} />
        </div>
        <small>{confidencePct}% confidence · 60% send threshold</small>
      </div>

      <div className="reng-math">
        <span>
          <small>Median gap</small>
          <b>{formatDays(decision.nudge.medianGapDays)}</b>
        </span>
        <span>
          <small>Elapsed</small>
          <b>{decision.nudge.elapsedDays.toFixed(1)} days</b>
        </span>
        <span>
          <small>Overdue threshold</small>
          <b>{formatDays(decision.nudge.overdueThresholdDays)}</b>
        </span>
      </div>

      <p className="reng-explanation">{decision.explanation}</p>
    </div>
  );
}

function Timeline({ entries, predictedHour }: { entries: TimelineEntry[]; predictedHour: number | null }) {
  return (
    <div className="reng-card">
      <div className="reng-card__head">
        <b>Order-time timeline</b>
        <span>0h → 24h</span>
      </div>
      <div className="reng-timeline">
        <span className="reng-axis reng-axis--start">0</span>
        <span className="reng-axis reng-axis--mid">12</span>
        <span className="reng-axis reng-axis--end">24</span>
        {predictedHour !== null ? (
          <span className="reng-timeline__marker" style={{ left: `${(predictedHour / 24) * 100}%` }} />
        ) : null}
        {entries.map((entry) => (
          <span
            className="reng-timeline__dot"
            key={`${entry.placedAt}-${entry.vnHour}`}
            style={{ left: `${(entry.vnHour / 24) * 100}%` }}
            title={`${entry.label} · ${vnd(entry.totalVnd)}`}
          />
        ))}
      </div>
      {entries.length ? null : <p className="ops__empty">No order history yet for the timeline.</p>}
    </div>
  );
}

function MessagePreview({ decision }: { decision: ReengageCustomerDecision }) {
  if (!decision.shouldSend || !decision.message) return null;
  return (
    <div className="reng-card reng-message">
      <b>Message preview</b>
      <p>{decision.message}</p>
      <div className="reng-chips">
        {decision.recommendedItems.map((item) => (
          <span key={item}>{item}</span>
        ))}
        {decision.voucherCode ? <span>{decision.voucherCode}</span> : null}
      </div>
    </div>
  );
}

function Notifications({ notifications }: { notifications: ReengageNotification[] }) {
  return (
    <div className="reng-card">
      <div className="reng-card__head">
        <b>Notification history</b>
        <span>{notifications.length} times</span>
      </div>
      {notifications.length ? (
        <div className="reng-notifs">
          {notifications.map((notification) => (
            <div className="reng-notif" key={`${notification.sentAt}-${notification.channel}`}>
              <div>
                <b>{time(notification.sentAt)}</b>
                <span>
                  {notification.channel}
                  {notification.predictedFor ? ` · predicted ${notification.predictedFor}` : ""} ·{" "}
                  {percent(notification.confidence)}%
                </span>
              </div>
              <p>{truncate(notification.message)}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="ops__empty">No re-engagement notifications sent yet.</p>
      )}
    </div>
  );
}
