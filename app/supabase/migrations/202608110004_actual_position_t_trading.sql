create table public.trading_fee_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  commission_rate numeric(12, 8) not null default 0.0003 check (commission_rate >= 0),
  minimum_commission numeric(20, 2) not null default 5 check (minimum_commission >= 0),
  sell_stamp_duty_rate numeric(12, 8) not null default 0.0005 check (sell_stamp_duty_rate >= 0),
  transfer_fee_rate numeric(12, 8) not null default 0.00001 check (transfer_fee_rate >= 0),
  slippage_mode text not null default 'dynamic' check (slippage_mode in ('dynamic', 'fixed')),
  fixed_slippage_rate numeric(12, 8) not null default 0.0005 check (fixed_slippage_rate >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.t_trade_cycles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  position_id uuid not null,
  code text not null check (code ~ '^[0-9]{6}$'),
  name text not null,
  cycle_type text not null check (cycle_type in ('profit_t', 'cost_reduction_t')),
  status text not null check (status in (
    'sell_executed', 'buyback_monitoring', 'buyback_signal_pending',
    'partially_bought_back', 'completed', 'buyback_paused_risk_review',
    'expired_unfilled', 'kept_as_reduction', 'cancelled_by_user'
  )),
  pre_cycle_average_cost numeric(20, 6) not null check (pre_cycle_average_cost >= 0),
  pre_cycle_total_shares integer not null check (
    pre_cycle_total_shares > 0 and pre_cycle_total_shares % 100 = 0
  ),
  suggested_sell_low numeric(20, 6),
  suggested_sell_high numeric(20, 6),
  suggested_sell_shares integer check (
    suggested_sell_shares is null
    or (suggested_sell_shares > 0 and suggested_sell_shares % 100 = 0)
  ),
  sold_shares integer not null check (sold_shares > 0 and sold_shares % 100 = 0),
  actual_sell_price numeric(20, 6),
  actual_sell_fees numeric(24, 2) not null default 0 check (actual_sell_fees >= 0),
  actual_sell_at timestamptz,
  suggested_buyback_low numeric(20, 6),
  suggested_buyback_high numeric(20, 6),
  bought_back_shares integer not null default 0 check (
    bought_back_shares >= 0 and bought_back_shares % 100 = 0
  ),
  remaining_buyback_shares integer not null check (
    remaining_buyback_shares >= 0 and remaining_buyback_shares % 100 = 0
  ),
  kept_as_reduction_shares integer not null default 0 check (
    kept_as_reduction_shares >= 0 and kept_as_reduction_shares % 100 = 0
  ),
  actual_buyback_amount numeric(24, 2) not null default 0 check (actual_buyback_amount >= 0),
  actual_buyback_fees numeric(24, 2) not null default 0 check (actual_buyback_fees >= 0),
  expected_net_profit numeric(24, 2) not null default 0,
  realized_t_profit numeric(24, 2) not null default 0,
  cost_reduction_per_share numeric(20, 8) not null default 0,
  adjusted_average_cost numeric(20, 8),
  fee_profile_snapshot jsonb not null default '{}'::jsonb,
  signal_basis_snapshot jsonb not null default '{}'::jsonb,
  strategy_id text not null,
  strategy_version text not null,
  trading_date date not null,
  expires_at timestamptz not null,
  expiry_risk_sent_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  check (bought_back_shares + remaining_buyback_shares + kept_as_reduction_shares = sold_shares)
);

create table public.t_trade_executions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cycle_id uuid not null,
  position_id uuid not null,
  source_alert_id uuid references public.signal_alerts(id) on delete set null,
  side text not null check (side in ('sell', 'buyback')),
  price numeric(20, 6) not null check (price > 0),
  shares integer not null check (shares > 0 and shares % 100 = 0),
  total_fees numeric(24, 2) not null check (total_fees >= 0),
  fee_breakdown jsonb not null default '{}'::jsonb,
  executed_at timestamptz not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  foreign key (cycle_id, user_id)
    references public.t_trade_cycles(id, user_id) on delete cascade
);

alter table public.signal_alerts
  add column signal_metadata jsonb not null default '{}'::jsonb,
  add column t_trade_cycle_id uuid references public.t_trade_cycles(id) on delete set null;

create index t_trade_cycles_user_status_idx
  on public.t_trade_cycles (user_id, status);
create index t_trade_cycles_user_code_date_idx
  on public.t_trade_cycles (user_id, code, trading_date);
create index t_trade_executions_user_cycle_time_idx
  on public.t_trade_executions (user_id, cycle_id, executed_at);
create index signal_alerts_t_trade_cycle_idx
  on public.signal_alerts (user_id, t_trade_cycle_id)
  where t_trade_cycle_id is not null;

alter table public.trading_fee_profiles enable row level security;
alter table public.t_trade_cycles enable row level security;
alter table public.t_trade_executions enable row level security;

create policy trading_fee_profiles_owner
  on public.trading_fee_profiles for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy t_trade_cycles_owner
  on public.t_trade_cycles for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy t_trade_executions_owner
  on public.t_trade_executions for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select on public.trading_fee_profiles to authenticated;
grant select on public.t_trade_cycles, public.t_trade_executions to authenticated;

grant select on public.trading_fee_profiles to service_role;
grant select on public.t_trade_cycles, public.t_trade_executions to service_role;

create or replace function public.get_effective_trading_fee_profile()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'commission_rate', coalesce(profile.commission_rate, 0.0003),
    'minimum_commission', coalesce(profile.minimum_commission, 5),
    'sell_stamp_duty_rate', coalesce(profile.sell_stamp_duty_rate, 0.0005),
    'transfer_fee_rate', coalesce(profile.transfer_fee_rate, 0.00001),
    'slippage_mode', coalesce(profile.slippage_mode, 'dynamic'),
    'fixed_slippage_rate', coalesce(profile.fixed_slippage_rate, 0.0005),
    'updated_at', profile.updated_at
  )
  from (select auth.uid() as user_id) context
  left join public.trading_fee_profiles profile on profile.user_id = context.user_id
$$;

create or replace function public.upsert_trading_fee_profile(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_commission_rate numeric := (p_payload ->> 'commission_rate')::numeric;
  v_minimum_commission numeric := (p_payload ->> 'minimum_commission')::numeric;
  v_stamp_duty_rate numeric := (p_payload ->> 'sell_stamp_duty_rate')::numeric;
  v_transfer_fee_rate numeric := (p_payload ->> 'transfer_fee_rate')::numeric;
  v_slippage_mode text := trim(coalesce(p_payload ->> 'slippage_mode', ''));
  v_fixed_slippage_rate numeric := (p_payload ->> 'fixed_slippage_rate')::numeric;
begin
  if v_user_id is null then raise exception 'authentication is required'; end if;
  if v_commission_rate < 0 or v_minimum_commission < 0
    or v_stamp_duty_rate < 0 or v_transfer_fee_rate < 0
    or v_fixed_slippage_rate < 0 then
    raise exception 'fee values must be non-negative';
  end if;
  if v_slippage_mode not in ('dynamic', 'fixed') then
    raise exception 'invalid slippage mode';
  end if;

  insert into public.trading_fee_profiles (
    user_id, commission_rate, minimum_commission, sell_stamp_duty_rate,
    transfer_fee_rate, slippage_mode, fixed_slippage_rate, updated_at
  ) values (
    v_user_id, v_commission_rate, v_minimum_commission, v_stamp_duty_rate,
    v_transfer_fee_rate, v_slippage_mode, v_fixed_slippage_rate, now()
  )
  on conflict (user_id) do update set
    commission_rate = excluded.commission_rate,
    minimum_commission = excluded.minimum_commission,
    sell_stamp_duty_rate = excluded.sell_stamp_duty_rate,
    transfer_fee_rate = excluded.transfer_fee_rate,
    slippage_mode = excluded.slippage_mode,
    fixed_slippage_rate = excluded.fixed_slippage_rate,
    updated_at = now();

  insert into public.audit_events (user_id, event_type, entity_type, entity_id, payload)
  values (
    v_user_id, 'trading_fee_profile_updated', 'trading_fee_profile',
    v_user_id::text, p_payload
  );

  return public.get_effective_trading_fee_profile();
end;
$$;

create or replace function public.commit_t_trade_signal(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (p_payload ->> 'user_id')::uuid;
  v_position_id uuid := (p_payload ->> 'position_id')::uuid;
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
begin
  if v_user_id is null or not exists (select 1 from auth.users where id = v_user_id) then
    raise exception 'valid user is required';
  end if;
  if v_code !~ '^[0-9]{6}$' or v_name = '' then raise exception 'valid stock is required'; end if;
  if v_price <= 0 or v_signal_at is null or v_trading_date is null then
    raise exception 'valid signal price and time are required';
  end if;
  if v_suggested_shares < 0 or v_suggested_shares % 100 <> 0 then
    raise exception 'suggested shares must be a board lot';
  end if;
  if v_signal_kind not in (
    'actual_t_sell', 'actual_t_buyback', 'actual_t_expiry_risk', 'actual_t_risk_review'
  ) then
    raise exception 'invalid T signal kind';
  end if;
  if v_strategy_id = '' or v_strategy_version = '' then
    raise exception 'strategy identity is required';
  end if;
  if v_cycle_id is not null and not exists (
    select 1 from public.t_trade_cycles
    where id = v_cycle_id and user_id = v_user_id
  ) then
    raise exception 'T cycle was not found for user';
  end if;

  v_action := case when v_signal_kind = 'actual_t_sell' then 'sell' else 'buy' end;
  v_intent := case when v_signal_kind = 'actual_t_sell' then 'reduce' else 'add' end;
  v_key := concat_ws(
    ':', v_user_id::text, v_position_id::text, v_trading_date::text,
    v_strategy_version, v_signal_kind, coalesce(p_payload ->> 'edge_id', 'default')
  );
  v_source_id := 'actual-t:' || md5(v_key);

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
      0, 0, v_signal_at, 'pending', v_signal_kind, 'actual_risk_only',
      v_strategy_id, v_strategy_version, v_source_id,
      v_source_id, coalesce(p_payload -> 'signal_metadata', '{}'::jsonb), v_cycle_id
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
      signal_metadata = coalesce(p_payload -> 'signal_metadata', signal_metadata),
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

revoke all on function public.get_effective_trading_fee_profile() from public, anon;
revoke all on function public.upsert_trading_fee_profile(jsonb) from public, anon;
revoke all on function public.commit_t_trade_signal(jsonb) from public, anon, authenticated;

grant execute on function public.get_effective_trading_fee_profile() to authenticated;
grant execute on function public.upsert_trading_fee_profile(jsonb) to authenticated;
grant execute on function public.commit_t_trade_signal(jsonb) to service_role;
