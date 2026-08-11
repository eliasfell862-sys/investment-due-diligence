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
  )
  values (
    v_user_id, v_code, v_strategy_id, v_strategy_version,
    coalesce(p_payload ->> 'buy_direction', 'hold'),
    coalesce(p_payload ->> 'sell_direction', 'hold'),
    p_payload ->> 'buy_cycle_id', p_payload ->> 'sell_cycle_id',
    p_payload -> 'pending_virtual_sell', v_signal_at
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
    v_user_id, v_code, v_name, v_price, v_action, p_payload ->> 'intent', v_shares,
    coalesce((p_payload ->> 'position_shares_at_signal')::integer, 0),
    coalesce((p_payload ->> 'available_shares_at_signal')::integer, 0),
    coalesce(p_payload -> 'reasons', '[]'::jsonb), coalesce(p_payload -> 'metrics', '{}'::jsonb),
    coalesce((p_payload ->> 'entry_price')::numeric, 0),
    coalesce((p_payload ->> 'stop_loss')::numeric, 0), v_signal_at,
    p_payload ->> 'message_kind', p_payload ->> 'virtual_tracking_status',
    null, null, 0, null, null, null,
    v_strategy_id, v_strategy_version, p_payload ->> 'cycle_id'
  )
  on conflict (user_id, code, strategy_id, strategy_version, action, intent, cycle_id)
  do nothing
  returning id into v_alert_id;

  if v_alert_id is not null then
    v_created := true;
  else
    select id into v_alert_id
    from public.signal_alerts
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

  select * into v_position
  from public.virtual_positions
  where user_id = v_user_id and strategy_id = v_strategy_id and code = v_code
  for update;

  if v_action = 'buy' then
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
        v_strategy_id, v_strategy_version, v_code, v_name, v_shares, v_price,
        round(v_shares * v_price, 2), v_signal_at, v_signal_at
      ) returning id into v_position_id;
      v_position_shares_after := v_shares;
    else
      v_cycle_id := v_position.cycle_id;
      v_position_id := v_position.id;
      v_position_shares_after := v_position.shares + v_shares;
      update public.virtual_positions set
        name = v_name,
        strategy_version = v_strategy_version,
        shares = v_position_shares_after,
        total_cost = round(v_position.total_cost + v_shares * v_price, 2),
        average_cost = round(
          (v_position.total_cost + v_shares * v_price) / v_position_shares_after, 6
        ),
        updated_at = v_signal_at
      where id = v_position.id;
    end if;

    insert into public.virtual_transactions (
      user_id, source_id, cycle_id, position_id, source_signal_id, strategy_id,
      strategy_version, code, name, transaction_type, shares, price, amount,
      realized_profit, traded_at, trading_date
    ) values (
      v_user_id, 'cloud-signal:' || v_alert_id::text, v_cycle_id, v_position_id,
      v_alert_id, v_strategy_id, v_strategy_version, v_code, v_name, 'buy',
      v_shares, v_price, round(v_shares * v_price, 2), 0, v_signal_at, v_trading_date
    ) returning id into v_trade_id;

    insert into public.virtual_lots (
      user_id, source_id, position_id, source_signal_id, shares, remaining_shares,
      price, trading_date, bought_at
    ) values (
      v_user_id, 'cloud-signal:' || v_alert_id::text, v_position_id, v_alert_id,
      v_shares, v_shares, v_price, v_trading_date, v_signal_at
    );

    select coalesce(sum(remaining_shares), 0)::integer into v_available_after
    from public.virtual_lots
    where user_id = v_user_id and position_id = v_position_id
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
    from public.virtual_lots
    where user_id = v_user_id and position_id = v_position.id
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

    v_remaining := v_shares;
    for v_lot in
      select id, remaining_shares
      from public.virtual_lots
      where user_id = v_user_id and position_id = v_position.id
        and trading_date < v_trading_date and remaining_shares > 0
      order by bought_at, id
      for update
    loop
      exit when v_remaining = 0;
      v_consumed := least(v_lot.remaining_shares, v_remaining);
      update public.virtual_lots
      set remaining_shares = remaining_shares - v_consumed
      where id = v_lot.id;
      v_remaining := v_remaining - v_consumed;
    end loop;

    v_realized_profit := round((v_price - v_position.average_cost) * v_shares, 2);
    v_position_shares_after := v_position.shares - v_shares;
    v_available_after := v_available - v_shares;

    insert into public.virtual_transactions (
      user_id, source_id, cycle_id, position_id, source_signal_id, strategy_id,
      strategy_version, code, name, transaction_type, shares, price, amount,
      realized_profit, traded_at, trading_date
    ) values (
      v_user_id, 'cloud-signal:' || v_alert_id::text, v_cycle_id, v_position.id,
      v_alert_id, v_strategy_id, v_strategy_version, v_code, v_name, 'sell',
      v_shares, v_price, round(v_shares * v_price, 2), v_realized_profit,
      v_signal_at, v_trading_date
    ) returning id into v_trade_id;

    if v_position_shares_after = 0 then
      update public.virtual_cycles set
        closed_at = v_signal_at,
        realized_profit = realized_profit + v_realized_profit
      where id = v_cycle_id;
      delete from public.virtual_positions where id = v_position.id;
    else
      update public.virtual_cycles set
        realized_profit = realized_profit + v_realized_profit
      where id = v_cycle_id;
      update public.virtual_positions set
        shares = v_position_shares_after,
        total_cost = round(average_cost * v_position_shares_after, 2),
        updated_at = v_signal_at
      where id = v_position.id;
    end if;

    update public.signal_states set pending_virtual_sell = null
    where user_id = v_user_id and code = v_code and strategy_id = v_strategy_id;
  end if;

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
    'virtual_transaction', v_trade_id::text, p_payload
  );
  return v_alert_id;
end;
$$;

revoke all on function public.commit_signal_transition(jsonb) from public, anon, authenticated;
grant execute on function public.commit_signal_transition(jsonb) to service_role;