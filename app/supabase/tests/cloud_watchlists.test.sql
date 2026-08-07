begin;

create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-000000000031', 'watchlists@example.com');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000031', true);

select lives_ok(
  $$ select public.replace_cloud_watchlists('{"watchlists":[
    {"source_id":"wl-1","name":"核心","created_at":"2026-08-01T00:00:00Z","codes":["000001","600519"],"metadata":{"groups":[{"id":"g1","name":"价值","color":"#abc"}],"codeGroups":{"000001":["g1"]}}},
    {"source_id":"wl-2","name":"观察","created_at":"2026-08-02T00:00:00Z","codes":["300750"],"metadata":{"groups":[],"codeGroups":{}}}
  ]}'::jsonb) $$,
  'replaces the authenticated user watchlists atomically'
);

select is(
  (select metadata #>> '{groups,0,name}' from public.watchlists where source_id = 'wl-1'),
  '价值', 'preserves watchlist grouping metadata'
);

select is((select count(*)::integer from public.watchlist_items), 3, 'stores every supplied watchlist item');

select lives_ok(
  $$ select public.replace_cloud_watchlists('{"watchlists":[
    {"source_id":"wl-1","name":"核心更新","created_at":"2026-08-01T00:00:00Z","codes":["000001"],"metadata":{"groups":[],"codeGroups":{}}}
  ]}'::jsonb) $$,
  'removes watchlists and items omitted from the replacement set'
);

select * from finish();
rollback;
