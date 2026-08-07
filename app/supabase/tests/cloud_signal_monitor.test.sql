begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'watchlist_items', 'watchlist items table exists');
select has_table('public', 'signal_alerts', 'signal alerts table exists');
select has_table('public', 'worker_leases', 'worker leases table exists');

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'watchlist_items'
      and policyname = 'watchlist_items_owner'
  ),
  'watchlist owner policy exists'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'signal_alerts'
      and policyname = 'signal_alerts_owner'
  ),
  'signal alert owner policy exists'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = to_regclass('public.signal_alerts')
      and contype = 'u'
      and pg_get_constraintdef(oid) like '%user_id, code, strategy_id, strategy_version, action, intent, cycle_id%'
  ),
  'signal alerts enforce cycle uniqueness'
);

select has_function(
  'public',
  'claim_worker_lease',
  array['text', 'text', 'integer'],
  'worker lease function exists'
);

select * from finish();

rollback;
