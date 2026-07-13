"use client";

// Customers module — loyalty members. The account IS the messaging identity
// (msgr_<psid> or web persona), so there is no signup: every customer who has
// ordered has a balance. Row click loads that customer's taste profile.

import { useEffect, useState } from "react";
import { vnd, time, type LoyaltyMember, type ProfileFeed } from "./shared";

function channelOf(customerId: string) {
  return customerId.startsWith("msgr_") ? "Messenger" : "Web";
}

export function CustomersModule() {
  const [members, setMembers] = useState<LoyaltyMember[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileFeed | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch("/api/loyalty").catch(() => null);
      if (!res?.ok) return;
      const json = (await res.json().catch(() => null)) as { ok: boolean; members: LoyaltyMember[] } | null;
      if (!cancelled && json?.ok) setMembers(json.members);
    }
    load();
    const timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    async function load() {
      const res = await fetch(`/api/profile?customerId=${encodeURIComponent(selected!)}`).catch(() => null);
      if (!res?.ok) return;
      const json = (await res.json().catch(() => null)) as ProfileFeed | null;
      if (!cancelled && json?.ok) setProfile(json);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  return (
    <section className="ops">
      <div className="ops__head">
        <p className="rail-title">Customers &amp; Loyalty</p>
        <small className="ops__subnote">Account = messaging identity (Messenger PSID / persona)</small>
      </div>
      <div className="cust-cols">
        <div className="cust-list">
          {members === null ? (
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
            <p className="ops__empty">No loyalty members yet. Place an order to earn points.</p>
          )}
        </div>
        <div className="cust-detail">
          {!selected ? (
            <p className="ops__empty">Select a customer to view their taste profile.</p>
          ) : profile?.ok ? (
            <div className="profile-card">
              <div className="profile-card__row profile-card__usual">
                <span>Usual item</span>
                <b>
                  {profile.profile.usual
                    ? `${profile.profile.usual.name} · ${Math.round(profile.profile.usual.share * 100)}%`
                    : "not enough data"}
                </b>
              </div>
              <div className="profile-card__row">
                <span>Taste · Orders · Avg ticket</span>
                <b>
                  {profile.profile.spice === "spicy"
                    ? "spicy"
                    : profile.profile.spice === "original"
                      ? "original"
                      : "—"}
                  {" · "}
                  {profile.profile.orderCount} orders · {vnd(profile.profile.avgTicketVnd)}
                </b>
              </div>
              {profile.profile.attachRates.length > 0 ? (
                <div className="profile-bars">
                  {profile.profile.attachRates.map((attach) => (
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
              <div className="profile-card__row profile-card__take">
                <span>Accepted suggestions</span>
                <b>
                  {profile.suggestions.accepted}/{profile.suggestions.accepted + profile.suggestions.declined}
                </b>
              </div>
            </div>
          ) : (
            <p className="ops__empty">No profile for this customer yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}
