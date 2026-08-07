begin;

create extension if not exists pgtap with schema extensions;
select plan(2);

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-000000000041', 'alerts@example.com');

insert into public.signal_alerts (
  id, user_id, code, name, price, action, intent, suggested_shares,
  signal_at, message_kind, virtual_tracking_status, strategy_id, strategy_version, cycle_id
) values (
  '41000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000041',
  '000001', '平安银行', 10, 'buy', 'open', 100, '2026-08-07T01:30:00Z',
  'actual_position_risk', 'actual_risk_only', 'realtime', '3', 'read-cycle-1'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000041', true);

select lives_ok(
  $$ select public.mark_cloud_signal_alert_read('41000000-0000-0000-0000-000000000001', '2026-08-07T02:00:00Z') $$,
  'authenticated owner can mark a cloud alert read'
);

select is(
  (select read_at from public.signal_alerts where id = '41000000-0000-0000-0000-000000000001'),
  '2026-08-07T02:00:00Z'::timestamptz,
  'stores the supplied read timestamp'
);

select * from finish();
rollback;
