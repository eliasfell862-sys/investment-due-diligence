create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'Asia/Shanghai',
  migration_status text not null default 'pending' check (migration_status in ('pending', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_id)
);

create table public.watchlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  watchlist_id uuid not null references public.watchlists(id) on delete cascade,
  code text not null check (code ~ '^[0-9]{6}$'),
  enabled boolean not null default true,
  source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, watchlist_id, code),
  unique (user_id, source_id)
);

create table public.position_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_id)
);

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  group_id uuid not null references public.position_groups(id),
  code text not null check (code ~ '^[0-9]{6}$'),
  name text not null,
  shares integer not null check (shares >= 0),
  average_cost numeric(20, 6) not null check (average_cost >= 0),
  total_cost numeric(24, 2) not null check (total_cost >= 0),
  source_id text,
  opened_at timestamptz not null,
  updated_at timestamptz not null default now(),
  unique (user_id, code),
  unique (user_id, source_id)
);

create table public.position_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  position_id uuid not null references public.positions(id) on delete cascade,
  source_transaction_id text not null,
  shares integer not null check (shares > 0 and shares % 100 = 0),
  remaining_shares integer not null check (remaining_shares >= 0 and remaining_shares <= shares),
  price numeric(20, 6) not null check (price > 0),
  trading_date date not null,
  bought_at timestamptz not null,
  unique (user_id, source_transaction_id)
);

create table public.position_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  position_id uuid references public.positions(id) on delete set null,
  group_id uuid not null references public.position_groups(id),
  code text not null check (code ~ '^[0-9]{6}$'),
  name text not null,
  transaction_type text not null check (transaction_type in ('buy', 'sell')),
  shares integer not null check (shares > 0 and shares % 100 = 0),
  price numeric(20, 6) not null check (price > 0),
  amount numeric(24, 2) not null check (amount >= 0),
  realized_profit numeric(24, 2) not null default 0,
  source_alert_id uuid,
  source_id text,
  traded_at timestamptz not null,
  trading_date date not null,
  created_at timestamptz not null default now(),
  unique (user_id, source_alert_id),
  unique (user_id, source_id)
);

create table public.strategy_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  strategy_id text not null,
  strategy_version text not null,
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, strategy_id)
);

create table public.signal_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null check (code ~ '^[0-9]{6}$'),
  strategy_id text not null,
  strategy_version text not null,
  buy_direction text not null default 'hold' check (buy_direction in ('buy', 'hold')),
  sell_direction text not null default 'hold' check (sell_direction in ('sell', 'hold')),
  buy_cycle_id text,
  sell_cycle_id text,
  pending_virtual_sell jsonb,
  updated_at timestamptz not null default now(),
  unique (user_id, code, strategy_id)
);

create table public.signal_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null check (code ~ '^[0-9]{6}$'),
  name text not null,
  price numeric(20, 6) not null check (price > 0),
  action text not null check (action in ('buy', 'sell')),
  intent text not null check (intent in ('open', 'add', 'reduce', 'exit')),
  suggested_shares integer not null check (suggested_shares >= 0 and suggested_shares % 100 = 0),
  position_shares_at_signal integer not null default 0 check (position_shares_at_signal >= 0),
  available_shares_at_signal integer not null default 0 check (available_shares_at_signal >= 0),
  reasons jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  entry_price numeric(20, 6) not null default 0,
  stop_loss numeric(20, 6) not null default 0,
  signal_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'bought', 'sold')),
  read_at timestamptz,
  executed_at timestamptz,
  message_kind text not null,
  virtual_tracking_status text not null,
  virtual_trade_id uuid,
  virtual_cycle_id uuid,
  virtual_shares integer not null default 0 check (virtual_shares >= 0),
  virtual_price numeric(20, 6),
  virtual_position_shares_after integer,
  virtual_available_shares_after integer,
  strategy_id text not null,
  strategy_version text not null,
  cycle_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, code, strategy_id, strategy_version, action, intent, cycle_id)
);

alter table public.position_transactions
  add constraint position_transactions_source_alert_fk
  foreign key (source_alert_id) references public.signal_alerts(id) on delete set null;

create table public.virtual_cycles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  strategy_id text not null,
  strategy_version text not null,
  code text not null check (code ~ '^[0-9]{6}$'),
  name text not null,
  opened_at timestamptz not null,
  closed_at timestamptz,
  realized_profit numeric(24, 2) not null default 0,
  unique (user_id, strategy_id, id)
);

create table public.virtual_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cycle_id uuid not null references public.virtual_cycles(id) on delete cascade,
  strategy_id text not null,
  strategy_version text not null,
  code text not null check (code ~ '^[0-9]{6}$'),
  name text not null,
  shares integer not null check (shares >= 0),
  average_cost numeric(20, 6) not null check (average_cost >= 0),
  total_cost numeric(24, 2) not null check (total_cost >= 0),
  opened_at timestamptz not null,
  updated_at timestamptz not null default now(),
  unique (user_id, strategy_id, code)
);

create table public.virtual_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  position_id uuid not null references public.virtual_positions(id) on delete cascade,
  source_signal_id uuid references public.signal_alerts(id) on delete set null,
  shares integer not null check (shares > 0 and shares % 100 = 0),
  remaining_shares integer not null check (remaining_shares >= 0 and remaining_shares <= shares),
  price numeric(20, 6) not null check (price > 0),
  trading_date date not null,
  bought_at timestamptz not null
);

create table public.virtual_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cycle_id uuid not null references public.virtual_cycles(id) on delete cascade,
  position_id uuid references public.virtual_positions(id) on delete set null,
  source_signal_id uuid references public.signal_alerts(id) on delete set null,
  strategy_id text not null,
  strategy_version text not null,
  code text not null check (code ~ '^[0-9]{6}$'),
  name text not null,
  transaction_type text not null check (transaction_type in ('buy', 'sell')),
  shares integer not null check (shares > 0 and shares % 100 = 0),
  price numeric(20, 6) not null check (price > 0),
  amount numeric(24, 2) not null check (amount >= 0),
  realized_profit numeric(24, 2) not null default 0,
  traded_at timestamptz not null,
  trading_date date not null,
  unique (user_id, source_signal_id)
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  device_label text not null default 'Browser',
  last_success_at timestamptz,
  expired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  alert_id uuid not null references public.signal_alerts(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  status text not null check (status in ('pending', 'sent', 'failed', 'expired')),
  attempted_at timestamptz not null default now(),
  delivered_at timestamptz,
  error text,
  unique (alert_id, subscription_id)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  entity_type text not null,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.worker_leases (
  worker_name text primary key,
  owner_id text not null,
  lease_until timestamptz not null,
  updated_at timestamptz not null default now()
);

create table public.worker_heartbeats (
  worker_name text primary key,
  owner_id text not null,
  worker_version text not null,
  status text not null check (status in ('starting', 'running', 'degraded', 'stopping')),
  last_scan_id uuid,
  heartbeat_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb
);

create table public.scan_runs (
  id uuid primary key default gen_random_uuid(),
  worker_name text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  quote_at timestamptz,
  unique_code_count integer not null default 0 check (unique_code_count >= 0),
  assignment_count integer not null default 0 check (assignment_count >= 0),
  success_count integer not null default 0 check (success_count >= 0),
  failure_count integer not null default 0 check (failure_count >= 0),
  opened_signal_count integer not null default 0 check (opened_signal_count >= 0),
  duration_ms integer check (duration_ms >= 0),
  error text
);

alter table public.worker_heartbeats
  add constraint worker_heartbeats_last_scan_fk
  foreign key (last_scan_id) references public.scan_runs(id) on delete set null;

create table public.market_data_failures (
  id uuid primary key default gen_random_uuid(),
  scan_run_id uuid not null references public.scan_runs(id) on delete cascade,
  source text not null,
  code text not null check (code ~ '^[0-9]{6}$'),
  error text not null,
  occurred_at timestamptz not null default now()
);

create index watchlist_items_active_code_idx on public.watchlist_items (code) where enabled;
create index positions_user_code_idx on public.positions (user_id, code);
create index position_lots_available_idx on public.position_lots (position_id, trading_date) where remaining_shares > 0;
create index signal_alerts_user_unread_idx on public.signal_alerts (user_id, created_at desc) where read_at is null;
create index signal_states_code_idx on public.signal_states (code);
create index virtual_positions_code_idx on public.virtual_positions (code);
create index scan_runs_started_at_idx on public.scan_runs (started_at desc);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'watchlists', 'watchlist_items', 'position_groups', 'positions',
    'position_lots', 'position_transactions', 'strategy_assignments', 'signal_states',
    'signal_alerts', 'virtual_positions', 'virtual_lots', 'virtual_transactions',
    'virtual_cycles', 'push_subscriptions', 'notification_deliveries', 'audit_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy %I_owner on public.%I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      table_name,
      table_name
    );
  end loop;
end;
$$;

alter table public.worker_leases enable row level security;
alter table public.worker_heartbeats enable row level security;
alter table public.scan_runs enable row level security;
alter table public.market_data_failures enable row level security;

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.watchlists to authenticated;
grant select, insert, update, delete on public.watchlist_items to authenticated;
grant select, insert, update, delete on public.position_groups to authenticated;
grant select, insert, update, delete on public.positions to authenticated;
grant select, insert, update, delete on public.position_lots to authenticated;
grant select, insert, update, delete on public.position_transactions to authenticated;
grant select, insert, update, delete on public.strategy_assignments to authenticated;
grant select on public.signal_states to authenticated;
grant select, update on public.signal_alerts to authenticated;
grant select on public.virtual_positions, public.virtual_lots, public.virtual_transactions, public.virtual_cycles to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select on public.notification_deliveries, public.audit_events to authenticated;

create or replace function public.claim_worker_lease(
  p_worker_name text,
  p_owner_id text,
  p_ttl_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed boolean := false;
begin
  if length(trim(p_worker_name)) = 0 or length(trim(p_owner_id)) = 0 then
    raise exception 'worker name and owner id are required';
  end if;
  if p_ttl_seconds < 5 or p_ttl_seconds > 300 then
    raise exception 'worker lease ttl must be between 5 and 300 seconds';
  end if;

  insert into public.worker_leases (worker_name, owner_id, lease_until, updated_at)
  values (p_worker_name, p_owner_id, now() + make_interval(secs => p_ttl_seconds), now())
  on conflict (worker_name) do update
    set owner_id = excluded.owner_id,
        lease_until = excluded.lease_until,
        updated_at = now()
    where public.worker_leases.lease_until <= now()
       or public.worker_leases.owner_id = excluded.owner_id
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;

revoke all on function public.claim_worker_lease(text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_worker_lease(text, text, integer) to service_role;

create or replace function public.commit_signal_transition(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (p_payload ->> 'user_id')::uuid;
  v_alert_id uuid;
  v_created boolean := false;
begin
  if v_user_id is null then raise exception 'user_id is required'; end if;
  if coalesce(p_payload ->> 'code', '') !~ '^[0-9]{6}$' then raise exception 'valid code is required'; end if;
  if coalesce((p_payload ->> 'price')::numeric, 0) <= 0 then raise exception 'positive price is required'; end if;

  insert into public.signal_states (
    user_id, code, strategy_id, strategy_version, buy_direction, sell_direction,
    buy_cycle_id, sell_cycle_id, pending_virtual_sell, updated_at
  )
  values (
    v_user_id,
    p_payload ->> 'code',
    p_payload ->> 'strategy_id',
    p_payload ->> 'strategy_version',
    coalesce(p_payload ->> 'buy_direction', 'hold'),
    coalesce(p_payload ->> 'sell_direction', 'hold'),
    p_payload ->> 'buy_cycle_id',
    p_payload ->> 'sell_cycle_id',
    p_payload -> 'pending_virtual_sell',
    (p_payload ->> 'signal_at')::timestamptz
  )
  on conflict (user_id, code, strategy_id) do update
    set strategy_version = excluded.strategy_version,
        buy_direction = excluded.buy_direction,
        sell_direction = excluded.sell_direction,
        buy_cycle_id = excluded.buy_cycle_id,
        sell_cycle_id = excluded.sell_cycle_id,
        pending_virtual_sell = excluded.pending_virtual_sell,
        updated_at = excluded.updated_at;

  insert into public.signal_alerts (
    user_id, code, name, price, action, intent, suggested_shares,
    position_shares_at_signal, available_shares_at_signal, reasons, metrics,
    entry_price, stop_loss, signal_at, message_kind, virtual_tracking_status,
    virtual_trade_id, virtual_cycle_id, virtual_shares, virtual_price,
    virtual_position_shares_after, virtual_available_shares_after,
    strategy_id, strategy_version, cycle_id
  )
  values (
    v_user_id,
    p_payload ->> 'code',
    p_payload ->> 'name',
    (p_payload ->> 'price')::numeric,
    p_payload ->> 'action',
    p_payload ->> 'intent',
    coalesce((p_payload ->> 'suggested_shares')::integer, 0),
    coalesce((p_payload ->> 'position_shares_at_signal')::integer, 0),
    coalesce((p_payload ->> 'available_shares_at_signal')::integer, 0),
    coalesce(p_payload -> 'reasons', '[]'::jsonb),
    coalesce(p_payload -> 'metrics', '{}'::jsonb),
    coalesce((p_payload ->> 'entry_price')::numeric, 0),
    coalesce((p_payload ->> 'stop_loss')::numeric, 0),
    (p_payload ->> 'signal_at')::timestamptz,
    p_payload ->> 'message_kind',
    p_payload ->> 'virtual_tracking_status',
    nullif(p_payload ->> 'virtual_trade_id', '')::uuid,
    nullif(p_payload ->> 'virtual_cycle_id', '')::uuid,
    coalesce((p_payload ->> 'virtual_shares')::integer, 0),
    nullif(p_payload ->> 'virtual_price', '')::numeric,
    nullif(p_payload ->> 'virtual_position_shares_after', '')::integer,
    nullif(p_payload ->> 'virtual_available_shares_after', '')::integer,
    p_payload ->> 'strategy_id',
    p_payload ->> 'strategy_version',
    p_payload ->> 'cycle_id'
  )
  on conflict (user_id, code, strategy_id, strategy_version, action, intent, cycle_id)
  do nothing
  returning id into v_alert_id;

  if v_alert_id is not null then
    v_created := true;
  else
    select id into v_alert_id
    from public.signal_alerts
    where user_id = v_user_id
      and code = p_payload ->> 'code'
      and strategy_id = p_payload ->> 'strategy_id'
      and strategy_version = p_payload ->> 'strategy_version'
      and action = p_payload ->> 'action'
      and intent = p_payload ->> 'intent'
      and cycle_id = p_payload ->> 'cycle_id';
  end if;

  if v_created then
    insert into public.audit_events (user_id, event_type, entity_type, entity_id, payload)
    values (v_user_id, 'signal_opened', 'signal_alert', v_alert_id::text, p_payload);
  end if;

  return v_alert_id;
end;
$$;

revoke all on function public.commit_signal_transition(jsonb) from public, anon, authenticated;
grant execute on function public.commit_signal_transition(jsonb) to service_role;
