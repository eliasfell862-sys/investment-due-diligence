begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-000000000021', 'trader@example.com');

insert into public.signal_alerts (
  id, user_id, code, name, price, action, intent, suggested_shares,
  signal_at, message_kind, virtual_tracking_status, strategy_id, strategy_version, cycle_id
) values
  ('21000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000021', '000001', '平安银行', 10, 'buy', 'open', 200, '2026-08-06T01:30:00Z', 'actual_position_risk', 'actual_risk_only', 'realtime', '3', 'buy-1'),
  ('21000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000021', '000001', '平安银行', 11, 'buy', 'add', 100, '2026-08-07T01:30:00Z', 'actual_position_risk', 'actual_risk_only', 'realtime', '3', 'buy-2'),
  ('21000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000021', '000001', '平安银行', 12, 'sell', 'reduce', 200, '2026-08-07T02:00:00Z', 'actual_position_risk', 'actual_risk_only', 'realtime', '3', 'sell-1'),
  ('21000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000021', '000001', '平安银行', 12, 'sell', 'exit', 100, '2026-08-07T02:05:00Z', 'actual_position_risk', 'actual_risk_only', 'realtime', '3', 'sell-2');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000021', true);

select lives_ok(
  $$ select public.execute_cloud_position_buy('{"alert_id":"21000000-0000-0000-0000-000000000001","code":"000001","name":"平安银行","shares":200,"price":10,"group_source_id":"core","group_name":"核心持仓","traded_at":"2026-08-06T01:30:00Z"}'::jsonb) $$,
  'executes the first cloud buy atomically'
);

select lives_ok(
  $$ select public.execute_cloud_position_buy('{"alert_id":"21000000-0000-0000-0000-000000000002","code":"000001","name":"平安银行","shares":100,"price":11,"group_source_id":"core","group_name":"核心持仓","traded_at":"2026-08-07T01:30:00Z"}'::jsonb) $$,
  'adds a same-day buy lot'
);

select is((select shares from public.positions where code = '000001'), 300, 'position contains all 300 shares');

select lives_ok(
  $$ select public.execute_cloud_position_sell('{"alert_id":"21000000-0000-0000-0000-000000000003","code":"000001","shares":200,"price":12,"traded_at":"2026-08-07T02:00:00Z"}'::jsonb) $$,
  'sells only the previous-day available shares'
);

select is((select shares from public.positions where code = '000001'), 100, 'same-day 100 shares remain held');

select throws_ok(
  $$ select public.execute_cloud_position_sell('{"alert_id":"21000000-0000-0000-0000-000000000004","code":"000001","shares":100,"price":12,"traded_at":"2026-08-07T02:05:00Z"}'::jsonb) $$,
  'P0001', 'sell shares exceed T+1 available shares',
  'blocks selling the same-day lot'
);

select * from finish();
rollback;
