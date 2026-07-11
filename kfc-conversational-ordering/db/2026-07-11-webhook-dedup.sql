-- Additive migration (applied to live aabw-colonel 2026-07-11): webhook
-- redelivery dedup table. Same DDL lives in schema.sql for fresh provisions.
create table if not exists public.kfc_webhook_events (
  mid text primary key,
  created_at timestamptz not null default now()
);
alter table public.kfc_webhook_events enable row level security;
