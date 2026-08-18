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
