begin;

create extension if not exists pgtap with schema extensions;
select plan(37);

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


insert into auth.users (id, email)
values ('00000000-0000-0000-0000-000000000073', 't-executor@example.com');
insert into public.position_groups (id, user_id, name, source_id)
values ('73000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000073', 'T-test', 't-test');

insert into public.positions (
  id, user_id, group_id, code, name, shares, average_cost, total_cost, source_id, opened_at
) values
  ('73000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000073', '73000000-0000-0000-0000-000000000001', '600001', 'six-ok', 600, 10, 6000, 't-pos-600-ok', '2026-08-08T01:00:00Z'),
  ('73000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000073', '73000000-0000-0000-0000-000000000001', '600002', 'six-fail', 600, 10, 6000, 't-pos-600-fail', '2026-08-08T01:00:00Z'),
  ('73000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000073', '73000000-0000-0000-0000-000000000001', '600003', 'thousand-ok', 1000, 10, 10000, 't-pos-1000-ok', '2026-08-08T01:00:00Z'),
  ('73000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000073', '73000000-0000-0000-0000-000000000001', '600004', 'thousand-fail', 1000, 10, 10000, 't-pos-1000-fail', '2026-08-08T01:00:00Z'),
  ('73000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000000073', '73000000-0000-0000-0000-000000000001', '600005', 'rollback', 1000, 10, 10000, 't-pos-rollback', '2026-08-08T01:00:00Z');

insert into public.position_lots (
  user_id, position_id, source_transaction_id, shares, remaining_shares, price, trading_date, bought_at
)
select user_id, id, 'fixture-' || code, shares, shares, 10, '2026-08-08', '2026-08-08T01:00:00Z'
from public.positions where user_id = '00000000-0000-0000-0000-000000000073';

insert into public.signal_alerts (
  id, user_id, code, name, price, action, intent, suggested_shares, signal_at,
  message_kind, virtual_tracking_status, strategy_id, strategy_version, cycle_id,
  source_id, signal_metadata
) values
  ('73000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000073', '600001', 'six-ok', 12, 'sell', 'reduce', 200, '2026-08-11T02:00:00Z', 'actual_t_sell', 'actual_risk_only', 'actual-t', '1', 'sell-600-ok', 't-sell-600-ok', '{"cycle_type":"profit_t"}'),
  ('73000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000073', '600002', 'six-fail', 12, 'sell', 'reduce', 300, '2026-08-11T02:00:00Z', 'actual_t_sell', 'actual_risk_only', 'actual-t', '1', 'sell-600-fail', 't-sell-600-fail', '{"cycle_type":"profit_t"}'),
  ('73000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000073', '600003', 'thousand-ok', 12, 'sell', 'reduce', 300, '2026-08-11T02:00:00Z', 'actual_t_sell', 'actual_risk_only', 'actual-t', '1', 'sell-1000-ok', 't-sell-1000-ok', '{"cycle_type":"profit_t"}'),
  ('73000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000073', '600004', 'thousand-fail', 12, 'sell', 'reduce', 400, '2026-08-11T02:00:00Z', 'actual_t_sell', 'actual_risk_only', 'actual-t', '1', 'sell-1000-fail', 't-sell-1000-fail', '{"cycle_type":"profit_t"}'),
  ('73000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000000073', '600005', 'rollback', 12, 'sell', 'reduce', 300, '2026-08-11T02:00:00Z', 'actual_t_sell', 'actual_risk_only', 'actual-t', '1', 'sell-rollback', 't-sell-rollback', '{"cycle_type":"profit_t"}');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000073', true);
select lives_ok(
  $$ select public.execute_t_trade_sell('{"alert_id":"73000000-0000-0000-0000-000000000101","price":12,"shares":200,"traded_at":"2026-08-11T02:00:00Z"}'::jsonb) $$,
  '600 available shares allow 200'
);
select throws_ok(
  $$ select public.execute_t_trade_sell('{"alert_id":"73000000-0000-0000-0000-000000000102","price":12,"shares":300,"traded_at":"2026-08-11T02:00:00Z"}'::jsonb) $$,
  'P0001', 'T sell shares exceed 35% available limit', '600 available shares reject 300'
);
select lives_ok(
  $$ select public.execute_t_trade_sell('{"alert_id":"73000000-0000-0000-0000-000000000103","price":12,"shares":300,"traded_at":"2026-08-11T02:00:00Z"}'::jsonb) $$,
  '1000 available shares allow 300'
);
select throws_ok(
  $$ select public.execute_t_trade_sell('{"alert_id":"73000000-0000-0000-0000-000000000104","price":12,"shares":400,"traded_at":"2026-08-11T02:00:00Z"}'::jsonb) $$,
  'P0001', 'T sell shares exceed 35% available limit', '1000 available shares reject 400'
);
select is((select shares from public.positions where id = '73000000-0000-0000-0000-000000000013'), 700, 'sell updates actual position');
select lives_ok(
  $$ select public.execute_t_trade_sell('{"alert_id":"73000000-0000-0000-0000-000000000103","price":12,"shares":300,"traded_at":"2026-08-11T02:00:00Z"}'::jsonb) $$,
  'duplicate sell is idempotent'
);
select is((select count(*)::integer from public.t_trade_executions where source_alert_id = '73000000-0000-0000-0000-000000000103'), 1, 'duplicate creates one execution');
select is((select remaining_shares from public.position_lots where position_id = '73000000-0000-0000-0000-000000000011'), 400, 'sell consumes prior-day FIFO lot');
reset role;

create function public.test_reject_t_execution() returns trigger language plpgsql as $$
begin
  if new.source_alert_id = '73000000-0000-0000-0000-000000000105'::uuid then
    raise exception 'forced T execution failure';
  end if;
  return new;
end $$;
create trigger test_reject_t_execution_trigger before insert on public.t_trade_executions
for each row execute function public.test_reject_t_execution();

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000073', true);
select throws_ok(
  $$ select public.execute_t_trade_sell('{"alert_id":"73000000-0000-0000-0000-000000000105","price":12,"shares":300,"traded_at":"2026-08-11T02:00:00Z"}'::jsonb) $$,
  'P0001', 'forced T execution failure', 'post-ledger failure rolls back transaction'
);
select is((select shares from public.positions where id = '73000000-0000-0000-0000-000000000015'), 1000, 'rollback restores actual position');
reset role;
drop trigger test_reject_t_execution_trigger on public.t_trade_executions;
drop function public.test_reject_t_execution();

insert into public.signal_alerts (
  id, user_id, code, name, price, action, intent, suggested_shares, signal_at,
  message_kind, virtual_tracking_status, strategy_id, strategy_version, cycle_id,
  source_id, signal_metadata, t_trade_cycle_id
)
select '73000000-0000-0000-0000-000000000201', user_id, code, name, 11, 'buy', 'add', 100,
  '2026-08-11T03:00:00Z', 'actual_t_buyback', 'actual_risk_only', 'actual-t', '1',
  'buyback-1', 'buyback-1', '{}', id
from public.t_trade_cycles where position_id = '73000000-0000-0000-0000-000000000013';
insert into public.signal_alerts (
  id, user_id, code, name, price, action, intent, suggested_shares, signal_at,
  message_kind, virtual_tracking_status, strategy_id, strategy_version, cycle_id,
  source_id, signal_metadata, t_trade_cycle_id
)
select '73000000-0000-0000-0000-000000000202', user_id, code, name, 11, 'buy', 'add', 200,
  '2026-08-11T04:00:00Z', 'actual_t_buyback', 'actual_risk_only', 'actual-t', '1',
  'buyback-2', 'buyback-2', '{}', id
from public.t_trade_cycles where position_id = '73000000-0000-0000-0000-000000000013';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000073', true);
select lives_ok(
  $$ select public.execute_t_trade_buyback('{"alert_id":"73000000-0000-0000-0000-000000000201","price":11,"shares":100,"traded_at":"2026-08-11T03:00:00Z"}'::jsonb) $$,
  'records first partial buyback'
);
select is((select remaining_buyback_shares from public.t_trade_cycles where position_id = '73000000-0000-0000-0000-000000000013'), 200, 'partial buyback leaves 200');
select lives_ok(
  $$ select public.execute_t_trade_buyback('{"alert_id":"73000000-0000-0000-0000-000000000202","price":11,"shares":200,"traded_at":"2026-08-11T04:00:00Z"}'::jsonb) $$,
  'records final partial buyback'
);
select is((select status from public.t_trade_cycles where position_id = '73000000-0000-0000-0000-000000000013'), 'completed', 'final buyback completes cycle');
select is((select coalesce(sum(remaining_shares), 0)::integer from public.position_lots where position_id = '73000000-0000-0000-0000-000000000013' and trading_date = '2026-08-11'), 300, 'same-day buybacks are T+1 frozen');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000071', true);
select lives_ok(
  $$ select public.resolve_t_trade_cycle('{"cycle_id":"71000000-0000-0000-0000-000000000001","resolution":"keep_as_reduction","resolved_at":"2026-08-11T06:55:00Z"}'::jsonb) $$,
  'owner can keep unmatched shares as reduction'
);
reset role;
set local role service_role;
select lives_ok($$ select public.expire_t_trade_cycles('2026-08-11T07:01:00Z') $$, 'service expires unresolved cycles');
reset role;
select is((select status from public.t_trade_cycles where id = '72000000-0000-0000-0000-000000000001'), 'expired_unfilled', 'expired cycle stops automatic buyback');

select * from finish();
rollback;
