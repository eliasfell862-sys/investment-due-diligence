begin;

create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000071', 't-owner@example.com'),
  ('00000000-0000-0000-0000-000000000072', 't-other@example.com');

select has_table('public', 'trading_fee_profiles', 'fee profile table exists');
select has_table('public', 't_trade_cycles', 'T cycle table exists');
select has_table('public', 't_trade_executions', 'T execution table exists');
select has_column('public', 'signal_alerts', 'signal_metadata', 'alerts expose typed metadata');
select has_column('public', 'signal_alerts', 't_trade_cycle_id', 'alerts can bind a T cycle');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000071', true);

select is(
  (public.get_effective_trading_fee_profile() ->> 'commission_rate')::numeric,
  0.0003::numeric,
  'missing profile resolves to default commission'
);
select is(
  (public.get_effective_trading_fee_profile() ->> 'minimum_commission')::numeric,
  5::numeric,
  'missing profile resolves to default minimum commission'
);

select lives_ok(
  $$ select public.upsert_trading_fee_profile('{"commission_rate":0.0002,"minimum_commission":6,"sell_stamp_duty_rate":0.0005,"transfer_fee_rate":0.00001,"slippage_mode":"fixed","fixed_slippage_rate":0.0008}'::jsonb) $$,
  'owner can save a validated fee profile through RPC'
);
select is(
  (public.get_effective_trading_fee_profile() ->> 'minimum_commission')::numeric,
  6::numeric,
  'saved profile overrides defaults'
);

reset role;

insert into public.t_trade_cycles (
  id, user_id, position_id, code, name, cycle_type, status,
  pre_cycle_average_cost, pre_cycle_total_shares, sold_shares,
  remaining_buyback_shares, fee_profile_snapshot, signal_basis_snapshot,
  strategy_id, strategy_version, trading_date, expires_at
) values
  (
    '71000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000071',
    '71000000-0000-0000-0000-000000000011',
    '000685', '中山公用', 'profit_t', 'buyback_monitoring',
    11.10, 1000, 300, 300, '{}'::jsonb, '{}'::jsonb,
    'actual-t', '1', '2026-08-11', '2026-08-11T07:00:00Z'
  ),
  (
    '72000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000072',
    '72000000-0000-0000-0000-000000000011',
    '000001', '平安银行', 'cost_reduction_t', 'buyback_monitoring',
    13.00, 1000, 300, 300, '{}'::jsonb, '{}'::jsonb,
    'actual-t', '1', '2026-08-11', '2026-08-11T07:00:00Z'
  );

insert into public.t_trade_executions (
  id, user_id, cycle_id, position_id, side, price, shares, total_fees,
  fee_breakdown, executed_at, idempotency_key
) values
  (
    '71000000-0000-0000-0000-000000000021',
    '00000000-0000-0000-0000-000000000071',
    '71000000-0000-0000-0000-000000000001',
    '71000000-0000-0000-0000-000000000011',
    'sell', 12, 300, 6, '{}'::jsonb, '2026-08-11T02:00:00Z', 'owner-sell'
  ),
  (
    '72000000-0000-0000-0000-000000000021',
    '00000000-0000-0000-0000-000000000072',
    '72000000-0000-0000-0000-000000000001',
    '72000000-0000-0000-0000-000000000011',
    'sell', 12, 300, 6, '{}'::jsonb, '2026-08-11T02:00:00Z', 'other-sell'
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000071', true);

select is((select count(*)::integer from public.t_trade_cycles), 1, 'RLS exposes only owner cycles');
select is((select count(*)::integer from public.t_trade_executions), 1, 'RLS exposes only owner executions');
select throws_ok(
  $$ insert into public.t_trade_cycles (
    user_id, position_id, code, name, cycle_type, status, pre_cycle_average_cost,
    pre_cycle_total_shares, sold_shares, remaining_buyback_shares,
    fee_profile_snapshot, signal_basis_snapshot, strategy_id, strategy_version,
    trading_date, expires_at
  ) values (
    '00000000-0000-0000-0000-000000000072',
    '72000000-0000-0000-0000-000000000099',
    '000002', '万科A', 'profit_t', 'buyback_monitoring', 10, 1000, 300, 300,
    '{}'::jsonb, '{}'::jsonb, 'actual-t', '1', '2026-08-11', '2026-08-11T07:00:00Z'
  ) $$,
  '42501', null,
  'authenticated clients cannot insert cycles directly'
);
select throws_ok(
  $$ update public.t_trade_cycles set status = 'completed'
     where id = '72000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'authenticated clients cannot update another user cycle'
);

reset role;
set local role service_role;

select lives_ok(
  $$ select public.commit_t_trade_signal('{"user_id":"00000000-0000-0000-0000-000000000071","position_id":"71000000-0000-0000-0000-000000000011","code":"000685","name":"中山公用","price":12,"signal_kind":"actual_t_buyback","suggested_shares":300,"strategy_id":"actual-t","strategy_version":"1","trading_date":"2026-08-11","signal_at":"2026-08-11T03:00:00Z","expires_at":"2026-08-11T07:00:00Z","t_trade_cycle_id":"71000000-0000-0000-0000-000000000001","signal_metadata":{"target_range":[11.2,11.5]}}'::jsonb) $$,
  'service role can commit a typed T signal'
);
select lives_ok(
  $$ select public.commit_t_trade_signal('{"user_id":"00000000-0000-0000-0000-000000000071","position_id":"71000000-0000-0000-0000-000000000011","code":"000685","name":"中山公用","price":11.9,"signal_kind":"actual_t_buyback","suggested_shares":300,"strategy_id":"actual-t","strategy_version":"1","trading_date":"2026-08-11","signal_at":"2026-08-11T03:01:00Z","expires_at":"2026-08-11T07:00:00Z","t_trade_cycle_id":"71000000-0000-0000-0000-000000000001","signal_metadata":{"target_range":[11.1,11.4]}}'::jsonb) $$,
  'persistent condition updates the pending signal'
);

reset role;

select is(
  (select count(*)::integer from public.signal_alerts where message_kind = 'actual_t_buyback'),
  1,
  'deterministic key deduplicates persistent T signals'
);
select is(
  (select price from public.signal_alerts where message_kind = 'actual_t_buyback'),
  11.9::numeric,
  'deduplicated alert keeps the latest snapshot'
);
select is(
  (select count(*)::integer from public.audit_events where event_type = 't_trade_signal_created'),
  1,
  'only the new signal edge creates an audit event'
);
select ok(
  not has_function_privilege('anon', 'public.commit_t_trade_signal(jsonb)', 'EXECUTE'),
  'anon cannot commit T signals'
);

select * from finish();
rollback;
