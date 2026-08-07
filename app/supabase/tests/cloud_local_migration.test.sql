begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-000000000011', 'migration@example.com');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);

select lives_ok(
  $$ select public.import_local_securities_state(
    repeat('a', 64),
    '{
      "watchlists":[{"sourceId":"wl-1","name":"核心","createdAt":"2026-08-01T00:00:00Z"}],
      "watchlistItems":[{"sourceId":"wl-1:000001","watchlistSourceId":"wl-1","code":"000001"}],
      "positionGroups":[{"sourceId":"core","name":"核心持仓"}],
      "positions":[{"sourceId":"position-1","groupSourceId":"core","code":"000001","name":"平安银行","shares":100,"averageCost":10,"totalCost":1000,"openedAt":"2026-08-03T01:30:00Z","updatedAt":"2026-08-03T01:30:00Z"}],
      "positionLots":[{"positionSourceId":"position-1","sourceTransactionId":"tx-1","shares":100,"remainingShares":100,"price":10,"boughtAt":"2026-08-03T01:30:00Z"}],
      "positionTransactions":[{"sourceId":"tx-1","groupSourceId":"core","positionSourceId":"position-1","sourceAlertSourceId":null,"code":"000001","name":"平安银行","type":"buy","shares":100,"price":10,"amount":1000,"realizedProfit":0,"tradedAt":"2026-08-03T01:30:00Z"}],
      "signalStates":[],"signalAlerts":[],
      "virtualLedger":{"version":1,"positions":[],"transactions":[],"cycles":[]}
    }'::jsonb
  ) $$,
  'authenticated user can import local securities state'
);

select is((select count(*)::integer from public.watchlists), 1, 'imports one watchlist');
select is((select remaining_shares from public.position_lots limit 1), 100, 'imports the reconstructed FIFO lot');

select lives_ok(
  $$ select public.import_local_securities_state(
    repeat('a', 64),
    '{"watchlists":[],"watchlistItems":[],"positionGroups":[],"positions":[],"positionLots":[],"positionTransactions":[],"signalStates":[],"signalAlerts":[],"virtualLedger":{"version":1,"positions":[],"transactions":[],"cycles":[]}}'::jsonb
  ) $$,
  'repeating a completed migration is a no-op'
);

select is((select count(*)::integer from public.local_securities_migrations), 1, 'records one completed migration');

select * from finish();

rollback;
