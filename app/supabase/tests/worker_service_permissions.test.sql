begin;

select plan(4);

select ok(has_table_privilege('service_role', 'public.worker_heartbeats', 'INSERT'), 'service role can insert worker heartbeat');
select ok(has_table_privilege('service_role', 'public.scan_runs', 'INSERT'), 'service role can insert scan runs');
select ok(has_table_privilege('service_role', 'public.signal_states', 'SELECT,INSERT,UPDATE'), 'service role can manage signal states');
select ok(has_table_privilege('service_role', 'public.watchlist_items', 'SELECT'), 'service role can load monitoring universe');

select * from finish();
rollback;
