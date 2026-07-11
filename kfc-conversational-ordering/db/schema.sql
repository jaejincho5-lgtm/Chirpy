-- KFC P4 conversational ordering mock schema.
-- Tables use the kfc_ prefix so this app can share one Supabase project with the other AABW scaffolds.

create table if not exists public.kfc_menu (
  id text primary key,
  sku text not null unique,
  name text not null,
  vietnamese_name text not null,
  category text not null check (category in ('chicken', 'combo', 'burger', 'rice', 'side', 'drink', 'dessert')),
  description text not null,
  price_vnd integer not null check (price_vnd >= 0),
  tags text[] not null default '{}',
  options jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kfc_combos (
  id text primary key references public.kfc_menu(id) on delete cascade,
  serves integer not null default 1 check (serves >= 1),
  headline text not null,
  included_items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kfc_vouchers (
  code text primary key,
  description text not null,
  minimum_subtotal_vnd integer not null default 0 check (minimum_subtotal_vnd >= 0),
  discount_type text not null check (discount_type in ('percent', 'fixed', 'free_delivery')),
  discount_value integer not null default 0 check (discount_value >= 0),
  max_discount_vnd integer check (max_discount_vnd is null or max_discount_vnd >= 0),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kfc_orders (
  id text primary key,
  channel text not null check (channel in ('web', 'messenger')),
  customer_id text,
  stage text not null,
  order_payload jsonb not null,
  oms_order_number text,
  total_vnd integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kfc_order_events (
  id bigint generated always as identity primary key,
  order_id text not null references public.kfc_orders(id) on delete cascade,
  event_type text not null,
  event_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists kfc_menu_search_idx on public.kfc_menu using gin (tags);
create index if not exists kfc_menu_category_idx on public.kfc_menu (category) where is_active;
create index if not exists kfc_orders_channel_created_idx on public.kfc_orders (channel, created_at desc);
create index if not exists kfc_order_events_order_idx on public.kfc_order_events (order_id, created_at);

alter table public.kfc_menu enable row level security;
alter table public.kfc_combos enable row level security;
alter table public.kfc_vouchers enable row level security;
alter table public.kfc_orders enable row level security;
alter table public.kfc_order_events enable row level security;

create table if not exists public.kfc_customer_history (
  id bigint generated always as identity primary key,
  customer_id text not null,
  order_id text not null,
  context jsonb not null default '{}'::jsonb,
  lines jsonb not null,
  total_vnd integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists kfc_customer_history_idx on public.kfc_customer_history (customer_id, created_at desc);

create table if not exists public.kfc_suggestion_events (
  id bigint generated always as identity primary key,
  customer_id text not null,
  catalog_id text not null,
  action text not null check (action in ('accepted', 'declined')),
  created_at timestamptz not null default now()
);
create index if not exists kfc_suggestion_events_idx on public.kfc_suggestion_events (customer_id, created_at desc);

alter table public.kfc_customer_history enable row level security;
alter table public.kfc_suggestion_events enable row level security;

drop policy if exists "kfc_menu_public_read" on public.kfc_menu;
create policy "kfc_menu_public_read"
  on public.kfc_menu
  for select
  to anon, authenticated
  using (is_active);

drop policy if exists "kfc_combos_public_read" on public.kfc_combos;
create policy "kfc_combos_public_read"
  on public.kfc_combos
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.kfc_menu menu
      where menu.id = kfc_combos.id
        and menu.is_active
    )
  );

-- Vouchers, orders, and order events are server-only in the scaffold.
-- The Next.js route uses SUPABASE_SERVICE_ROLE_KEY when persistence is enabled later.

-- Channel (Messenger) conversation state: a webhook delivers one message
-- at a time, so history + cart continuity live server-side per sender.
create table if not exists public.kfc_conversations (
  id text primary key,
  customer_id text not null,
  order_payload jsonb,
  messages jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists kfc_conversations_updated_idx on public.kfc_conversations (updated_at desc);

alter table public.kfc_conversations enable row level security;
-- server-only: no anon/authenticated policies (same stance as kfc_orders).

-- Durable per-turn agent log (lib/turn-log.ts): every real conversation turn
-- with tools, token buckets (input / cache-read / cache-write / output), and
-- latency. Feeds /api/stats, demo replay, eval seeds, cost reconciliation.
create table if not exists public.kfc_agent_turns (
  id bigint generated always as identity primary key,
  convo_key text,
  customer_id text not null,
  channel text not null check (channel in ('web', 'messenger')),
  model text not null,
  user_text text not null,
  reply_text text not null,
  tool_calls jsonb not null default '[]'::jsonb,
  input_tokens integer not null default 0,
  cached_input_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  output_tokens integer not null default 0,
  latency_ms integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists kfc_agent_turns_customer_idx on public.kfc_agent_turns (customer_id, created_at desc);
create index if not exists kfc_agent_turns_created_idx on public.kfc_agent_turns (created_at desc);

alter table public.kfc_agent_turns enable row level security;
-- server-only: no anon/authenticated policies (same stance as kfc_orders).

-- P2-11 — durable OTP state (lib/otp.ts SupabaseOtpProvider): codes must
-- survive serverless instance churn, or a code minted on one instance fails
-- verification on another (hit live on the 2026-07-06 real-phone test).
create table if not exists public.kfc_otp (
  session_key text primary key,
  code text not null,
  phone text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  verified boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.kfc_otp enable row level security;
-- server-only: no anon/authenticated policies (codes must never be readable).

-- OTP request rate-limiting (lib/otp.ts): cap mint requests per session so a
-- caller cannot drain SMS or brute the mint path. Columns added by migration
-- otp_request_limits for existing DBs.
alter table public.kfc_otp
  add column if not exists request_count integer not null default 1,
  add column if not exists window_started_at timestamptz not null default now(),
  add column if not exists last_requested_at timestamptz not null default now();

-- Ghost-followup dedupe lock (lib/followup.ts): one follow-up per conversation
-- per 24h. Previously created ad hoc in the dashboard; codified here.
-- NOTE: the column is convo_key (matches lib/followup.ts and the live table) —
-- an earlier revision of this file wrongly said convo_id.
create table if not exists public.kfc_followups (
  convo_key text primary key,
  sent_at timestamptz not null default now()
);

alter table public.kfc_followups enable row level security;
-- server-only.

-- Saved delivery contact per customer (lib/contact-store.ts): the spine of
-- zero-re-entry checkout and the trusted OTP-skip. Without this table the
-- Supabase store throws and every caller silently degrades — contacts never
-- save, so "khách quen" trust can never trigger.
create table if not exists public.kfc_customer_contacts (
  customer_id text primary key,
  name text,
  phone text,
  address text,
  fulfillment text check (fulfillment in ('delivery','pickup')),
  updated_at timestamptz not null default now()
);

alter table public.kfc_customer_contacts enable row level security;
-- server-only.

-- Chirpy chat→voice magic links (lib/voice-links.ts): single-use short-TTL
-- token minted when a Messenger user types ".chirpy". Missing table = the
-- handoff link never mints and the demo beat dies.
create table if not exists public.kfc_voice_links (
  token text primary key,
  customer_id text not null,
  conversation_key text not null,
  expires_at timestamptz not null,
  used_at timestamptz
);

alter table public.kfc_voice_links enable row level security;
-- server-only.

-- Learned global answer cache (lib/answer-cache.ts): evergreen Q→A pairs shared
-- across customers, versioned against the menu catalog, 24h TTL.
create table if not exists public.kfc_answer_cache (
  key text primary key,
  say text not null,
  hits integer not null default 0,
  created_at timestamptz not null default now(),
  catalog_version text not null
);

alter table public.kfc_answer_cache enable row level security;
-- server-only.

-- Loyalty (lib/loyalty.ts): the loyalty account IS the messaging identity —
-- customer_id is `msgr_<psid>` on Messenger or the web persona id. Points earn
-- at 1 point per 1,000 VND on placed orders and are debited on redemption.
create table if not exists public.kfc_loyalty (
  customer_id text primary key,
  points integer not null default 0 check (points >= 0),
  lifetime_points integer not null default 0 check (lifetime_points >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.kfc_loyalty_events (
  id bigint generated always as identity primary key,
  customer_id text not null,
  delta integer not null,
  reason text not null check (reason in ('earn', 'redeem', 'adjust')),
  order_id text,
  created_at timestamptz not null default now()
);
create index if not exists kfc_loyalty_events_idx on public.kfc_loyalty_events (customer_id, created_at desc);

alter table public.kfc_loyalty enable row level security;
alter table public.kfc_loyalty_events enable row level security;
-- server-only.

-- OMS lifecycle: kfc_orders.stage now walks placed → preparing → ready →
-- completed (or → cancelled); every transition is appended to kfc_order_events
-- by lib/oms-store.ts. `stage` was free text from day one, so no migration of
-- existing rows is needed.

-- Nudge v2 — predictive re-engagement (lib/reengage.ts / lib/reengage-store.ts).
-- Prefs hold the explicit opt-out ("dừng") and the auto-mute timestamp (set
-- after 2 consecutive ignored sends). The notification log powers the weekly
-- cooldown gate, the ignore counter, and the /backend history panel. There is
-- deliberately NO "opened" column — Messenger gives no honest open signal.
create table if not exists public.kfc_reengage_prefs (
  customer_id text primary key,
  opted_out boolean not null default false,
  muted_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.kfc_reengage_notifications (
  id bigint generated always as identity primary key,
  customer_id text not null,
  channel text not null default 'messenger' check (channel in ('web', 'messenger')),
  message text not null,
  predicted_for text,
  confidence real not null default 0,
  sent_at timestamptz not null default now()
);
create index if not exists kfc_reengage_notifications_idx
  on public.kfc_reengage_notifications (customer_id, sent_at desc);

alter table public.kfc_reengage_prefs enable row level security;
alter table public.kfc_reengage_notifications enable row level security;
-- server-only.

-- ---------------------------------------------------------------------------
-- Messenger webhook redelivery dedup (2026-07-11). Facebook retries a webhook
-- not acknowledged within ~20s; each message.mid is claimed here once before
-- the agent runs, so a redelivery conflicts on the PK and is dropped instead
-- of doubling the cart. Server-only.
create table if not exists public.kfc_webhook_events (
  mid text primary key,
  created_at timestamptz not null default now()
);
alter table public.kfc_webhook_events enable row level security;
