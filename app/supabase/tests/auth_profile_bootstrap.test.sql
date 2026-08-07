begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

select has_function(
  'public',
  'handle_new_user',
  array[]::text[],
  'profile bootstrap function exists'
);

select has_trigger(
  'auth',
  'users',
  'on_auth_user_created',
  'auth user trigger exists'
);

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000071', 'profile-a@example.com'),
  ('00000000-0000-0000-0000-000000000072', 'profile-b@example.com');

select is(
  (
    select count(*)::integer
    from public.profiles
    where user_id in (
      '00000000-0000-0000-0000-000000000071',
      '00000000-0000-0000-0000-000000000072'
    )
  ),
  2,
  'creates one profile for every auth user'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000071', true);

select is(
  (select count(*)::integer from public.profiles),
  1,
  'authenticated user can select only their profile'
);

select is_empty(
  $$
    update public.profiles
    set timezone = 'UTC'
    where user_id = '00000000-0000-0000-0000-000000000072'
    returning user_id
  $$,
  'authenticated user cannot update another profile'
);

reset role;
delete from auth.users where id = '00000000-0000-0000-0000-000000000071';

select is(
  (
    select count(*)::integer
    from public.profiles
    where user_id = '00000000-0000-0000-0000-000000000071'
  ),
  0,
  'deleting auth user cascades to profile'
);

select * from finish();
rollback;
