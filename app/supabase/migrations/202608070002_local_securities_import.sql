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
