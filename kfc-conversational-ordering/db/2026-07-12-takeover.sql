-- Delta migration for the live aabw-colonel Supabase project (2026-07-12).
-- Human takeover: an operator can pause the agent on one Messenger
-- conversation and reply personally from /backend Inbox. The flag must be
-- durable + cross-instance (the webhook may land on any serverless instance),
-- so it lives here and not in module memory. Purely additive — safe any time.
-- Apply in the Supabase SQL editor, or: supabase db push / MCP apply_migration.
-- schema.sql already contains the same DDL for fresh provisions.

create table if not exists public.kfc_takeover (
  convo_id text primary key,
  active boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.kfc_takeover enable row level security;
-- server-only: no anon/authenticated policies (same stance as kfc_conversations).
