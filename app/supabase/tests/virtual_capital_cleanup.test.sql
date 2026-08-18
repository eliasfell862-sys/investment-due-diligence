begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-000000000011', 'cleanup@example.com');

insert into public.virtual_cash_accounts (
  user_id, initial_capital, cash_balance, requires_cleanup
) values (
  '00000000-0000-0000-0000-000000000011', 200000, 200000, true
);

insert into public.virtual_cycles (
  id, user_id, strategy_id, strategy_version, code, name, opened_at
) values
  ('11000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011',
   'realtime-technical', '1', '000001', 'A', '2026-08-18T01:00:00Z'),
  ('11000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000011',
   'realtime-technical', '1', '000002', 'B', '2026-08-18T02:00:00Z');

insert into public.virtual_transactions (
  id, user_id, cycle_id, strategy_id, strategy_version, code, name,
  transaction_type, shares, price, amount, gross_amount, fee_amount,
  cash_delta, cash_balance_after, fee_profile_snapshot, fee_estimated,
  realized_profit, traded_at, trading_date
) values
  ('12000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011',
   '11000000-0000-0000-0000-000000000001', 'realtime-technical', '1', '000001', 'A',
   'buy', 100, 1500, 150000, 150000, 0, -150000, 50000, '{}'::jsonb, false,
   0, '2026-08-18T01:00:00Z', '2026-08-18'),
  ('12000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000011',
   '11000000-0000-0000-0000-000000000002', 'realtime-technical', '1', '000002', 'B',
   'buy', 100, 600, 60000, 60000, 0, -60000, 0, '{}'::jsonb, false,
   0, '2026-08-18T02:00:00Z', '2026-08-18');

select has_table('public', 'virtual_capital_cleanup_previews', 'cleanup previews are persisted');
select has_function('public', 'preview_virtual_capital_cleanup', array[]::text[], 'preview RPC exists');
select has_function(
  'public', 'apply_virtual_capital_cleanup', array['uuid', 'text'], 'apply RPC exists'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);

create temporary table cleanup_preview as
select * from public.preview_virtual_capital_cleanup();

select is(
  (select retained_transaction_count from cleanup_preview), 1,
  'preview retains the affordable transaction'
);
select is(
  (select removed_transaction_count from cleanup_preview), 1,
  'preview removes the transaction that exceeds shared cash'
);
select is(
  (select ending_cash from cleanup_preview), 50000::numeric,
  'preview rebuilds the deterministic ending cash'
);

select lives_ok(
  $$ select public.apply_virtual_capital_cleanup(
    (select preview_id from cleanup_preview),
    (select snapshot_hash from cleanup_preview)
  ) $$,
  'exact unchanged preview can be applied'
);

select is(
  (select count(*)::integer from public.virtual_transactions
   where user_id = '00000000-0000-0000-0000-000000000011'),
  1,
  'apply removes only the unaffordable transaction'
);
select is(
  (select cash_balance from public.virtual_cash_accounts
   where user_id = '00000000-0000-0000-0000-000000000011'),
  50000::numeric,
  'apply stores rebuilt shared cash'
);
select is(
  (select requires_cleanup from public.virtual_cash_accounts
   where user_id = '00000000-0000-0000-0000-000000000011'),
  false,
  'apply clears the cleanup requirement'
);

reset role;
update public.virtual_cash_accounts set requires_cleanup = true
where user_id = '00000000-0000-0000-0000-000000000011';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);
create temporary table stale_preview as
select * from public.preview_virtual_capital_cleanup();

reset role;
update public.virtual_transactions set price = price + 1
where id = '12000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);
select throws_ok(
  $$ select public.apply_virtual_capital_cleanup(
    (select preview_id from stale_preview),
    (select snapshot_hash from stale_preview)
  ) $$,
  'P0001', 'virtual_capital_cleanup_snapshot_stale',
  'changed history invalidates the preview'
);

reset role;

select * from finish();

rollback;

