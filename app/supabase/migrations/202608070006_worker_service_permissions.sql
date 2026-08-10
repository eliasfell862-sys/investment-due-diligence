grant select on public.watchlist_items to service_role;
grant select on public.positions, public.position_lots to service_role;
grant select on public.virtual_positions, public.virtual_lots, public.virtual_cycles to service_role;
grant select on public.strategy_assignments to service_role;

grant select, insert, update on public.signal_states to service_role;
grant select, insert, update on public.signal_alerts to service_role;
grant insert on public.audit_events to service_role;

grant select, insert, update, delete on public.worker_leases to service_role;
grant select, insert, update on public.worker_heartbeats to service_role;
grant select, insert, update on public.scan_runs to service_role;
grant select, insert on public.market_data_failures to service_role;
