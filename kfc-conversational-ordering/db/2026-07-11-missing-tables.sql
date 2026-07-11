-- Delta migration for the live aabw-colonel Supabase project (2026-07-11).
-- Three tables referenced by code were never provisioned, which silently
-- disabled: zero-re-entry checkout + trusted OTP-skip (kfc_customer_contacts),
-- the .chirpy chat→voice magic link (kfc_voice_links), and the learned answer
-- cache (kfc_answer_cache). Purely additive — safe to run any time.
-- Apply in the Supabase SQL editor, or: supabase db push / MCP apply_migration.
-- schema.sql already contains the same DDL for fresh provisions.

create table if not exists public.kfc_customer_contacts (
  customer_id text primary key,
  name text,
  phone text,
  address text,
  fulfillment text check (fulfillment in ('delivery','pickup')),
  updated_at timestamptz not null default now()
);
alter table public.kfc_customer_contacts enable row level security;

create table if not exists public.kfc_voice_links (
  token text primary key,
  customer_id text not null,
  conversation_key text not null,
  expires_at timestamptz not null,
  used_at timestamptz
);
alter table public.kfc_voice_links enable row level security;

create table if not exists public.kfc_answer_cache (
  key text primary key,
  say text not null,
  hits integer not null default 0,
  created_at timestamptz not null default now(),
  catalog_version text not null
);
alter table public.kfc_answer_cache enable row level security;
