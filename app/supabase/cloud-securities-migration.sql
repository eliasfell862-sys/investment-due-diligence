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
create table public.local_securities_migrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  migration_id text not null check (migration_id ~ '^[a-f0-9]{64}$'),
  status text not null default 'completed' check (status in ('completed')),
  imported_counts jsonb not null default '{}'::jsonb,
  completed_at timestamptz not null default now(),
  unique (user_id, migration_id)
);

alter table public.local_securities_migrations enable row level security;
create policy local_securities_migrations_owner on public.local_securities_migrations
  for select to authenticated using (auth.uid() = user_id);
grant select on public.local_securities_migrations to authenticated;

alter table public.signal_alerts add column if not exists source_id text;
alter table public.signal_alerts
  add constraint signal_alerts_user_source_id_unique unique (user_id, source_id);

alter table public.virtual_cycles add column if not exists source_id text;
alter table public.virtual_cycles
  add constraint virtual_cycles_user_source_id_unique unique (user_id, source_id);

alter table public.virtual_positions add column if not exists source_id text;
alter table public.virtual_positions
  add constraint virtual_positions_user_source_id_unique unique (user_id, source_id);

alter table public.virtual_lots add column if not exists source_id text;
alter table public.virtual_lots
  add constraint virtual_lots_user_source_id_unique unique (user_id, source_id);

alter table public.virtual_transactions add column if not exists source_id text;
alter table public.virtual_transactions
  add constraint virtual_transactions_user_source_id_unique unique (user_id, source_id);

create or replace function public.import_local_securities_state(
  p_migration_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_item jsonb;
  v_watchlist_id uuid;
  v_group_id uuid;
  v_position_id uuid;
  v_cycle_id uuid;
  v_alert_id uuid;
  v_virtual_position_id uuid;
  v_sell_remaining integer;
  v_consumed integer;
  v_lot record;
  v_counts jsonb;
begin
  if v_user_id is null then raise exception 'authentication is required'; end if;
  if coalesce(p_migration_id, '') !~ '^[a-f0-9]{64}$' then raise exception 'valid migration id is required'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'migration payload is required'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_migration_id, 0));
  if exists (
    select 1 from public.local_securities_migrations
    where user_id = v_user_id and migration_id = p_migration_id
  ) then
    return (select imported_counts from public.local_securities_migrations
      where user_id = v_user_id and migration_id = p_migration_id);
  end if;

  insert into public.profiles (user_id, migration_status, updated_at)
  values (v_user_id, 'pending', now())
  on conflict (user_id) do update set updated_at = now();

  for v_item in select value from jsonb_array_elements(coalesce(p_payload -> 'watchlists', '[]'::jsonb)) loop
    insert into public.watchlists (user_id, name, source_id, created_at, updated_at)
    values (
      v_user_id, v_item ->> 'name', v_item ->> 'sourceId',
      (v_item ->> 'createdAt')::timestamptz, now()
    )
    on conflict (user_id, source_id) do update
      set name = excluded.name, updated_at = now();
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_payload -> 'watchlistItems', '[]'::jsonb)) loop
    select id into strict v_watchlist_id from public.watchlists
    where user_id = v_user_id and source_id = v_item ->> 'watchlistSourceId';
    insert into public.watchlist_items (user_id, watchlist_id, code, source_id, enabled, updated_at)
    values (v_user_id, v_watchlist_id, v_item ->> 'code', v_item ->> 'sourceId', true, now())
    on conflict (user_id, source_id) do update
      set watchlist_id = excluded.watchlist_id, code = excluded.code, enabled = true, updated_at = now();
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_payload -> 'positionGroups', '[]'::jsonb)) loop
    insert into public.position_groups (user_id, name, source_id, updated_at)
    values (v_user_id, v_item ->> 'name', v_item ->> 'sourceId', now())
    on conflict (user_id, source_id) do update set name = excluded.name, updated_at = now();
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_payload -> 'positions', '[]'::jsonb)) loop
    select id into strict v_group_id from public.position_groups
    where user_id = v_user_id and source_id = v_item ->> 'groupSourceId';
    insert into public.positions (
      user_id, group_id, code, name, shares, average_cost, total_cost,
      source_id, opened_at, updated_at
    ) values (
      v_user_id, v_group_id, v_item ->> 'code', v_item ->> 'name',
      (v_item ->> 'shares')::integer, (v_item ->> 'averageCost')::numeric,
      (v_item ->> 'totalCost')::numeric, v_item ->> 'sourceId',
      (v_item ->> 'openedAt')::timestamptz, (v_item ->> 'updatedAt')::timestamptz
    )
    on conflict (user_id, source_id) do update set
      group_id = excluded.group_id, code = excluded.code, name = excluded.name,
      shares = excluded.shares, average_cost = excluded.average_cost,
      total_cost = excluded.total_cost, opened_at = excluded.opened_at,
      updated_at = excluded.updated_at;
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_payload -> 'positionLots', '[]'::jsonb)) loop
    select id into strict v_position_id from public.positions
    where user_id = v_user_id and source_id = v_item ->> 'positionSourceId';
    insert into public.position_lots (
      user_id, position_id, source_transaction_id, shares, remaining_shares,
      price, trading_date, bought_at
    ) values (
      v_user_id, v_position_id, v_item ->> 'sourceTransactionId',
      (v_item ->> 'shares')::integer, (v_item ->> 'remainingShares')::integer,
      (v_item ->> 'price')::numeric,
      ((v_item ->> 'boughtAt')::timestamptz at time zone 'Asia/Shanghai')::date,
      (v_item ->> 'boughtAt')::timestamptz
    )
    on conflict (user_id, source_transaction_id) do update set
      position_id = excluded.position_id, shares = excluded.shares,
      remaining_shares = excluded.remaining_shares, price = excluded.price,
      trading_date = excluded.trading_date, bought_at = excluded.bought_at;
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_payload -> 'signalStates', '[]'::jsonb)) loop
    insert into public.signal_states (
      user_id, code, strategy_id, strategy_version, buy_direction, sell_direction,
      pending_virtual_sell, updated_at
    ) values (
      v_user_id, v_item ->> 'code', 'realtime-backtest-monitor', '3',
      coalesce(v_item #>> '{state,lastBuyDecision}', 'hold'),
      coalesce(v_item #>> '{state,lastSellDecision}', 'hold'),
      v_item #> '{state,pendingVirtualSell}',
      coalesce((v_item #>> '{state,updatedAt}')::timestamptz, now())
    )
    on conflict (user_id, code, strategy_id) do update set
      strategy_version = excluded.strategy_version,
      buy_direction = excluded.buy_direction, sell_direction = excluded.sell_direction,
      pending_virtual_sell = excluded.pending_virtual_sell, updated_at = excluded.updated_at;
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_payload -> 'signalAlerts', '[]'::jsonb)) loop
    insert into public.signal_alerts (
      user_id, source_id, code, name, price, action, intent, suggested_shares,
      position_shares_at_signal, available_shares_at_signal, reasons, metrics,
      entry_price, stop_loss, signal_at, status, read_at, executed_at, message_kind,
      virtual_tracking_status, virtual_shares, virtual_price,
      virtual_position_shares_after, virtual_available_shares_after,
      strategy_id, strategy_version, cycle_id
    ) values (
      v_user_id, v_item ->> 'id', v_item ->> 'code', v_item ->> 'name',
      (v_item ->> 'price')::numeric, v_item ->> 'action', v_item ->> 'intent',
      coalesce((v_item ->> 'suggestedShares')::integer, 0),
      coalesce((v_item ->> 'positionSharesAtSignal')::integer, 0),
      coalesce((v_item ->> 'availableSharesAtSignal')::integer, 0),
      coalesce(v_item -> 'reasons', '[]'::jsonb), coalesce(v_item -> 'metrics', '{}'::jsonb),
      coalesce((v_item ->> 'entryPrice')::numeric, 0), coalesce((v_item ->> 'stopLoss')::numeric, 0),
      (v_item ->> 'signalAt')::timestamptz, coalesce(v_item ->> 'status', 'pending'),
      nullif(v_item ->> 'readAt', '')::timestamptz, nullif(v_item ->> 'executedAt', '')::timestamptz,
      coalesce(v_item ->> 'messageKind', 'legacy'),
      coalesce(v_item ->> 'virtualTrackingStatus', 'legacy_untracked'),
      coalesce((v_item ->> 'virtualShares')::integer, 0), nullif(v_item ->> 'virtualPrice', '')::numeric,
      nullif(v_item ->> 'virtualPositionSharesAfter', '')::integer,
      nullif(v_item ->> 'virtualAvailableSharesAfter', '')::integer,
      coalesce(v_item ->> 'strategyId', 'legacy-v2'), coalesce(v_item ->> 'strategyVersion', '2'),
      coalesce(nullif(v_item ->> 'virtualCycleId', ''), v_item ->> 'id')
    )
    on conflict (user_id, source_id) do update set
      status = excluded.status, read_at = excluded.read_at, executed_at = excluded.executed_at;
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_payload -> 'positionTransactions', '[]'::jsonb)) loop
    select id into strict v_group_id from public.position_groups
    where user_id = v_user_id and source_id = v_item ->> 'groupSourceId';
    select id into v_position_id from public.positions
    where user_id = v_user_id and source_id = v_item ->> 'positionSourceId';
    select id into v_alert_id from public.signal_alerts
    where user_id = v_user_id and source_id = v_item ->> 'sourceAlertSourceId';
    insert into public.position_transactions (
      user_id, position_id, group_id, code, name, transaction_type, shares,
      price, amount, realized_profit, source_alert_id, source_id, traded_at, trading_date
    ) values (
      v_user_id, v_position_id, v_group_id, v_item ->> 'code', v_item ->> 'name',
      v_item ->> 'type', (v_item ->> 'shares')::integer, (v_item ->> 'price')::numeric,
      (v_item ->> 'amount')::numeric, coalesce((v_item ->> 'realizedProfit')::numeric, 0),
      v_alert_id, v_item ->> 'sourceId', (v_item ->> 'tradedAt')::timestamptz,
      ((v_item ->> 'tradedAt')::timestamptz at time zone 'Asia/Shanghai')::date
    )
    on conflict (user_id, source_id) do update set
      position_id = excluded.position_id, group_id = excluded.group_id,
      source_alert_id = excluded.source_alert_id;
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_payload #> '{virtualLedger,cycles}', '[]'::jsonb)) loop
    insert into public.virtual_cycles (
      user_id, source_id, strategy_id, strategy_version, code, name,
      opened_at, closed_at, realized_profit
    ) values (
      v_user_id, v_item ->> 'id', v_item ->> 'strategyId', v_item ->> 'strategyVersion',
      v_item ->> 'code', v_item ->> 'name', (v_item ->> 'openedAt')::timestamptz,
      nullif(v_item ->> 'closedAt', '')::timestamptz,
      coalesce((v_item ->> 'realizedProfit')::numeric, 0)
    )
    on conflict (user_id, source_id) do update set
      closed_at = excluded.closed_at, realized_profit = excluded.realized_profit;
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_payload #> '{virtualLedger,positions}', '[]'::jsonb)) loop
    select id into strict v_cycle_id from public.virtual_cycles
    where user_id = v_user_id and source_id = v_item ->> 'cycleId';
    insert into public.virtual_positions (
      user_id, source_id, cycle_id, strategy_id, strategy_version, code, name,
      shares, average_cost, total_cost, opened_at, updated_at
    ) values (
      v_user_id, v_item ->> 'id', v_cycle_id, v_item ->> 'strategyId',
      v_item ->> 'strategyVersion', v_item ->> 'code', v_item ->> 'name',
      (v_item ->> 'shares')::integer, (v_item ->> 'averageCost')::numeric,
      (v_item ->> 'totalCost')::numeric, (v_item ->> 'openedAt')::timestamptz,
      (v_item ->> 'updatedAt')::timestamptz
    )
    on conflict (user_id, source_id) do update set
      shares = excluded.shares, average_cost = excluded.average_cost,
      total_cost = excluded.total_cost, updated_at = excluded.updated_at;
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_payload #> '{virtualLedger,transactions}', '[]'::jsonb))
    order by (value ->> 'tradedAt')::timestamptz, value ->> 'id'
  loop
    select id into strict v_cycle_id from public.virtual_cycles
    where user_id = v_user_id and source_id = v_item ->> 'cycleId';
    select id into v_virtual_position_id from public.virtual_positions
    where user_id = v_user_id and cycle_id = v_cycle_id;
    select id into v_alert_id from public.signal_alerts
    where user_id = v_user_id and source_id = v_item ->> 'sourceSignalId';
    insert into public.virtual_transactions (
      user_id, source_id, cycle_id, position_id, source_signal_id, strategy_id,
      strategy_version, code, name, transaction_type, shares, price, amount,
      realized_profit, traded_at, trading_date
    ) values (
      v_user_id, v_item ->> 'id', v_cycle_id, v_virtual_position_id, v_alert_id,
      v_item ->> 'strategyId', v_item ->> 'strategyVersion', v_item ->> 'code',
      v_item ->> 'name', v_item ->> 'type', (v_item ->> 'shares')::integer,
      (v_item ->> 'price')::numeric, (v_item ->> 'amount')::numeric,
      coalesce((v_item ->> 'realizedProfit')::numeric, 0),
      (v_item ->> 'tradedAt')::timestamptz,
      ((v_item ->> 'tradedAt')::timestamptz at time zone 'Asia/Shanghai')::date
    )
    on conflict (user_id, source_id) do nothing;

    if v_virtual_position_id is not null and v_item ->> 'type' = 'buy' then
      insert into public.virtual_lots (
        user_id, position_id, source_signal_id, source_id, shares, remaining_shares,
        price, trading_date, bought_at
      ) values (
        v_user_id, v_virtual_position_id, v_alert_id, v_item ->> 'id',
        (v_item ->> 'shares')::integer, (v_item ->> 'shares')::integer,
        (v_item ->> 'price')::numeric,
        ((v_item ->> 'tradedAt')::timestamptz at time zone 'Asia/Shanghai')::date,
        (v_item ->> 'tradedAt')::timestamptz
      ) on conflict (user_id, source_id) do nothing;
    elsif v_virtual_position_id is not null and v_item ->> 'type' = 'sell' then
      v_sell_remaining := (v_item ->> 'shares')::integer;
      for v_lot in
        select id, remaining_shares from public.virtual_lots
        where user_id = v_user_id and position_id = v_virtual_position_id and remaining_shares > 0
        order by bought_at, id for update
      loop
        exit when v_sell_remaining = 0;
        v_consumed := least(v_lot.remaining_shares, v_sell_remaining);
        update public.virtual_lots set remaining_shares = remaining_shares - v_consumed where id = v_lot.id;
        v_sell_remaining := v_sell_remaining - v_consumed;
      end loop;
      if v_sell_remaining > 0 then raise exception 'virtual sell exceeds imported buy lots'; end if;
    end if;
  end loop;

  v_counts := jsonb_build_object(
    'watchlists', jsonb_array_length(coalesce(p_payload -> 'watchlists', '[]'::jsonb)),
    'watchlistItems', jsonb_array_length(coalesce(p_payload -> 'watchlistItems', '[]'::jsonb)),
    'positions', jsonb_array_length(coalesce(p_payload -> 'positions', '[]'::jsonb)),
    'signalAlerts', jsonb_array_length(coalesce(p_payload -> 'signalAlerts', '[]'::jsonb))
  );

  insert into public.local_securities_migrations (user_id, migration_id, imported_counts)
  values (v_user_id, p_migration_id, v_counts);
  update public.profiles set migration_status = 'completed', updated_at = now() where user_id = v_user_id;
  insert into public.audit_events (user_id, event_type, entity_type, entity_id, payload)
  values (v_user_id, 'local_securities_imported', 'local_migration', p_migration_id, v_counts);
  return v_counts;
end;
$$;

revoke all on function public.import_local_securities_state(text, jsonb) from public, anon;
grant execute on function public.import_local_securities_state(text, jsonb) to authenticated;
create or replace function public.execute_cloud_position_buy(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_alert_id uuid := nullif(p_payload ->> 'alert_id', '')::uuid;
  v_group_id uuid;
  v_position_id uuid;
  v_transaction_id uuid;
  v_code text := p_payload ->> 'code';
  v_name text := p_payload ->> 'name';
  v_shares integer := (p_payload ->> 'shares')::integer;
  v_price numeric := (p_payload ->> 'price')::numeric;
  v_traded_at timestamptz := (p_payload ->> 'traded_at')::timestamptz;
  v_trading_date date;
begin
  if v_user_id is null then raise exception 'authentication is required'; end if;
  if v_alert_id is null then raise exception 'alert id is required'; end if;
  if v_code !~ '^[0-9]{6}$' then raise exception 'valid code is required'; end if;
  if coalesce(length(trim(v_name)), 0) = 0 then raise exception 'stock name is required'; end if;
  if v_shares <= 0 or v_shares % 100 <> 0 then raise exception 'buy shares must be a positive board lot'; end if;
  if v_price <= 0 then raise exception 'positive price is required'; end if;
  v_trading_date := (v_traded_at at time zone 'Asia/Shanghai')::date;

  select id into v_transaction_id from public.position_transactions
  where user_id = v_user_id and source_alert_id = v_alert_id;
  if v_transaction_id is not null then return v_transaction_id; end if;

  perform 1 from public.signal_alerts
  where id = v_alert_id and user_id = v_user_id and action = 'buy' and status = 'pending'
  for update;
  if not found then raise exception 'pending buy alert was not found'; end if;

  insert into public.position_groups (user_id, name, source_id, updated_at)
  values (
    v_user_id,
    coalesce(nullif(trim(p_payload ->> 'group_name'), ''), '默认持仓'),
    coalesce(nullif(trim(p_payload ->> 'group_source_id'), ''), 'default'),
    now()
  )
  on conflict (user_id, source_id) do update
    set name = excluded.name, updated_at = now()
  returning id into v_group_id;

  insert into public.positions (
    user_id, group_id, code, name, shares, average_cost, total_cost,
    source_id, opened_at, updated_at
  ) values (
    v_user_id, v_group_id, v_code, v_name, v_shares, v_price,
    round(v_shares * v_price, 2), 'cloud-position:' || v_code, v_traded_at, v_traded_at
  )
  on conflict (user_id, code) do update set
    group_id = excluded.group_id,
    name = excluded.name,
    shares = public.positions.shares + excluded.shares,
    total_cost = round(public.positions.total_cost + excluded.total_cost, 2),
    average_cost = round(
      (public.positions.total_cost + excluded.total_cost)
      / (public.positions.shares + excluded.shares), 6
    ),
    updated_at = excluded.updated_at
  returning id into v_position_id;

  insert into public.position_transactions (
    user_id, position_id, group_id, code, name, transaction_type, shares,
    price, amount, realized_profit, source_alert_id, source_id, traded_at, trading_date
  ) values (
    v_user_id, v_position_id, v_group_id, v_code, v_name, 'buy', v_shares,
    v_price, round(v_shares * v_price, 2), 0, v_alert_id,
    'cloud-alert:' || v_alert_id::text, v_traded_at, v_trading_date
  ) returning id into v_transaction_id;

  insert into public.position_lots (
    user_id, position_id, source_transaction_id, shares, remaining_shares,
    price, trading_date, bought_at
  ) values (
    v_user_id, v_position_id, v_transaction_id::text, v_shares, v_shares,
    v_price, v_trading_date, v_traded_at
  );

  update public.signal_alerts set
    status = 'bought', executed_at = v_traded_at, read_at = coalesce(read_at, v_traded_at)
  where id = v_alert_id and user_id = v_user_id;

  insert into public.audit_events (user_id, event_type, entity_type, entity_id, payload)
  values (v_user_id, 'cloud_position_bought', 'position_transaction', v_transaction_id::text, p_payload);
  return v_transaction_id;
end;
$$;

create or replace function public.execute_cloud_position_sell(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_alert_id uuid := nullif(p_payload ->> 'alert_id', '')::uuid;
  v_position public.positions%rowtype;
  v_transaction_id uuid;
  v_code text := p_payload ->> 'code';
  v_shares integer := (p_payload ->> 'shares')::integer;
  v_price numeric := (p_payload ->> 'price')::numeric;
  v_traded_at timestamptz := (p_payload ->> 'traded_at')::timestamptz;
  v_trading_date date;
  v_available integer;
  v_remaining integer;
  v_consumed integer;
  v_lot record;
  v_realized_profit numeric;
begin
  if v_user_id is null then raise exception 'authentication is required'; end if;
  if v_alert_id is null then raise exception 'alert id is required'; end if;
  if v_code !~ '^[0-9]{6}$' then raise exception 'valid code is required'; end if;
  if v_shares <= 0 or v_shares % 100 <> 0 then raise exception 'sell shares must be a positive board lot'; end if;
  if v_price <= 0 then raise exception 'positive price is required'; end if;
  v_trading_date := (v_traded_at at time zone 'Asia/Shanghai')::date;

  select id into v_transaction_id from public.position_transactions
  where user_id = v_user_id and source_alert_id = v_alert_id;
  if v_transaction_id is not null then return v_transaction_id; end if;

  perform 1 from public.signal_alerts
  where id = v_alert_id and user_id = v_user_id and action = 'sell' and status = 'pending'
  for update;
  if not found then raise exception 'pending sell alert was not found'; end if;

  select * into v_position from public.positions
  where user_id = v_user_id and code = v_code for update;
  if not found then raise exception 'position was not found'; end if;

  select coalesce(sum(remaining_shares), 0)::integer into v_available
  from public.position_lots
  where user_id = v_user_id and position_id = v_position.id
    and trading_date < v_trading_date and remaining_shares > 0;
  if v_shares > v_available then raise exception 'sell shares exceed T+1 available shares'; end if;

  v_remaining := v_shares;
  for v_lot in
    select id, remaining_shares from public.position_lots
    where user_id = v_user_id and position_id = v_position.id
      and trading_date < v_trading_date and remaining_shares > 0
    order by bought_at, id for update
  loop
    exit when v_remaining = 0;
    v_consumed := least(v_lot.remaining_shares, v_remaining);
    update public.position_lots
      set remaining_shares = remaining_shares - v_consumed
      where id = v_lot.id;
    v_remaining := v_remaining - v_consumed;
  end loop;

  v_realized_profit := round((v_price - v_position.average_cost) * v_shares, 2);
  insert into public.position_transactions (
    user_id, position_id, group_id, code, name, transaction_type, shares,
    price, amount, realized_profit, source_alert_id, source_id, traded_at, trading_date
  ) values (
    v_user_id, v_position.id, v_position.group_id, v_position.code, v_position.name,
    'sell', v_shares, v_price, round(v_shares * v_price, 2), v_realized_profit,
    v_alert_id, 'cloud-alert:' || v_alert_id::text, v_traded_at, v_trading_date
  ) returning id into v_transaction_id;

  if v_shares = v_position.shares then
    delete from public.positions where id = v_position.id;
  else
    update public.positions set
      shares = shares - v_shares,
      total_cost = round(average_cost * (shares - v_shares), 2),
      updated_at = v_traded_at
    where id = v_position.id;
  end if;

  update public.signal_alerts set
    status = 'sold', executed_at = v_traded_at, read_at = coalesce(read_at, v_traded_at)
  where id = v_alert_id and user_id = v_user_id;

  insert into public.audit_events (user_id, event_type, entity_type, entity_id, payload)
  values (v_user_id, 'cloud_position_sold', 'position_transaction', v_transaction_id::text, p_payload);
  return v_transaction_id;
end;
$$;

revoke all on function public.execute_cloud_position_buy(jsonb) from public, anon;
revoke all on function public.execute_cloud_position_sell(jsonb) from public, anon;
grant execute on function public.execute_cloud_position_buy(jsonb) to authenticated;
grant execute on function public.execute_cloud_position_sell(jsonb) to authenticated;
alter table public.watchlists
  add column if not exists metadata jsonb not null default '{"groups":[],"codeGroups":{}}'::jsonb;

create or replace function public.replace_cloud_watchlists(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_watchlist jsonb;
  v_code jsonb;
  v_watchlist_id uuid;
  v_source_id text;
  v_count integer := 0;
  v_item_count integer := 0;
begin
  if v_user_id is null then raise exception 'authentication is required'; end if;
  if p_payload is null or jsonb_typeof(coalesce(p_payload -> 'watchlists', '[]'::jsonb)) <> 'array' then
    raise exception 'watchlists array is required';
  end if;

  for v_watchlist in
    select value from jsonb_array_elements(coalesce(p_payload -> 'watchlists', '[]'::jsonb))
  loop
    v_source_id := nullif(trim(v_watchlist ->> 'source_id'), '');
    if v_source_id is null then raise exception 'watchlist source id is required'; end if;
    if nullif(trim(v_watchlist ->> 'name'), '') is null then raise exception 'watchlist name is required'; end if;
    if jsonb_typeof(coalesce(v_watchlist -> 'codes', '[]'::jsonb)) <> 'array' then
      raise exception 'watchlist codes must be an array';
    end if;

    insert into public.watchlists (
      user_id, name, source_id, metadata, created_at, updated_at
    ) values (
      v_user_id,
      v_watchlist ->> 'name',
      v_source_id,
      coalesce(v_watchlist -> 'metadata', '{"groups":[],"codeGroups":{}}'::jsonb),
      coalesce((v_watchlist ->> 'created_at')::timestamptz, now()),
      now()
    )
    on conflict (user_id, source_id) do update set
      name = excluded.name,
      metadata = excluded.metadata,
      updated_at = now()
    returning id into v_watchlist_id;

    delete from public.watchlist_items
    where user_id = v_user_id and watchlist_id = v_watchlist_id;

    for v_code in select value from jsonb_array_elements(coalesce(v_watchlist -> 'codes', '[]'::jsonb)) loop
      if trim(v_code #>> '{}') !~ '^[0-9]{6}$' then raise exception 'valid six digit code is required'; end if;
      insert into public.watchlist_items (
        user_id, watchlist_id, code, enabled, source_id, updated_at
      ) values (
        v_user_id, v_watchlist_id, trim(v_code #>> '{}'), true,
        v_source_id || ':' || trim(v_code #>> '{}'), now()
      );
      v_item_count := v_item_count + 1;
    end loop;
    v_count := v_count + 1;
  end loop;

  delete from public.watchlists existing
  where existing.user_id = v_user_id
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_payload -> 'watchlists', '[]'::jsonb)) supplied
      where supplied ->> 'source_id' = existing.source_id
    );

  insert into public.audit_events (user_id, event_type, entity_type, entity_id, payload)
  values (
    v_user_id, 'cloud_watchlists_replaced', 'watchlists', v_user_id::text,
    jsonb_build_object('watchlists', v_count, 'items', v_item_count)
  );
  return jsonb_build_object('watchlists', v_count, 'items', v_item_count);
end;
$$;

revoke all on function public.replace_cloud_watchlists(jsonb) from public, anon;
grant execute on function public.replace_cloud_watchlists(jsonb) to authenticated;
create or replace function public.mark_cloud_signal_alert_read(
  p_alert_id uuid,
  p_read_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_changed boolean := false;
begin
  if v_user_id is null then raise exception 'authentication is required'; end if;
  if p_alert_id is null or p_read_at is null then raise exception 'alert id and read time are required'; end if;

  update public.signal_alerts
  set read_at = coalesce(read_at, p_read_at)
  where id = p_alert_id and user_id = v_user_id
  returning true into v_changed;
  if not found then raise exception 'cloud signal alert was not found'; end if;

  insert into public.audit_events (user_id, event_type, entity_type, entity_id, payload)
  values (
    v_user_id, 'cloud_signal_alert_read', 'signal_alert', p_alert_id::text,
    jsonb_build_object('read_at', p_read_at)
  );
  return coalesce(v_changed, false);
end;
$$;

revoke all on function public.mark_cloud_signal_alert_read(uuid, timestamptz) from public, anon;
grant execute on function public.mark_cloud_signal_alert_read(uuid, timestamptz) to authenticated;
grant select on public.watchlist_items to service_role;
grant select on public.positions, public.position_lots to service_role;
grant select on public.virtual_positions, public.virtual_lots, public.virtual_cycles to service_role;
grant select on public.strategy_assignments to service_role;

grant select, insert, update on public.signal_states to service_role;
grant select, insert, update on public.signal_alerts to service_role;
grant insert on public.audit_events to service_role;

grant select, insert, update, delete on public.worker_leases to service_role;
grant select, insert, update on public.worker_heartbeats to service_role;
grant select, insert, update on public.scan_runs to service_role;
grant select, insert on public.market_data_failures to service_role;
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (user_id)
select users.id
from auth.users as users
on conflict (user_id) do nothing;

create table public.virtual_cash_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  initial_capital numeric(24, 2) not null default 200000
    check (initial_capital = 200000),
  cash_balance numeric(24, 2) not null default 200000
    check (cash_balance >= 0),
  reserved_cash numeric(24, 2) not null default 0
    check (reserved_cash >= 0 and reserved_cash <= cash_balance),
  version bigint not null default 0 check (version >= 0),
  requires_cleanup boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.virtual_cash_accounts (user_id, requires_cleanup)
select distinct user_id, true
from public.virtual_transactions
on conflict (user_id) do nothing;

alter table public.virtual_cash_accounts enable row level security;
create policy virtual_cash_accounts_owner
  on public.virtual_cash_accounts for select to authenticated
  using (auth.uid() = user_id);

grant select on public.virtual_cash_accounts to authenticated;
grant select, insert, update, delete on public.virtual_cash_accounts to service_role;

alter table public.virtual_transactions
  add column gross_amount numeric(24, 2) check (gross_amount >= 0),
  add column fee_amount numeric(24, 2) check (fee_amount >= 0),
  add column cash_delta numeric(24, 2),
  add column cash_balance_after numeric(24, 2) check (cash_balance_after >= 0),
  add column fee_profile_snapshot jsonb,
  add column fee_estimated boolean not null default true;

create or replace function public.calculate_virtual_trade_fees(
  p_action text,
  p_price numeric,
  p_shares integer,
  p_fee_profile jsonb,
  p_average_daily_amount numeric
)
returns table(gross_amount numeric, fee_amount numeric, normalized_profile jsonb)
language plpgsql
immutable
set search_path = public
as $$
declare
  v_profile jsonb := coalesce(p_fee_profile, '{}'::jsonb);
  v_commission_rate numeric := greatest(coalesce((v_profile ->> 'commissionRate')::numeric, 0.0003), 0);
  v_minimum_commission numeric := greatest(coalesce((v_profile ->> 'minimumCommission')::numeric, 5), 0);
  v_stamp_duty_rate numeric := greatest(coalesce((v_profile ->> 'sellStampDutyRate')::numeric, 0.0005), 0);
  v_transfer_fee_rate numeric := greatest(coalesce((v_profile ->> 'transferFeeRate')::numeric, 0.00001), 0);
  v_slippage_mode text := coalesce(v_profile ->> 'slippageMode', 'dynamic');
  v_fixed_slippage_rate numeric := greatest(coalesce((v_profile ->> 'fixedSlippageRate')::numeric, 0.0005), 0);
  v_average_daily_amount numeric;
  v_commission numeric;
  v_stamp_duty numeric;
  v_transfer_fee numeric;
  v_slippage_rate numeric;
  v_slippage numeric;
begin
  if p_action not in ('buy', 'sell') then raise exception 'invalid trade action'; end if;
  if coalesce(p_price, 0) <= 0 then raise exception 'positive price is required'; end if;
  if coalesce(p_shares, 0) <= 0 or p_shares % 100 <> 0 then
    raise exception 'virtual shares must be a positive board lot';
  end if;
  if v_commission_rate > 0.01 or v_minimum_commission > 100
     or v_stamp_duty_rate > 0.01 or v_transfer_fee_rate > 0.01
     or v_fixed_slippage_rate > 0.05 or v_slippage_mode not in ('fixed', 'dynamic') then
    raise exception 'invalid virtual fee profile';
  end if;

  gross_amount := round(p_price * p_shares, 2);
  v_average_daily_amount := greatest(coalesce(p_average_daily_amount, gross_amount * 1000), 1);
  v_commission := round(greatest(v_minimum_commission, gross_amount * v_commission_rate), 2);
  v_stamp_duty := case when p_action = 'sell'
    then round(gross_amount * v_stamp_duty_rate, 2) else 0 end;
  v_transfer_fee := round(gross_amount * v_transfer_fee_rate, 2);
  v_slippage_rate := case when v_slippage_mode = 'fixed'
    then v_fixed_slippage_rate
    else least(0.0002 + least(gross_amount / v_average_daily_amount, 1) * 0.0025, 0.003)
  end;
  v_slippage := round(gross_amount * v_slippage_rate, 2);
  fee_amount := round(v_commission + v_stamp_duty + v_transfer_fee + v_slippage, 2);
  normalized_profile := jsonb_build_object(
    'commissionRate', v_commission_rate,
    'minimumCommission', v_minimum_commission,
    'sellStampDutyRate', v_stamp_duty_rate,
    'transferFeeRate', v_transfer_fee_rate,
    'slippageMode', v_slippage_mode,
    'fixedSlippageRate', v_fixed_slippage_rate,
    'updatedAt', v_profile -> 'updatedAt'
  );
  return next;
end;
$$;

revoke all on function public.calculate_virtual_trade_fees(text, numeric, integer, jsonb, numeric)
  from public, anon, authenticated;

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
  v_execute_virtual boolean := coalesce((p_payload ->> 'virtual_execution_requested')::boolean, false);
  v_action text := p_payload ->> 'action';
  v_code text := p_payload ->> 'code';
  v_name text := p_payload ->> 'name';
  v_strategy_id text := p_payload ->> 'strategy_id';
  v_strategy_version text := p_payload ->> 'strategy_version';
  v_signal_at timestamptz := (p_payload ->> 'signal_at')::timestamptz;
  v_trading_date date;
  v_price numeric := (p_payload ->> 'price')::numeric;
  v_shares integer := coalesce((p_payload ->> 'suggested_shares')::integer, 0);
  v_cycle_id uuid;
  v_position public.virtual_positions%rowtype;
  v_position_id uuid;
  v_trade_id uuid;
  v_available integer := 0;
  v_available_after integer := 0;
  v_remaining integer;
  v_consumed integer;
  v_lot record;
  v_realized_profit numeric := 0;
  v_position_shares_after integer := 0;
  v_gross_amount numeric;
  v_fee_amount numeric;
  v_fee_profile jsonb;
  v_cash_delta numeric;
  v_cash_after numeric;
  v_cash_account public.virtual_cash_accounts%rowtype;
  v_cash_cost numeric;
  v_net_proceeds numeric;
begin
  if v_user_id is null then raise exception 'user_id is required'; end if;
  if coalesce(v_code, '') !~ '^[0-9]{6}$' then raise exception 'valid code is required'; end if;
  if coalesce(v_price, 0) <= 0 then raise exception 'positive price is required'; end if;
  if v_action not in ('buy', 'sell') then raise exception 'buy or sell action is required'; end if;
  if v_signal_at is null then raise exception 'signal_at is required'; end if;
  v_trading_date := (v_signal_at at time zone 'Asia/Shanghai')::date;

  insert into public.signal_states (
    user_id, code, strategy_id, strategy_version, buy_direction, sell_direction,
    buy_cycle_id, sell_cycle_id, pending_virtual_sell, updated_at
  ) values (
    v_user_id, v_code, v_strategy_id, v_strategy_version,
    coalesce(p_payload ->> 'buy_direction', 'hold'),
    coalesce(p_payload ->> 'sell_direction', 'hold'),
    p_payload ->> 'buy_cycle_id', p_payload ->> 'sell_cycle_id',
    p_payload -> 'pending_virtual_sell', v_signal_at
  ) on conflict (user_id, code, strategy_id) do update set
    strategy_version = excluded.strategy_version,
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
  ) values (
    v_user_id, v_code, v_name, v_price, v_action, p_payload ->> 'intent', v_shares,
    coalesce((p_payload ->> 'position_shares_at_signal')::integer, 0),
    coalesce((p_payload ->> 'available_shares_at_signal')::integer, 0),
    coalesce(p_payload -> 'reasons', '[]'::jsonb), coalesce(p_payload -> 'metrics', '{}'::jsonb),
    coalesce((p_payload ->> 'entry_price')::numeric, 0),
    coalesce((p_payload ->> 'stop_loss')::numeric, 0), v_signal_at,
    coalesce(p_payload ->> 'message_kind', 'cloud_signal'),
    coalesce(p_payload ->> 'virtual_tracking_status', 'pending'),
    null, null, 0, null, null, null,
    v_strategy_id, v_strategy_version, p_payload ->> 'cycle_id'
  ) on conflict (user_id, code, strategy_id, strategy_version, action, intent, cycle_id)
  do nothing returning id into v_alert_id;

  if v_alert_id is not null then
    v_created := true;
  else
    select id into v_alert_id from public.signal_alerts
    where user_id = v_user_id and code = v_code
      and strategy_id = v_strategy_id and strategy_version = v_strategy_version
      and action = v_action and intent = p_payload ->> 'intent'
      and cycle_id = p_payload ->> 'cycle_id';
  end if;
  if not v_created then return v_alert_id; end if;

  insert into public.audit_events (user_id, event_type, entity_type, entity_id, payload)
  values (v_user_id, 'signal_opened', 'signal_alert', v_alert_id::text, p_payload);

  if not v_execute_virtual then return v_alert_id; end if;
  if v_shares <= 0 or v_shares % 100 <> 0 then
    raise exception 'virtual shares must be a positive board lot';
  end if;

  select gross_amount, fee_amount, normalized_profile
  into v_gross_amount, v_fee_amount, v_fee_profile
  from public.calculate_virtual_trade_fees(
    v_action, v_price, v_shares, p_payload -> 'fee_profile',
    (p_payload ->> 'average_daily_amount')::numeric
  );

  insert into public.virtual_cash_accounts (user_id)
  values (v_user_id) on conflict (user_id) do nothing;
  select * into v_cash_account from public.virtual_cash_accounts
  where user_id = v_user_id for update;

  if v_cash_account.requires_cleanup then
    update public.signal_alerts set
      message_kind = 'virtual_blocked', virtual_tracking_status = 'blocked_cash',
      reasons = reasons || jsonb_build_array('virtual_capital_cleanup_required')
    where id = v_alert_id;
    return v_alert_id;
  end if;

  v_cash_cost := round(v_gross_amount + v_fee_amount, 2);
  v_net_proceeds := round(v_gross_amount - v_fee_amount, 2);
  if v_action = 'buy' and v_cash_account.cash_balance - v_cash_account.reserved_cash < v_cash_cost then
    update public.signal_alerts set
      message_kind = 'virtual_blocked', virtual_tracking_status = 'blocked_cash',
      reasons = reasons || jsonb_build_array(
        'virtual_cash_insufficient',
        'required_cash:' || v_cash_cost::text,
        'available_cash:' || round(v_cash_account.cash_balance - v_cash_account.reserved_cash, 2)::text,
        'cash_gap:' || round(v_cash_cost - (v_cash_account.cash_balance - v_cash_account.reserved_cash), 2)::text
      )
    where id = v_alert_id;
    insert into public.audit_events (user_id, event_type, entity_type, entity_id, payload)
    values (
      v_user_id, 'virtual_cash_insufficient', 'signal_alert', v_alert_id::text,
      jsonb_build_object(
        'required_cash', v_cash_cost,
        'available_cash', round(v_cash_account.cash_balance - v_cash_account.reserved_cash, 2),
        'code', v_code
      )
    );
    return v_alert_id;
  end if;

  select * into v_position from public.virtual_positions
  where user_id = v_user_id and strategy_id = v_strategy_id and code = v_code
  for update;

  if v_action = 'buy' then
    v_cash_delta := -v_cash_cost;
    v_cash_after := round(v_cash_account.cash_balance + v_cash_delta, 2);
    if not found then
      insert into public.virtual_cycles (
        user_id, source_id, strategy_id, strategy_version, code, name, opened_at
      ) values (
        v_user_id, 'cloud-cycle:' || v_alert_id::text, v_strategy_id,
        v_strategy_version, v_code, v_name, v_signal_at
      ) returning id into v_cycle_id;
      insert into public.virtual_positions (
        user_id, source_id, cycle_id, strategy_id, strategy_version, code, name,
        shares, average_cost, total_cost, opened_at, updated_at
      ) values (
        v_user_id, 'cloud-position:' || v_strategy_id || ':' || v_code, v_cycle_id,
        v_strategy_id, v_strategy_version, v_code, v_name, v_shares,
        round(v_cash_cost / v_shares, 6), v_cash_cost, v_signal_at, v_signal_at
      ) returning id into v_position_id;
      v_position_shares_after := v_shares;
    else
      v_cycle_id := v_position.cycle_id;
      v_position_id := v_position.id;
      v_position_shares_after := v_position.shares + v_shares;
      update public.virtual_positions set
        name = v_name, strategy_version = v_strategy_version,
        shares = v_position_shares_after,
        total_cost = round(v_position.total_cost + v_cash_cost, 2),
        average_cost = round((v_position.total_cost + v_cash_cost) / v_position_shares_after, 6),
        updated_at = v_signal_at
      where id = v_position.id;
    end if;

    insert into public.virtual_transactions (
      user_id, source_id, cycle_id, position_id, source_signal_id, strategy_id,
      strategy_version, code, name, transaction_type, shares, price, amount,
      gross_amount, fee_amount, cash_delta, cash_balance_after,
      fee_profile_snapshot, fee_estimated, realized_profit, traded_at, trading_date
    ) values (
      v_user_id, 'cloud-signal:' || v_alert_id::text, v_cycle_id, v_position_id,
      v_alert_id, v_strategy_id, v_strategy_version, v_code, v_name, 'buy',
      v_shares, v_price, v_gross_amount, v_gross_amount, v_fee_amount,
      v_cash_delta, v_cash_after, v_fee_profile, true, 0, v_signal_at, v_trading_date
    ) returning id into v_trade_id;
    insert into public.virtual_lots (
      user_id, source_id, position_id, source_signal_id, shares, remaining_shares,
      price, trading_date, bought_at
    ) values (
      v_user_id, 'cloud-signal:' || v_alert_id::text, v_position_id, v_alert_id,
      v_shares, v_shares, v_price, v_trading_date, v_signal_at
    );
    select coalesce(sum(remaining_shares), 0)::integer into v_available_after
    from public.virtual_lots where user_id = v_user_id and position_id = v_position_id
      and trading_date < v_trading_date and remaining_shares > 0;
  else
    if not found then
      update public.signal_alerts set virtual_tracking_status = 'actual_risk_only'
      where id = v_alert_id;
      return v_alert_id;
    end if;
    v_cycle_id := v_position.cycle_id;
    v_position_id := v_position.id;
    select coalesce(sum(remaining_shares), 0)::integer into v_available
    from public.virtual_lots where user_id = v_user_id and position_id = v_position.id
      and trading_date < v_trading_date and remaining_shares > 0;
    if v_shares > v_available then
      update public.signal_states set pending_virtual_sell = jsonb_build_object(
        'alertId', v_alert_id, 'cycleId', v_cycle_id,
        'executableOn', v_trading_date + 1, 'createdAt', v_signal_at,
        'desiredShares', v_shares, 'reasons', coalesce(p_payload -> 'reasons', '[]'::jsonb),
        'exitReason', coalesce(p_payload #>> '{metrics,exitReason}', 'signal')
      ) where user_id = v_user_id and code = v_code and strategy_id = v_strategy_id;
      update public.signal_alerts set
        message_kind = 'virtual_pending', virtual_tracking_status = 'pending_t1',
        virtual_cycle_id = v_cycle_id, virtual_shares = 0, virtual_price = v_price,
        virtual_position_shares_after = v_position.shares,
        virtual_available_shares_after = v_available
      where id = v_alert_id;
      return v_alert_id;
    end if;

    v_cash_delta := v_net_proceeds;
    v_cash_after := round(v_cash_account.cash_balance + v_cash_delta, 2);
    if v_cash_after < 0 then raise exception 'virtual_cash_invalid'; end if;
    v_remaining := v_shares;
    for v_lot in select id, remaining_shares from public.virtual_lots
      where user_id = v_user_id and position_id = v_position.id
        and trading_date < v_trading_date and remaining_shares > 0
      order by bought_at, id for update
    loop
      exit when v_remaining = 0;
      v_consumed := least(v_lot.remaining_shares, v_remaining);
      update public.virtual_lots set remaining_shares = remaining_shares - v_consumed
      where id = v_lot.id;
      v_remaining := v_remaining - v_consumed;
    end loop;
    v_realized_profit := round(v_net_proceeds - v_position.average_cost * v_shares, 2);
    v_position_shares_after := v_position.shares - v_shares;
    v_available_after := v_available - v_shares;
    insert into public.virtual_transactions (
      user_id, source_id, cycle_id, position_id, source_signal_id, strategy_id,
      strategy_version, code, name, transaction_type, shares, price, amount,
      gross_amount, fee_amount, cash_delta, cash_balance_after,
      fee_profile_snapshot, fee_estimated, realized_profit, traded_at, trading_date
    ) values (
      v_user_id, 'cloud-signal:' || v_alert_id::text, v_cycle_id, v_position.id,
      v_alert_id, v_strategy_id, v_strategy_version, v_code, v_name, 'sell',
      v_shares, v_price, v_gross_amount, v_gross_amount, v_fee_amount,
      v_cash_delta, v_cash_after, v_fee_profile, true, v_realized_profit,
      v_signal_at, v_trading_date
    ) returning id into v_trade_id;
    if v_position_shares_after = 0 then
      update public.virtual_cycles set closed_at = v_signal_at,
        realized_profit = realized_profit + v_realized_profit where id = v_cycle_id;
      delete from public.virtual_positions where id = v_position.id;
    else
      update public.virtual_cycles set realized_profit = realized_profit + v_realized_profit
      where id = v_cycle_id;
      update public.virtual_positions set shares = v_position_shares_after,
        total_cost = round(average_cost * v_position_shares_after, 2),
        updated_at = v_signal_at where id = v_position.id;
    end if;
    update public.signal_states set pending_virtual_sell = null
    where user_id = v_user_id and code = v_code and strategy_id = v_strategy_id;
  end if;

  update public.virtual_cash_accounts set
    cash_balance = v_cash_after, version = version + 1, updated_at = v_signal_at
  where user_id = v_user_id;
  update public.signal_alerts set
    message_kind = 'virtual_execution', virtual_tracking_status = 'executed',
    virtual_trade_id = v_trade_id, virtual_cycle_id = v_cycle_id,
    virtual_shares = v_shares, virtual_price = v_price,
    virtual_position_shares_after = v_position_shares_after,
    virtual_available_shares_after = v_available_after
  where id = v_alert_id;
  insert into public.audit_events (user_id, event_type, entity_type, entity_id, payload)
  values (
    v_user_id,
    case when v_action = 'buy' then 'virtual_position_bought' else 'virtual_position_sold' end,
    'virtual_transaction', v_trade_id::text,
    p_payload || jsonb_build_object(
      'gross_amount', v_gross_amount, 'fee_amount', v_fee_amount,
      'cash_delta', v_cash_delta, 'cash_balance_after', v_cash_after
    )
  );
  return v_alert_id;
end;
$$;

revoke all on function public.commit_signal_transition(jsonb) from public, anon, authenticated;
grant execute on function public.commit_signal_transition(jsonb) to service_role;

create table public.virtual_capital_cleanup_previews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_hash text not null check (snapshot_hash ~ '^[a-f0-9]{64}$'),
  snapshot_at timestamptz not null,
  original_transaction_count integer not null check (original_transaction_count >= 0),
  retained_transaction_ids uuid[] not null default '{}'::uuid[],
  removed_transaction_ids uuid[] not null default '{}'::uuid[],
  ending_cash numeric(24, 2) not null check (ending_cash >= 0),
  contains_estimated_fees boolean not null default false,
  expires_at timestamptz not null,
  applied_at timestamptz,
  created_at timestamptz not null default now()
);

create index virtual_capital_cleanup_previews_user_idx
  on public.virtual_capital_cleanup_previews (user_id, created_at desc);

alter table public.virtual_capital_cleanup_previews enable row level security;
create policy virtual_capital_cleanup_previews_owner
  on public.virtual_capital_cleanup_previews for select to authenticated
  using (auth.uid() = user_id);
grant select on public.virtual_capital_cleanup_previews to authenticated;
grant select, insert, update on public.virtual_capital_cleanup_previews to service_role;

create or replace function public.virtual_capital_snapshot_hash(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public, extensions
as $$
  select encode(digest(coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id,
      'cycle_id', cycle_id,
      'source_signal_id', source_signal_id,
      'strategy_id', strategy_id,
      'strategy_version', strategy_version,
      'code', code,
      'name', name,
      'transaction_type', transaction_type,
      'shares', shares,
      'price', price,
      'gross_amount', coalesce(gross_amount, amount),
      'fee_amount', coalesce(fee_amount, 0),
      'fee_profile_snapshot', coalesce(fee_profile_snapshot, '{}'::jsonb),
      'fee_estimated', fee_estimated,
      'traded_at', traded_at
    ) order by traded_at, id)::text
    from public.virtual_transactions where user_id = p_user_id
  ), '[]'), 'sha256'), 'hex');
$$;

revoke all on function public.virtual_capital_snapshot_hash(uuid)
  from public, anon, authenticated;

create or replace function public.preview_virtual_capital_cleanup()
returns table(
  preview_id uuid,
  snapshot_hash text,
  snapshot_at timestamptz,
  original_transaction_count integer,
  retained_transaction_count integer,
  removed_transaction_count integer,
  ending_cash numeric,
  contains_estimated_fees boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_cash numeric := 200000;
  v_retained uuid[] := '{}'::uuid[];
  v_removed uuid[] := '{}'::uuid[];
  v_tx record;
  v_lot record;
  v_required numeric;
  v_remaining integer;
  v_dependency_retained boolean;
  v_complete boolean;
  v_preview_id uuid;
  v_hash text;
  v_snapshot_at timestamptz;
  v_count integer;
  v_estimated boolean;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;

  create temporary table if not exists cleanup_replay_lots (
    seq bigserial primary key,
    cycle_id uuid not null,
    remaining_shares integer not null,
    retained boolean not null
  ) on commit drop;
  truncate cleanup_replay_lots restart identity;

  select public.virtual_capital_snapshot_hash(v_user_id),
    coalesce(max(traded_at), now()), count(*)::integer,
    coalesce(bool_or(fee_estimated or fee_amount is null), false)
  into v_hash, v_snapshot_at, v_count, v_estimated
  from public.virtual_transactions where user_id = v_user_id;

  for v_tx in
    select * from public.virtual_transactions
    where user_id = v_user_id order by traded_at, id
  loop
    if v_tx.transaction_type = 'buy' then
      v_required := round(coalesce(v_tx.gross_amount, v_tx.amount) + coalesce(v_tx.fee_amount, 0), 2);
      if v_cash >= v_required then
        v_cash := round(v_cash - v_required, 2);
        v_retained := array_append(v_retained, v_tx.id);
        insert into cleanup_replay_lots (cycle_id, remaining_shares, retained)
        values (v_tx.cycle_id, v_tx.shares, true);
      else
        v_removed := array_append(v_removed, v_tx.id);
        insert into cleanup_replay_lots (cycle_id, remaining_shares, retained)
        values (v_tx.cycle_id, v_tx.shares, false);
      end if;
    else
      v_remaining := v_tx.shares;
      v_dependency_retained := true;
      for v_lot in
        select * from cleanup_replay_lots
        where cycle_id = v_tx.cycle_id and remaining_shares > 0
        order by seq for update
      loop
        exit when v_remaining = 0;
        if not v_lot.retained then v_dependency_retained := false; end if;
        update cleanup_replay_lots set remaining_shares = remaining_shares
          - least(remaining_shares, v_remaining) where seq = v_lot.seq;
        v_remaining := v_remaining - least(v_lot.remaining_shares, v_remaining);
      end loop;
      v_complete := v_remaining = 0;
      if v_complete and v_dependency_retained then
        v_cash := round(v_cash + coalesce(v_tx.gross_amount, v_tx.amount)
          - coalesce(v_tx.fee_amount, 0), 2);
        if v_cash < 0 then raise exception 'virtual_cash_invalid'; end if;
        v_retained := array_append(v_retained, v_tx.id);
      else
        v_removed := array_append(v_removed, v_tx.id);
      end if;
    end if;
  end loop;

  insert into public.virtual_capital_cleanup_previews (
    user_id, snapshot_hash, snapshot_at, original_transaction_count,
    retained_transaction_ids, removed_transaction_ids, ending_cash,
    contains_estimated_fees, expires_at
  ) values (
    v_user_id, v_hash, v_snapshot_at, v_count, v_retained, v_removed,
    v_cash, v_estimated, now() + interval '30 minutes'
  ) returning id into v_preview_id;

  return query select v_preview_id, v_hash, v_snapshot_at, v_count,
    cardinality(v_retained), cardinality(v_removed), v_cash, v_estimated;
end;
$$;

create or replace function public.apply_virtual_capital_cleanup(
  p_preview_id uuid,
  p_snapshot_hash text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_preview public.virtual_capital_cleanup_previews%rowtype;
  v_current_hash text;
  v_tx record;
  v_position public.virtual_positions%rowtype;
  v_lot record;
  v_position_id uuid;
  v_remaining integer;
  v_consumed integer;
  v_gross numeric;
  v_fee numeric;
  v_cash numeric := 200000;
  v_cash_delta numeric;
  v_total_cost numeric;
  v_shares_after integer;
  v_realized numeric;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  select * into v_preview from public.virtual_capital_cleanup_previews
  where id = p_preview_id and user_id = v_user_id for update;
  if not found then raise exception 'virtual_capital_cleanup_preview_missing'; end if;
  if v_preview.applied_at is not null then raise exception 'virtual_capital_cleanup_preview_applied'; end if;
  if v_preview.expires_at <= now() then raise exception 'virtual_capital_cleanup_preview_expired'; end if;
  if v_preview.snapshot_hash <> p_snapshot_hash then
    raise exception 'virtual_capital_cleanup_snapshot_mismatch';
  end if;
  v_current_hash := public.virtual_capital_snapshot_hash(v_user_id);
  if v_current_hash <> v_preview.snapshot_hash then
    raise exception 'virtual_capital_cleanup_snapshot_stale';
  end if;

  update public.signal_alerts set
    virtual_trade_id = null,
    virtual_tracking_status = 'blocked_cash',
    message_kind = 'virtual_blocked',
    reasons = reasons || jsonb_build_array('removed_by_capital_cleanup')
  where user_id = v_user_id and virtual_trade_id = any(v_preview.removed_transaction_ids);

  delete from public.virtual_transactions
  where user_id = v_user_id and id = any(v_preview.removed_transaction_ids);
  delete from public.virtual_lots where user_id = v_user_id;
  delete from public.virtual_positions where user_id = v_user_id;
  delete from public.virtual_cycles c where c.user_id = v_user_id
    and not exists (select 1 from public.virtual_transactions t where t.cycle_id = c.id);
  update public.virtual_cycles set closed_at = null, realized_profit = 0
  where user_id = v_user_id;

  for v_tx in
    select * from public.virtual_transactions
    where user_id = v_user_id order by traded_at, id
  loop
    v_gross := round(coalesce(v_tx.gross_amount, v_tx.amount), 2);
    v_fee := round(coalesce(v_tx.fee_amount, 0), 2);
    if v_tx.transaction_type = 'buy' then
      v_cash_delta := -round(v_gross + v_fee, 2);
      v_cash := round(v_cash + v_cash_delta, 2);
      if v_cash < 0 then raise exception 'virtual_capital_cleanup_negative_cash'; end if;
      select * into v_position from public.virtual_positions
      where user_id = v_user_id and cycle_id = v_tx.cycle_id for update;
      if not found then
        insert into public.virtual_positions (
          user_id, source_id, cycle_id, strategy_id, strategy_version, code, name,
          shares, average_cost, total_cost, opened_at, updated_at
        ) values (
          v_user_id, 'cleanup-position:' || v_tx.cycle_id::text, v_tx.cycle_id,
          v_tx.strategy_id, v_tx.strategy_version, v_tx.code, v_tx.name,
          v_tx.shares, round((v_gross + v_fee) / v_tx.shares, 6),
          round(v_gross + v_fee, 2), v_tx.traded_at, v_tx.traded_at
        ) returning id into v_position_id;
      else
        v_position_id := v_position.id;
        v_total_cost := round(v_position.total_cost + v_gross + v_fee, 2);
        v_shares_after := v_position.shares + v_tx.shares;
        update public.virtual_positions set
          shares = v_shares_after, total_cost = v_total_cost,
          average_cost = round(v_total_cost / v_shares_after, 6),
          updated_at = v_tx.traded_at where id = v_position_id;
      end if;
      insert into public.virtual_lots (
        user_id, source_id, position_id, source_signal_id, shares, remaining_shares,
        price, trading_date, bought_at
      ) values (
        v_user_id, 'cleanup-lot:' || v_tx.id::text, v_position_id,
        v_tx.source_signal_id, v_tx.shares, v_tx.shares, v_tx.price,
        v_tx.trading_date, v_tx.traded_at
      );
      update public.virtual_transactions set
        position_id = v_position_id, gross_amount = v_gross, fee_amount = v_fee,
        cash_delta = v_cash_delta, cash_balance_after = v_cash
      where id = v_tx.id;
    else
      select * into strict v_position from public.virtual_positions
      where user_id = v_user_id and cycle_id = v_tx.cycle_id for update;
      v_remaining := v_tx.shares;
      for v_lot in
        select id, remaining_shares from public.virtual_lots
        where user_id = v_user_id and position_id = v_position.id and remaining_shares > 0
        order by bought_at, id for update
      loop
        exit when v_remaining = 0;
        v_consumed := least(v_lot.remaining_shares, v_remaining);
        update public.virtual_lots set remaining_shares = remaining_shares - v_consumed
        where id = v_lot.id;
        v_remaining := v_remaining - v_consumed;
      end loop;
      if v_remaining <> 0 then raise exception 'virtual_capital_cleanup_invalid_sell'; end if;
      v_cash_delta := round(v_gross - v_fee, 2);
      v_cash := round(v_cash + v_cash_delta, 2);
      v_realized := round(v_cash_delta - v_position.average_cost * v_tx.shares, 2);
      v_shares_after := v_position.shares - v_tx.shares;
      update public.virtual_transactions set
        position_id = v_position.id, gross_amount = v_gross, fee_amount = v_fee,
        cash_delta = v_cash_delta, cash_balance_after = v_cash,
        realized_profit = v_realized where id = v_tx.id;
      update public.virtual_cycles set realized_profit = realized_profit + v_realized,
        closed_at = case when v_shares_after = 0 then v_tx.traded_at else null end
      where id = v_tx.cycle_id;
      if v_shares_after = 0 then
        delete from public.virtual_positions where id = v_position.id;
      else
        update public.virtual_positions set shares = v_shares_after,
          total_cost = round(average_cost * v_shares_after, 2),
          updated_at = v_tx.traded_at where id = v_position.id;
      end if;
    end if;
  end loop;

  update public.virtual_cash_accounts set
    cash_balance = v_cash, reserved_cash = 0,
    version = cardinality(v_preview.retained_transaction_ids),
    requires_cleanup = false, updated_at = v_preview.snapshot_at
  where user_id = v_user_id;
  update public.virtual_capital_cleanup_previews set applied_at = now()
  where id = v_preview.id;
  insert into public.audit_events (user_id, event_type, entity_type, entity_id, payload)
  values (
    v_user_id, 'virtual_capital_cleanup_applied', 'virtual_cash_account', v_user_id::text,
    jsonb_build_object(
      'preview_id', v_preview.id, 'snapshot_hash', v_preview.snapshot_hash,
      'retained_count', cardinality(v_preview.retained_transaction_ids),
      'removed_count', cardinality(v_preview.removed_transaction_ids),
      'ending_cash', v_cash
    )
  );
end;
$$;

revoke all on function public.preview_virtual_capital_cleanup() from public, anon;
grant execute on function public.preview_virtual_capital_cleanup() to authenticated;
revoke all on function public.apply_virtual_capital_cleanup(uuid, text) from public, anon;
grant execute on function public.apply_virtual_capital_cleanup(uuid, text) to authenticated;
alter table public.t_trade_cycles
  add column position_scope text,
  add column virtual_position_id uuid references public.virtual_positions(id) on delete cascade;

update public.t_trade_cycles
set position_scope = 'actual'
where position_scope is null;

alter table public.t_trade_cycles
  alter column position_scope set default 'actual',
  alter column position_scope set not null,
  alter column position_id drop not null,
  add constraint t_trade_cycles_position_scope_check check (
    (
      position_scope = 'actual'
      and position_id is not null
      and virtual_position_id is null
    )
    or (
      position_scope = 'virtual'
      and position_id is null
      and virtual_position_id is not null
    )
  );

drop index public.t_trade_cycles_user_code_date_idx;
create index t_trade_cycles_user_scope_code_date_idx
  on public.t_trade_cycles (user_id, position_scope, code, trading_date);
create index t_trade_cycles_user_actual_position_status_idx
  on public.t_trade_cycles (user_id, position_id, status)
  where position_scope = 'actual';
create index t_trade_cycles_user_virtual_position_status_idx
  on public.t_trade_cycles (user_id, virtual_position_id, status)
  where position_scope = 'virtual';

create or replace function public.commit_t_trade_signal(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (p_payload ->> 'user_id')::uuid;
  v_position_scope text := coalesce(nullif(trim(p_payload ->> 'position_scope'), ''), 'actual');
  v_position_id uuid := nullif(p_payload ->> 'position_id', '')::uuid;
  v_virtual_position_id uuid := nullif(p_payload ->> 'virtual_position_id', '')::uuid;
  v_cycle_id uuid := nullif(p_payload ->> 't_trade_cycle_id', '')::uuid;
  v_code text := trim(coalesce(p_payload ->> 'code', ''));
  v_name text := trim(coalesce(p_payload ->> 'name', ''));
  v_price numeric := (p_payload ->> 'price')::numeric;
  v_signal_kind text := trim(coalesce(p_payload ->> 'signal_kind', ''));
  v_suggested_shares integer := coalesce((p_payload ->> 'suggested_shares')::integer, 0);
  v_strategy_id text := trim(coalesce(p_payload ->> 'strategy_id', ''));
  v_strategy_version text := trim(coalesce(p_payload ->> 'strategy_version', ''));
  v_trading_date date := (p_payload ->> 'trading_date')::date;
  v_signal_at timestamptz := (p_payload ->> 'signal_at')::timestamptz;
  v_key text;
  v_source_id text;
  v_alert_id uuid;
  v_existing boolean := false;
  v_action text;
  v_intent text;
  v_tracking_status text;
begin
  if v_user_id is null or not exists (select 1 from auth.users where id = v_user_id) then
    raise exception 'valid user is required';
  end if;
  if v_position_scope not in ('actual', 'virtual') then
    raise exception 'invalid T position scope';
  end if;
  if v_position_scope = 'actual' then
    if v_position_id is null or v_virtual_position_id is not null then
      raise exception 'actual T signal requires exactly one actual position';
    end if;
    if v_signal_kind not in (
      'actual_t_sell', 'actual_t_buyback', 'actual_t_expiry_risk', 'actual_t_risk_review'
    ) then
      raise exception 'invalid actual T signal kind';
    end if;
  else
    if v_position_id is not null or v_virtual_position_id is null then
      raise exception 'virtual T signal requires exactly one virtual position';
    end if;
    if not exists (
      select 1 from public.virtual_positions
      where id = v_virtual_position_id and user_id = v_user_id
    ) then
      raise exception 'virtual T position was not found for user';
    end if;
    if v_signal_kind not in (
      'virtual_t_sell', 'virtual_t_buyback', 'virtual_t_cash_blocked', 'virtual_t_expiry_risk'
    ) then
      raise exception 'invalid virtual T signal kind';
    end if;
  end if;
  if v_code !~ '^[0-9]{6}$' or v_name = '' then raise exception 'valid stock is required'; end if;
  if v_price <= 0 or v_signal_at is null or v_trading_date is null then
    raise exception 'valid signal price and time are required';
  end if;
  if v_suggested_shares < 0 or v_suggested_shares % 100 <> 0 then
    raise exception 'suggested shares must be a board lot';
  end if;
  if v_strategy_id = '' or v_strategy_version = '' then
    raise exception 'strategy identity is required';
  end if;
  if v_cycle_id is not null and not exists (
    select 1 from public.t_trade_cycles
    where id = v_cycle_id
      and user_id = v_user_id
      and position_scope = v_position_scope
      and (
        (v_position_scope = 'actual' and position_id = v_position_id)
        or (v_position_scope = 'virtual' and virtual_position_id = v_virtual_position_id)
      )
  ) then
    raise exception 'T cycle was not found for scoped position';
  end if;

  v_action := case
    when v_signal_kind in ('actual_t_sell', 'virtual_t_sell') then 'sell'
    else 'buy'
  end;
  v_intent := case when v_action = 'sell' then 'reduce' else 'add' end;
  v_tracking_status := case
    when v_position_scope = 'actual' then 'actual_risk_only'
    when v_signal_kind = 'virtual_t_cash_blocked' then 'blocked_cash'
    else 'legacy_untracked'
  end;
  v_key := concat_ws(
    ':', v_user_id::text, v_position_scope,
    coalesce(v_position_id::text, v_virtual_position_id::text),
    v_trading_date::text, v_strategy_version, v_signal_kind,
    coalesce(p_payload ->> 'edge_id', 'default')
  );
  v_source_id := v_position_scope || '-t:' || md5(v_key);

  select id into v_alert_id
  from public.signal_alerts
  where user_id = v_user_id and source_id = v_source_id
  for update;

  if v_alert_id is null then
    insert into public.signal_alerts (
      user_id, code, name, price, action, intent, suggested_shares,
      position_shares_at_signal, available_shares_at_signal, reasons, metrics,
      entry_price, stop_loss, signal_at, status, message_kind,
      virtual_tracking_status, strategy_id, strategy_version, cycle_id,
      source_id, signal_metadata, t_trade_cycle_id
    ) values (
      v_user_id, v_code, v_name, v_price, v_action, v_intent, v_suggested_shares,
      coalesce((p_payload ->> 'position_shares')::integer, 0),
      coalesce((p_payload ->> 'available_shares')::integer, 0),
      coalesce(p_payload -> 'reasons', '[]'::jsonb),
      coalesce(p_payload -> 'metrics', '{}'::jsonb),
      0, 0, v_signal_at, 'pending', v_signal_kind, v_tracking_status,
      v_strategy_id, v_strategy_version, v_source_id,
      v_source_id,
      jsonb_build_object(
        'position_scope', v_position_scope,
        'position_id', v_position_id,
        'virtual_position_id', v_virtual_position_id
      ) || coalesce(p_payload -> 'signal_metadata', '{}'::jsonb),
      v_cycle_id
    )
    returning id into v_alert_id;
  else
    v_existing := true;
    update public.signal_alerts set
      price = v_price,
      suggested_shares = v_suggested_shares,
      position_shares_at_signal = coalesce((p_payload ->> 'position_shares')::integer, 0),
      available_shares_at_signal = coalesce((p_payload ->> 'available_shares')::integer, 0),
      reasons = coalesce(p_payload -> 'reasons', reasons),
      metrics = coalesce(p_payload -> 'metrics', metrics),
      signal_at = v_signal_at,
      virtual_tracking_status = v_tracking_status,
      signal_metadata = jsonb_build_object(
        'position_scope', v_position_scope,
        'position_id', v_position_id,
        'virtual_position_id', v_virtual_position_id
      ) || coalesce(p_payload -> 'signal_metadata', signal_metadata),
      t_trade_cycle_id = v_cycle_id
    where id = v_alert_id and status = 'pending';
  end if;

  if not v_existing then
    insert into public.audit_events (user_id, event_type, entity_type, entity_id, payload)
    values (v_user_id, 't_trade_signal_created', 'signal_alert', v_alert_id::text, p_payload);
  end if;
  return v_alert_id;
end;
$$;
create or replace function public.commit_virtual_t_trade(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (p_payload ->> 'user_id')::uuid;
  v_position_id uuid := nullif(p_payload ->> 'virtual_position_id', '')::uuid;
  v_t_cycle_id uuid := nullif(p_payload ->> 't_trade_cycle_id', '')::uuid;
  v_signal_kind text := trim(coalesce(p_payload ->> 'signal_kind', ''));
  v_price numeric := (p_payload ->> 'price')::numeric;
  v_shares integer := coalesce((p_payload ->> 'suggested_shares')::integer, 0);
  v_signal_at timestamptz := (p_payload ->> 'signal_at')::timestamptz;
  v_trading_date date;
  v_alert_id uuid;
  v_trade_id uuid;
  v_position public.virtual_positions%rowtype;
  v_cycle public.t_trade_cycles%rowtype;
  v_cash public.virtual_cash_accounts%rowtype;
  v_base_cycle_id uuid;
  v_gross numeric;
  v_fees numeric;
  v_profile jsonb;
  v_cash_delta numeric;
  v_cash_after numeric;
  v_available integer;
  v_available_after integer;
  v_remaining integer;
  v_consumed integer;
  v_lot record;
  v_position_shares_after integer;
  v_total_cost numeric;
  v_sell_net numeric;
  v_realized_position_profit numeric;
  v_allocated_sell_fees numeric;
  v_t_profit numeric;
  v_remaining_buyback integer;
  v_metadata jsonb := coalesce(p_payload -> 'signal_metadata', '{}'::jsonb);
  v_expires_at timestamptz;
  v_buyback_price numeric;
  v_buyback_gross numeric;
  v_buyback_fees numeric;
  v_reserved_buyback_cash numeric := 0;
  v_cycle_reserved_cash numeric := 0;
  v_reserved_release numeric := 0;
  v_available_cash numeric := 0;
begin
  if coalesce(p_payload ->> 'position_scope', '') <> 'virtual' then
    raise exception 'virtual T trade requires virtual scope';
  end if;
  if v_signal_kind not in (
    'virtual_t_sell', 'virtual_t_buyback',
    'virtual_t_cash_blocked', 'virtual_t_expiry_risk'
  ) then
    raise exception 'invalid virtual T signal kind';
  end if;

  v_alert_id := public.commit_t_trade_signal(p_payload);
  if v_signal_kind in ('virtual_t_cash_blocked', 'virtual_t_expiry_risk') then
    return v_alert_id;
  end if;
  if exists (
    select 1 from public.virtual_transactions
    where user_id = v_user_id and source_id = 'virtual-t:' || v_alert_id::text
  ) then
    return v_alert_id;
  end if;
  if v_shares <= 0 or v_shares % 100 <> 0 then
    raise exception 'virtual T shares must be a positive board lot';
  end if;

  v_trading_date := (v_signal_at at time zone 'Asia/Shanghai')::date;
  select * into v_position from public.virtual_positions
  where id = v_position_id and user_id = v_user_id for update;
  if not found then raise exception 'virtual T position was not found for user'; end if;
  v_base_cycle_id := v_position.cycle_id;

  insert into public.virtual_cash_accounts (user_id)
  values (v_user_id) on conflict (user_id) do nothing;
  select * into v_cash from public.virtual_cash_accounts
  where user_id = v_user_id for update;
  if v_cash.requires_cleanup then raise exception 'virtual_capital_cleanup_required'; end if;

  select gross_amount, fee_amount, normalized_profile
  into v_gross, v_fees, v_profile
  from public.calculate_virtual_trade_fees(
    case when v_signal_kind = 'virtual_t_sell' then 'sell' else 'buy' end,
    v_price, v_shares, p_payload -> 'fee_profile',
    (p_payload ->> 'average_daily_amount')::numeric
  );

  if v_signal_kind = 'virtual_t_sell' then
    if v_t_cycle_id is not null then
      raise exception 'new virtual T sell cannot reuse a cycle';
    end if;
    if v_shares >= v_position.shares then
      raise exception 'virtual T sell must leave an open position';
    end if;
    select coalesce(sum(remaining_shares), 0)::integer into v_available
    from public.virtual_lots
    where user_id = v_user_id and position_id = v_position.id
      and trading_date < v_trading_date and remaining_shares > 0;
    if v_shares > v_available then
      update public.signal_alerts set
        virtual_tracking_status = 'blocked_t1',
        reasons = reasons || jsonb_build_array('virtual_t1_insufficient')
      where id = v_alert_id;
      return v_alert_id;
    end if;

    v_remaining := v_shares;
    v_buyback_price := coalesce(nullif(v_metadata ->> 'buyback_high', '')::numeric, v_price);
    select gross_amount, fee_amount
    into v_buyback_gross, v_buyback_fees
    from public.calculate_virtual_trade_fees(
      'buy', v_buyback_price, v_shares, p_payload -> 'fee_profile',
      (p_payload ->> 'average_daily_amount')::numeric
    );
    v_reserved_buyback_cash := round(v_buyback_gross + v_buyback_fees, 2);
    v_sell_net := round(v_gross - v_fees, 2);
    v_available_cash := round(
      v_cash.cash_balance - v_cash.reserved_cash + v_sell_net, 2
    );
    if v_reserved_buyback_cash > v_available_cash then
      update public.signal_alerts set
        message_kind = 'virtual_t_cash_blocked',
        virtual_tracking_status = 'blocked_cash',
        reasons = reasons || jsonb_build_array('virtual_cash_insufficient'),
        signal_metadata = signal_metadata || jsonb_build_object(
          'required_cash', v_reserved_buyback_cash,
          'available_cash', v_available_cash,
          'cash_gap', round(v_reserved_buyback_cash - v_available_cash, 2)
        )
      where id = v_alert_id;
      return v_alert_id;
    end if;

    for v_lot in
      select id, remaining_shares from public.virtual_lots
      where user_id = v_user_id and position_id = v_position.id
        and trading_date < v_trading_date and remaining_shares > 0
      order by bought_at, id for update
    loop
      exit when v_remaining = 0;
      v_consumed := least(v_lot.remaining_shares, v_remaining);
      update public.virtual_lots
      set remaining_shares = remaining_shares - v_consumed
      where id = v_lot.id;
      v_remaining := v_remaining - v_consumed;
    end loop;
    if v_remaining <> 0 then raise exception 'virtual T lot consumption failed'; end if;

    v_sell_net := round(v_gross - v_fees, 2);
    v_cash_delta := v_sell_net;
    v_cash_after := round(v_cash.cash_balance + v_cash_delta, 2);
    v_position_shares_after := v_position.shares - v_shares;
    v_available_after := v_available - v_shares;
    v_realized_position_profit := round(v_sell_net - v_position.average_cost * v_shares, 2);

    insert into public.virtual_transactions (
      user_id, source_id, cycle_id, position_id, source_signal_id,
      strategy_id, strategy_version, code, name, transaction_type,
      shares, price, amount, gross_amount, fee_amount, cash_delta,
      cash_balance_after, fee_profile_snapshot, fee_estimated,
      realized_profit, traded_at, trading_date
    ) values (
      v_user_id, 'virtual-t:' || v_alert_id::text, v_base_cycle_id,
      v_position.id, v_alert_id, v_position.strategy_id,
      v_position.strategy_version, v_position.code, v_position.name, 'sell',
      v_shares, v_price, v_gross, v_gross, v_fees, v_cash_delta,
      v_cash_after, v_profile, true, v_realized_position_profit,
      v_signal_at, v_trading_date
    ) returning id into v_trade_id;

    update public.virtual_positions set
      shares = v_position_shares_after,
      total_cost = round(average_cost * v_position_shares_after, 2),
      updated_at = v_signal_at
    where id = v_position.id;
    update public.virtual_cycles set
      realized_profit = realized_profit + v_realized_position_profit
    where id = v_base_cycle_id;

    v_expires_at := coalesce(
      nullif(p_payload ->> 'expires_at', '')::timestamptz,
      nullif(v_metadata ->> 'expires_at', '')::timestamptz,
      (v_trading_date::text || 'T07:00:00Z')::timestamptz
    );
    insert into public.t_trade_cycles (
      user_id, position_scope, virtual_position_id, code, name,
      cycle_type, status, pre_cycle_average_cost, pre_cycle_total_shares,
      suggested_sell_low, suggested_sell_high, suggested_sell_shares,
      sold_shares, actual_sell_price, actual_sell_fees, actual_sell_at,
      suggested_buyback_low, suggested_buyback_high,
      remaining_buyback_shares, expected_net_profit,
      fee_profile_snapshot, signal_basis_snapshot,
      strategy_id, strategy_version, trading_date, expires_at
    ) values (
      v_user_id, 'virtual', v_position.id, v_position.code, v_position.name,
      case when v_metadata ->> 'cycle_type' = 'cost_reduction_t'
        then 'cost_reduction_t' else 'profit_t' end,
      'buyback_monitoring', v_position.average_cost, v_position.shares,
      nullif(v_metadata ->> 'sell_low', '')::numeric,
      nullif(v_metadata ->> 'sell_high', '')::numeric,
      v_shares, v_shares, v_price, v_fees, v_signal_at,
      nullif(v_metadata ->> 'buyback_low', '')::numeric,
      nullif(v_metadata ->> 'buyback_high', '')::numeric,
      v_shares, coalesce((v_metadata ->> 'expected_net_profit')::numeric, 0),
      v_profile, v_metadata || jsonb_build_object('reserved_buyback_cash', v_reserved_buyback_cash),
      coalesce(nullif(p_payload ->> 'strategy_id', ''), 'virtual-t'),
      coalesce(nullif(p_payload ->> 'strategy_version', ''), '1'),
      v_trading_date, v_expires_at
    ) returning id into v_t_cycle_id;

    update public.virtual_cash_accounts set
      cash_balance = v_cash_after,
      reserved_cash = round(v_cash.reserved_cash + v_reserved_buyback_cash, 2),
      version = version + 1, updated_at = v_signal_at
    where user_id = v_user_id;
    update public.signal_alerts set
      status = 'sold', executed_at = v_signal_at,
      message_kind = 'virtual_t_sell', virtual_tracking_status = 'executed',
      virtual_trade_id = v_trade_id, virtual_cycle_id = v_base_cycle_id,
      virtual_shares = v_shares, virtual_price = v_price,
      virtual_position_shares_after = v_position_shares_after,
      virtual_available_shares_after = v_available_after,
      t_trade_cycle_id = v_t_cycle_id
    where id = v_alert_id;
  else
    select * into v_cycle from public.t_trade_cycles
    where id = v_t_cycle_id and user_id = v_user_id
      and position_scope = 'virtual'
      and virtual_position_id = v_position.id
    for update;
    if not found then raise exception 'virtual T buyback cycle was not found'; end if;
    if v_cycle.status not in (
      'buyback_monitoring', 'buyback_signal_pending',
      'partially_bought_back', 'buyback_paused_risk_review'
    ) then
      raise exception 'virtual T cycle is not open for buyback';
    end if;
    if v_shares > v_cycle.remaining_buyback_shares then
      raise exception 'virtual T buyback exceeds remaining shares';
    end if;

    v_cash_delta := -round(v_gross + v_fees, 2);
    v_cycle_reserved_cash := coalesce((v_cycle.signal_basis_snapshot ->> 'reserved_buyback_cash')::numeric, 0);
    v_available_cash := round(
      v_cash.cash_balance - v_cash.reserved_cash + v_cycle_reserved_cash, 2
    );

    v_cash_after := round(v_cash.cash_balance + v_cash_delta, 2);
    if abs(v_cash_delta) > v_available_cash then
      update public.signal_alerts set
        message_kind = 'virtual_t_cash_blocked',
        virtual_tracking_status = 'blocked_cash',
        reasons = reasons || jsonb_build_array(
          'virtual_cash_insufficient',
          'required_cash:' || abs(v_cash_delta)::text,
          'available_cash:' || v_available_cash::text,
          'cash_gap:' || round(abs(v_cash_delta) - v_available_cash, 2)::text
        ),
        signal_metadata = signal_metadata || jsonb_build_object(
          'required_cash', abs(v_cash_delta),
          'available_cash', v_available_cash,
          'cash_gap', round(abs(v_cash_delta) - v_available_cash, 2),
          'remaining_buyback_shares', v_cycle.remaining_buyback_shares
        )
      where id = v_alert_id;
      return v_alert_id;
    end if;

    v_total_cost := round(v_position.total_cost + abs(v_cash_delta), 2);
    v_position_shares_after := v_position.shares + v_shares;
    update public.virtual_positions set
      shares = v_position_shares_after,
      total_cost = v_total_cost,
      average_cost = round(v_total_cost / v_position_shares_after, 6),
      updated_at = v_signal_at
    where id = v_position.id;

    insert into public.virtual_lots (
      user_id, source_id, position_id, source_signal_id,
      shares, remaining_shares, price, trading_date, bought_at
    ) values (
      v_user_id, 'virtual-t:' || v_alert_id::text, v_position.id, v_alert_id,
      v_shares, v_shares, v_price, v_trading_date, v_signal_at
    );
    insert into public.virtual_transactions (
      user_id, source_id, cycle_id, position_id, source_signal_id,
      strategy_id, strategy_version, code, name, transaction_type,
      shares, price, amount, gross_amount, fee_amount, cash_delta,
      cash_balance_after, fee_profile_snapshot, fee_estimated,
      realized_profit, traded_at, trading_date
    ) values (
      v_user_id, 'virtual-t:' || v_alert_id::text, v_base_cycle_id,
      v_position.id, v_alert_id, v_position.strategy_id,
      v_position.strategy_version, v_position.code, v_position.name, 'buy',
      v_shares, v_price, v_gross, v_gross, v_fees, v_cash_delta,
      v_cash_after, v_profile, true, 0, v_signal_at, v_trading_date
    ) returning id into v_trade_id;

    v_allocated_sell_fees := round(
      v_cycle.actual_sell_fees * v_shares / v_cycle.sold_shares, 2
    );
    v_t_profit := round(
      v_cycle.actual_sell_price * v_shares
      - v_allocated_sell_fees - v_gross - v_fees, 2
    );
    v_remaining_buyback := v_cycle.remaining_buyback_shares - v_shares;
    v_reserved_release := case when v_cycle.remaining_buyback_shares > 0
      then round(v_cycle_reserved_cash * v_shares / v_cycle.remaining_buyback_shares, 2)
      else 0 end;

    update public.t_trade_cycles set
      status = case when v_remaining_buyback = 0
        then 'completed' else 'partially_bought_back' end,
      bought_back_shares = bought_back_shares + v_shares,
      remaining_buyback_shares = v_remaining_buyback,
      actual_buyback_amount = actual_buyback_amount + v_gross,
      actual_buyback_fees = actual_buyback_fees + v_fees,
      realized_t_profit = realized_t_profit + v_t_profit,
      resolved_at = case when v_remaining_buyback = 0 then v_signal_at else null end,
      updated_at = v_signal_at,
      signal_basis_snapshot = jsonb_set(
        signal_basis_snapshot, '{reserved_buyback_cash}',
        to_jsonb(greatest(0, v_cycle_reserved_cash - v_reserved_release))
      )
    where id = v_cycle.id;

    update public.virtual_cash_accounts set
      cash_balance = v_cash_after,
      reserved_cash = greatest(0, round(v_cash.reserved_cash - v_reserved_release, 2)),
      version = version + 1, updated_at = v_signal_at
    where user_id = v_user_id;
    select coalesce(sum(remaining_shares), 0)::integer into v_available_after
    from public.virtual_lots
    where user_id = v_user_id and position_id = v_position.id
      and trading_date < v_trading_date and remaining_shares > 0;
    update public.signal_alerts set
      status = 'bought', executed_at = v_signal_at,
      message_kind = 'virtual_t_buyback', virtual_tracking_status = 'executed',
      virtual_trade_id = v_trade_id, virtual_cycle_id = v_base_cycle_id,
      virtual_shares = v_shares, virtual_price = v_price,
      virtual_position_shares_after = v_position_shares_after,
      virtual_available_shares_after = v_available_after,
      t_trade_cycle_id = v_cycle.id
    where id = v_alert_id;
  end if;

  insert into public.audit_events (user_id, event_type, entity_type, entity_id, payload)
  values (
    v_user_id,
    case when v_signal_kind = 'virtual_t_sell'
      then 'virtual_t_sell_executed' else 'virtual_t_buyback_executed' end,
    'virtual_transaction', v_trade_id::text,
    p_payload || jsonb_build_object(
      'gross_amount', v_gross, 'fee_amount', v_fees,
      'cash_delta', v_cash_delta, 'cash_balance_after', v_cash_after,
      't_trade_cycle_id', v_t_cycle_id
    )
  );
  return v_alert_id;
end;
$$;

revoke all on function public.commit_virtual_t_trade(jsonb)
  from public, anon, authenticated;
grant execute on function public.commit_virtual_t_trade(jsonb) to service_role;
create or replace function public.expire_t_trade_cycles(p_as_of timestamptz)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_release record;
begin
  for v_release in
    select
      user_id,
      sum(coalesce((signal_basis_snapshot ->> 'reserved_buyback_cash')::numeric, 0)) as amount
    from public.t_trade_cycles
    where expires_at <= p_as_of
      and position_scope = 'virtual'
      and remaining_buyback_shares > 0
      and status in (
        'buyback_monitoring', 'buyback_signal_pending',
        'partially_bought_back', 'buyback_paused_risk_review'
      )
    group by user_id
  loop
    update public.virtual_cash_accounts set
      reserved_cash = greatest(0, round(reserved_cash - v_release.amount, 2)),
      version = version + 1,
      updated_at = now()
    where user_id = v_release.user_id;
  end loop;

  update public.t_trade_cycles set
    status = 'expired_unfilled',
    signal_basis_snapshot = case when position_scope = 'virtual'
      then jsonb_set(signal_basis_snapshot, '{reserved_buyback_cash}', '0'::jsonb)
      else signal_basis_snapshot end,
    updated_at = now()
  where expires_at <= p_as_of
    and remaining_buyback_shares > 0
    and status in (
      'buyback_monitoring', 'buyback_signal_pending',
      'partially_bought_back', 'buyback_paused_risk_review'
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.expire_t_trade_cycles(timestamptz)
  from public, anon, authenticated;
grant execute on function public.expire_t_trade_cycles(timestamptz) to service_role;
