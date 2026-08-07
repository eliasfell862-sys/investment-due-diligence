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
