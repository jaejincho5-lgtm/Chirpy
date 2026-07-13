// Saved delivery contact per customer — the spine of zero-re-entry checkout.
// The customer tells us name/phone/address ONCE (first order); every later order
// only confirms them with one word, and trusted repeats skip the OTP entirely.
// Same env-gated Supabase/in-memory split as reengage-store.ts / history-store.ts.
//
// Supabase table (apply where the project keeps schema, e.g. db/):
//   create table kfc_customer_contacts (
//     customer_id text primary key,
//     name text, phone text, address text,
//     fulfillment text check (fulfillment in ('delivery','pickup')),
//     updated_at timestamptz not null default now()
//   );
// The in-memory fallback fully works for the local demo.

import { createClient } from "@supabase/supabase-js";

export type FulfillmentMode = "delivery" | "pickup";

export type CustomerContact = {
  customerId: string;
  name?: string;
  phone?: string;
  address?: string;
  fulfillment?: FulfillmentMode;
  updatedAt: string;
};

export type ContactPatch = Partial<Omit<CustomerContact, "customerId" | "updatedAt">>;

export interface ContactStore {
  getContact(customerId: string): Promise<CustomerContact | null>;
  saveContact(customerId: string, patch: ContactPatch): Promise<void>;
}

// Only overwrite fields the patch actually carries a value for, so a later order
// that only re-states the address never blanks a previously-saved phone.
function mergeContact(existing: CustomerContact | null, customerId: string, patch: ContactPatch): CustomerContact {
  const next: CustomerContact = existing
    ? { ...existing }
    : { customerId, updatedAt: new Date().toISOString() };
  for (const key of ["name", "phone", "address", "fulfillment"] as const) {
    const value = patch[key];
    if (value !== undefined && value !== null && value !== "") {
      (next as Record<string, unknown>)[key] = value;
    }
  }
  next.updatedAt = new Date().toISOString();
  return next;
}

// Demo seed so tomorrow's stage run hits the confirm-only + OTP-skip path: the
// rehearsal customer already has a saved contact. (They still need ≥1 completed
// order for the OTP skip — the first live order creates that history.)
const DEMO_CONTACTS: CustomerContact[] = [
  {
    customerId: "msgr_demo_linh",
    name: "Linh",
    phone: "0901234567",
    address: "12 Main Street, District 1, Ho Chi Minh City",
    fulfillment: "delivery",
    updatedAt: new Date().toISOString(),
  },
];

class InMemoryContactStore implements ContactStore {
  private map = new Map<string, CustomerContact>();

  constructor() {
    this.seed();
  }

  private seed() {
    for (const contact of DEMO_CONTACTS) this.map.set(contact.customerId, { ...contact });
  }

  async getContact(customerId: string) {
    return this.map.get(customerId) ?? null;
  }

  async saveContact(customerId: string, patch: ContactPatch) {
    const merged = mergeContact(this.map.get(customerId) ?? null, customerId, patch);
    this.map.set(customerId, merged);
  }

  reset() {
    this.map.clear();
    this.seed();
  }
}

class SupabaseContactStore implements ContactStore {
  private client = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    { auth: { persistSession: false } },
  );

  async getContact(customerId: string) {
    const { data, error } = await this.client
      .from("kfc_customer_contacts")
      .select("customer_id, name, phone, address, fulfillment, updated_at")
      .eq("customer_id", customerId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      customerId: data.customer_id as string,
      name: (data.name as string | null) ?? undefined,
      phone: (data.phone as string | null) ?? undefined,
      address: (data.address as string | null) ?? undefined,
      fulfillment: (data.fulfillment as FulfillmentMode | null) ?? undefined,
      updatedAt: data.updated_at as string,
    };
  }

  async saveContact(customerId: string, patch: ContactPatch) {
    const existing = await this.getContact(customerId);
    const merged = mergeContact(existing, customerId, patch);
    const { error } = await this.client.from("kfc_customer_contacts").upsert({
      customer_id: merged.customerId,
      name: merged.name ?? null,
      phone: merged.phone ?? null,
      address: merged.address ?? null,
      fulfillment: merged.fulfillment ?? null,
      updated_at: merged.updatedAt,
    });
    if (error) throw error;
  }
}

const inMemoryStore = new InMemoryContactStore();

function hasSupabaseEnv() {
  return Boolean(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function getContactStore(): ContactStore {
  return hasSupabaseEnv() ? new SupabaseContactStore() : inMemoryStore;
}

export function resetInMemoryContacts() {
  inMemoryStore.reset();
}

function maskPhone(phone?: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `${digits.slice(0, 3)}***${digits.slice(-2)}`;
}

/**
 * One volatile system-context line describing the saved contact, injected per
 * turn AFTER the prompt-cache breakpoint (alongside weather/style). The agent
 * uses it to CONFIRM rather than re-ask. Returns "" when there is nothing saved.
 */
export function describeContactForAgent(contact: CustomerContact | null, completedOrderCount = 0): string {
  if (!contact || (!contact.address && !contact.phone)) return "";
  const parts: string[] = [];
  if (contact.name) parts.push(`name ${contact.name}`);
  if (contact.address) parts.push(`delivery address "${contact.address}"`);
  const masked = maskPhone(contact.phone);
  if (masked) parts.push(`phone ${masked}`);
  if (contact.fulfillment) parts.push(contact.fulfillment === "pickup" ? "usual pickup" : "usual delivery");
  const trusted = completedOrderCount >= 1 ? " Trusted returning customer, completed prior orders." : "";
  return `SAVED CONTACT — ${parts.join("; ")}. Saved from a previous order, confirm it instead of asking again.${trusted}`;
}
