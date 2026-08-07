begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000001', 'owner-a@example.com'),
  ('00000000-0000-0000-0000-000000000002', 'owner-b@example.com');

insert into public.watchlists (id, user_id, name)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'A'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'B');

insert into public.watchlist_items (user_id, watchlist_id, code)
values
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '000001'),
  ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '600519');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);

select is(
  (select count(*)::integer from public.watchlist_items),
  1,
  'RLS exposes only the signed-in user watchlist item'
);

select is(
  (select code from public.watchlist_items limit 1),
  '000001',
  'RLS does not leak another user code'
);

reset role;

create temporary table signal_ids (id uuid);

insert into signal_ids
select public.commit_signal_transition(jsonb_build_object(
  'user_id', '00000000-0000-0000-0000-000000000001',
  'code', '000001',
  'name', '平安银行',
  'price', 11.25,
  'action', 'buy',
  'intent', 'open',
  'suggested_shares', 100,
  'position_shares_at_signal', 0,
  'available_shares_at_signal', 0,
  'reasons', jsonb_build_array('RSI超卖'),
  'metrics', '{}'::jsonb,
  'entry_price', 11.25,
  'stop_loss', 10.35,
  'signal_at', '2026-08-07T01:30:00Z',
  'message_kind', 'virtual_execution',
  'virtual_tracking_status', 'executed',
  'virtual_shares', 100,
  'virtual_price', 11.25,
  'strategy_id', 'realtime-technical',
  'strategy_version', '1',
  'cycle_id', 'cycle-000001-buy-1',
  'buy_direction', 'buy',
  'sell_direction', 'hold',
  'buy_cycle_id', 'cycle-000001-buy-1'
));

insert into signal_ids
select public.commit_signal_transition(jsonb_build_object(
  'user_id', '00000000-0000-0000-0000-000000000001',
  'code', '000001',
  'name', '平安银行',
  'price', 11.25,
  'action', 'buy',
  'intent', 'open',
  'suggested_shares', 100,
  'position_shares_at_signal', 0,
  'available_shares_at_signal', 0,
  'reasons', jsonb_build_array('RSI超卖'),
  'metrics', '{}'::jsonb,
  'entry_price', 11.25,
  'stop_loss', 10.35,
  'signal_at', '2026-08-07T01:30:03Z',
  'message_kind', 'virtual_execution',
  'virtual_tracking_status', 'executed',
  'virtual_shares', 100,
  'virtual_price', 11.25,
  'strategy_id', 'realtime-technical',
  'strategy_version', '1',
  'cycle_id', 'cycle-000001-buy-1',
  'buy_direction', 'buy',
  'sell_direction', 'hold',
  'buy_cycle_id', 'cycle-000001-buy-1'
));

select is(
  (select count(distinct id)::integer from signal_ids),
  1,
  'repeating the same signal cycle returns the existing alert id'
);

select is(
  (select count(*)::integer from public.signal_alerts where cycle_id = 'cycle-000001-buy-1'),
  1,
  'repeating the same signal cycle stores one alert'
);

select ok(
  public.claim_worker_lease('cloud-signal-monitor', 'worker-a', 30),
  'first worker claims the lease'
);

select ok(
  not public.claim_worker_lease('cloud-signal-monitor', 'worker-b', 30),
  'second worker cannot steal an active lease'
);

select * from finish();

rollback;
