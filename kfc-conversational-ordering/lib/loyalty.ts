// Real loyalty, replacing the hardcoded vip/non-vip constants in oms.ts.
//
// The loyalty account IS the messaging identity: customer_id is `msgr_<psid>`
// on Messenger or the web persona id — the customer never "signs up", their
// texting account is the binding. Earning: 1 point per 1,000 VND of a placed
// order (1 point = 1 VND at redemption, floored to 1,000s, capped per order).
// Points are debited only when an order with a redemption is actually PLACED —
// checking a redeem option never burns points.

import { createClient } from "@supabase/supabase-js";

/** Max points redeemable on a single order (12,000 VND). */
export const MAX_REDEEM_PER_ORDER = 12000;
/** 1 point per this many VND of order total. */
export const EARN_RATE_VND_PER_POINT = 1000;

export type LoyaltyAccount = {
  customerId: string;
  points: number;
  lifetimePoints: number;
  updatedAt: string;
};

export interface LoyaltyStore {
  getAccount(customerId: string): Promise<LoyaltyAccount>;
  /** Earn points from a placed order total. Returns points earned. */
  earn(customerId: string, orderTotalVnd: number, orderId: string): Promise<number>;
  /** Debit redeemed points (clamped to balance). Returns points actually debited. */
  redeem(customerId: string, points: number, orderId: string): Promise<number>;
  listMembers(limit?: number): Promise<LoyaltyAccount[]>;
}

export function pointsEarnedFor(orderTotalVnd: number) {
  return Math.max(0, Math.floor(orderTotalVnd / EARN_RATE_VND_PER_POINT));
}

function emptyAccount(customerId: string): LoyaltyAccount {
  return { customerId, points: 0, lifetimePoints: 0, updatedAt: new Date().toISOString() };
}

// Demo/eval starting balances so keyless runs (no Supabase) exercise redemption.
// The Supabase path seeds the same ids via a one-time insert (see workplan 2.2).
export const DEMO_SEED_BALANCES: Record<string, number> = {
  "demo-vip": 42600,
  linh: 15400,
  linh_mom: 8200,
};

class InMemoryLoyaltyStore implements LoyaltyStore {
  private accounts = new Map<string, LoyaltyAccount>();

  constructor() {
    for (const [customerId, points] of Object.entries(DEMO_SEED_BALANCES)) {
      this.accounts.set(customerId, {
        customerId,
        points,
        lifetimePoints: points,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  async getAccount(customerId: string) {
    return this.accounts.get(customerId) ?? emptyAccount(customerId);
  }

  async earn(customerId: string, orderTotalVnd: number, _orderId: string) {
    const earned = pointsEarnedFor(orderTotalVnd);
    const account = await this.getAccount(customerId);
    this.accounts.set(customerId, {
      ...account,
      points: account.points + earned,
      lifetimePoints: account.lifetimePoints + earned,
      updatedAt: new Date().toISOString(),
    });
    return earned;
  }

  async redeem(customerId: string, points: number, _orderId: string) {
    const account = await this.getAccount(customerId);
    const debited = Math.min(account.points, Math.max(0, points));
    this.accounts.set(customerId, {
      ...account,
      points: account.points - debited,
      updatedAt: new Date().toISOString(),
    });
    return debited;
  }

  async listMembers(limit = 50) {
    return [...this.accounts.values()]
      .sort((a, b) => b.lifetimePoints - a.lifetimePoints)
      .slice(0, limit);
  }

  reset() {
    this.accounts.clear();
    for (const [customerId, points] of Object.entries(DEMO_SEED_BALANCES)) {
      this.accounts.set(customerId, {
        customerId,
        points,
        lifetimePoints: points,
        updatedAt: new Date().toISOString(),
      });
    }
  }
}

class SupabaseLoyaltyStore implements LoyaltyStore {
  private client = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    { auth: { persistSession: false } },
  );

  private fromRow(row: Record<string, unknown>): LoyaltyAccount {
    return {
      customerId: row.customer_id as string,
      points: (row.points as number) ?? 0,
      lifetimePoints: (row.lifetime_points as number) ?? 0,
      updatedAt: (row.updated_at as string) ?? new Date().toISOString(),
    };
  }

  async getAccount(customerId: string) {
    const { data } = await this.client.from("kfc_loyalty").select("*").eq("customer_id", customerId).maybeSingle();
    return data ? this.fromRow(data) : emptyAccount(customerId);
  }

  private async apply(customerId: string, delta: number, reason: "earn" | "redeem", orderId: string) {
    const account = await this.getAccount(customerId);
    const points = Math.max(0, account.points + delta);
    const lifetimePoints = account.lifetimePoints + Math.max(0, delta);
    const { error } = await this.client.from("kfc_loyalty").upsert({
      customer_id: customerId,
      points,
      lifetime_points: lifetimePoints,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    await this.client.from("kfc_loyalty_events").insert({
      customer_id: customerId,
      delta,
      reason,
      order_id: orderId,
    });
  }

  async earn(customerId: string, orderTotalVnd: number, orderId: string) {
    const earned = pointsEarnedFor(orderTotalVnd);
    if (earned > 0) await this.apply(customerId, earned, "earn", orderId);
    return earned;
  }

  async redeem(customerId: string, points: number, orderId: string) {
    const account = await this.getAccount(customerId);
    const debited = Math.min(account.points, Math.max(0, points));
    if (debited > 0) await this.apply(customerId, -debited, "redeem", orderId);
    return debited;
  }

  async listMembers(limit = 50) {
    const { data, error } = await this.client
      .from("kfc_loyalty")
      .select("*")
      .order("lifetime_points", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((row) => this.fromRow(row));
  }
}

const inMemoryLoyaltyStore = new InMemoryLoyaltyStore();

function hasSupabaseEnv() {
  return Boolean(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function getLoyaltyStore(): LoyaltyStore {
  return hasSupabaseEnv() ? new SupabaseLoyaltyStore() : inMemoryLoyaltyStore;
}

export function resetInMemoryLoyalty() {
  inMemoryLoyaltyStore.reset();
}
