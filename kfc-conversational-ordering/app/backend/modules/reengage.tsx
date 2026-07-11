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
  ok: "Sẵn sàng gửi",
  opted_out: "Đã tắt (dừng)",
  muted: "Tự tắt (bỏ qua 2 lần)",
  insufficient_history: "Chưa đủ lịch sử",
  not_overdue: "Chưa quá nhịp",
  context_mismatch: "Ngoài khung thèm ăn",
  cooldown: "Đang cooldown",
  low_confidence: "Độ tin cậy thấp",
  quiet_hours: "Ngoài giờ cho phép",
};

function channelOf(customerId: string) {
  return customerId.startsWith("msgr_") ? "Messenger" : "Web";
}

function percent(value: number) {
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

function formatDays(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)} ngày`;
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
        <p className="rail-title">Nudge v2 · Tái kích hoạt</p>
        <small className="ops__subnote">Dự đoán giờ đặt món, cổng gửi và lịch sử thông báo theo từng khách</small>
      </div>

      <div className="cust-cols">
        <div className="cust-list">
          {membersError ? (
            <p className="ops__empty">Không tải được danh sách loyalty.</p>
          ) : members === null ? (
            <p className="ops__empty">Đang tải…</p>
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
                  <b>{member.points.toLocaleString("vi-VN")} điểm</b>
                  <small>tích lũy {member.lifetimePoints.toLocaleString("vi-VN")}</small>
                </div>
              </button>
            ))
          ) : (
            <p className="ops__empty">Chưa có thành viên loyalty để kiểm tra nhịp quay lại.</p>
          )}
        </div>

        <div className="cust-detail">
          {!selected ? (
            <p className="ops__empty">Chọn một khách để xem quyết định gửi Nudge v2.</p>
          ) : decisionLoading && !feed ? (
            <p className="ops__empty">Đang tính quyết định…</p>
          ) : decisionError || !feed ? (
            <p className="ops__empty">Chưa tải được quyết định tái kích hoạt cho khách này.</p>
          ) : (
            <div className="reng-detail">
              <div className="reng-clock">
                <label htmlFor="reengage-days-ahead">Demo clock +N ngày</label>
                <input
                  id="reengage-days-ahead"
                  type="number"
                  min="0"
                  max="14"
                  value={daysAhead}
                  onChange={(event) => setDaysAhead(Math.max(0, Math.min(14, Number(event.target.value) || 0)))}
                />
                <label htmlFor="reengage-hour">Giờ (VN)</label>
                <select
                  id="reengage-hour"
                  value={hourOverride === null ? "auto" : String(hourOverride)}
                  onChange={(event) =>
                    setHourOverride(event.target.value === "auto" ? null : Number(event.target.value))
                  }
                >
                  <option value="auto">bây giờ</option>
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
                  <b>Tùy chọn liên hệ</b>
                  <span>
                    {feed.prefs.optedOut
                      ? "Khách đã tắt thông báo chủ động."
                      : feed.prefs.mutedAt
                        ? `Đang tự tắt từ ${time(feed.prefs.mutedAt)}.`
                        : "Được phép xét gửi khi còn trong cửa sổ hợp lệ."}
                  </span>
                </div>
                <div className="reng-actions">
                  <button
                    type="button"
                    className={`oms-btn ${feed.prefs.optedOut ? "reng-btn--good" : "oms-btn--cancelled"}`}
                    disabled={mutating}
                    onClick={() => postPrefs("optOut", !feed.prefs.optedOut)}
                  >
                    {feed.prefs.optedOut ? "Bật nhận lại" : "Tắt thông báo"}
                  </button>
                  {feed.prefs.mutedAt ? (
                    <button
                      type="button"
                      className="oms-btn reng-btn--good"
                      disabled={mutating}
                      onClick={() => postPrefs("unmute")}
                    >
                      Bỏ tự tắt
                    </button>
                  ) : null}
                </div>
              </div>

              <p className="reng-honesty">
                Gửi Messenger chủ động ngoài cửa sổ 24h tiêu chuẩn cần message tag đã được duyệt hoặc trả phí; scanner
                chỉ gửi khi còn trong cửa sổ hợp lệ.
              </p>
            </div>
          )}
        </div>
      </div>

      <section className="reng-sim" aria-labelledby="reengage-sim-title">
        <div className="ops__head">
          <div>
            <p className="rail-title" id="reengage-sim-title">
              Mô phỏng hội tụ
            </p>
            <small className="ops__subnote">So sai số cá nhân hóa với blast cố định 12:00 theo từng ngày</small>
          </div>
          <div className="reng-sim__controls">
            <label>
              Giờ thật
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
              Nhiễu phút
              <input
                type="number"
                min="0"
                max="180"
                value={noiseMinutes}
                onChange={(event) => setNoiseMinutes(Math.max(0, Number(event.target.value) || 0))}
              />
            </label>
            <label>
              Số ngày
              <input
                type="number"
                min="2"
                max="30"
                value={simDays}
                onChange={(event) => setSimDays(Math.max(2, Math.min(30, Number(event.target.value) || 2)))}
              />
            </label>
            <button type="button" className="promo-submit" disabled={simLoading} onClick={runSimulation}>
              {simLoading ? "Đang chạy…" : "Chạy mô phỏng"}
            </button>
          </div>
        </div>

        {simError ? <p className="ops__empty">Không chạy được mô phỏng hội tụ.</p> : null}
        {simResult ? (
          <div className="reng-sim__chart">
            {simResult.days.map((day) => {
              const personalHeight = `${Math.max(3, ((day.errorMinutes ?? 0) / maxSimError) * 100)}%`;
              const genericHeight = `${Math.max(3, (day.genericErrorMinutes / maxSimError) * 100)}%`;
              const unlocked = unlockDay === day.day;
              return (
                <div className="reng-sim__day" key={day.day}>
                  <div className="reng-sim__bars" title={`Ngày ${day.day} · ${day.orderTimeLabel}`}>
                    {unlocked ? <span className="reng-unlock">mở khóa gửi</span> : null}
                    <span className="reng-bar reng-bar--personal" style={{ height: personalHeight }} />
                    <span className="reng-bar reng-bar--generic" style={{ height: genericHeight }} />
                  </div>
                  <b>Ngày {day.day}</b>
                  <small>{percent(day.confidence)}%</small>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="ops__empty">Chạy mô phỏng để xem sai số cá nhân hóa thu hẹp khi đủ lịch sử.</p>
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
          <small>Dự đoán đặt món</small>
          <b>{decision.predictedOrderTime ?? "—"}</b>
        </div>
        <div>
          <small>Gửi đề xuất</small>
          <b>{decision.recommendedSendTime ?? "—"}</b>
        </div>
        <span className={`reng-gate ${decision.shouldSend ? "reng-gate--ok" : ""}`}>{GATE_LABELS[decision.gate]}</span>
      </div>

      <div className="reng-confidence">
        <div className="reng-confidence__track">
          <span className="reng-confidence__fill" style={{ width: `${confidencePct}%` }} />
          <span className="reng-confidence__threshold" style={{ left: "60%" }} />
        </div>
        <small>{confidencePct}% tin cậy · ngưỡng gửi 60%</small>
      </div>

      <div className="reng-math">
        <span>
          <small>Median gap</small>
          <b>{formatDays(decision.nudge.medianGapDays)}</b>
        </span>
        <span>
          <small>Đã trôi qua</small>
          <b>{decision.nudge.elapsedDays.toFixed(1)} ngày</b>
        </span>
        <span>
          <small>Ngưỡng quá nhịp</small>
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
        <b>Timeline giờ đặt</b>
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
      {entries.length ? null : <p className="ops__empty">Chưa có lịch sử đặt món để vẽ timeline.</p>}
    </div>
  );
}

function MessagePreview({ decision }: { decision: ReengageCustomerDecision }) {
  if (!decision.shouldSend || !decision.message) return null;
  return (
    <div className="reng-card reng-message">
      <b>Preview tin nhắn</b>
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
        <b>Lịch sử thông báo</b>
        <span>{notifications.length} lần</span>
      </div>
      {notifications.length ? (
        <div className="reng-notifs">
          {notifications.map((notification) => (
            <div className="reng-notif" key={`${notification.sentAt}-${notification.channel}`}>
              <div>
                <b>{time(notification.sentAt)}</b>
                <span>
                  {notification.channel}
                  {notification.predictedFor ? ` · dự đoán ${notification.predictedFor}` : ""} ·{" "}
                  {percent(notification.confidence)}%
                </span>
              </div>
              <p>{truncate(notification.message)}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="ops__empty">Chưa gửi thông báo tái kích hoạt nào.</p>
      )}
    </div>
  );
}
