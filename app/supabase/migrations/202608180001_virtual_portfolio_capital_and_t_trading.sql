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
  if v_action = 'buy' and v_cash_account.cash_balance < v_cash_cost then
    update public.signal_alerts set
      message_kind = 'virtual_blocked', virtual_tracking_status = 'blocked_cash',
      reasons = reasons || jsonb_build_array(
        'virtual_cash_insufficient',
        'required_cash:' || v_cash_cost::text,
        'available_cash:' || v_cash_account.cash_balance::text,
        'cash_gap:' || round(v_cash_cost - v_cash_account.cash_balance, 2)::text
      )
    where id = v_alert_id;
    insert into public.audit_events (user_id, event_type, entity_type, entity_id, payload)
    values (
      v_user_id, 'virtual_cash_insufficient', 'signal_alert', v_alert_id::text,
      jsonb_build_object(
        'required_cash', v_cash_cost,
        'available_cash', v_cash_account.cash_balance,
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
