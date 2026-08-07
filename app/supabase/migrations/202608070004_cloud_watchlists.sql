alter table public.watchlists
  add column if not exists metadata jsonb not null default '{"groups":[],"codeGroups":{}}'::jsonb;

create or replace function public.replace_cloud_watchlists(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_watchlist jsonb;
  v_code jsonb;
  v_watchlist_id uuid;
  v_source_id text;
  v_count integer := 0;
  v_item_count integer := 0;
begin
  if v_user_id is null then raise exception 'authentication is required'; end if;
  if p_payload is null or jsonb_typeof(coalesce(p_payload -> 'watchlists', '[]'::jsonb)) <> 'array' then
    raise exception 'watchlists array is required';
  end if;

  for v_watchlist in
    select value from jsonb_array_elements(coalesce(p_payload -> 'watchlists', '[]'::jsonb))
  loop
    v_source_id := nullif(trim(v_watchlist ->> 'source_id'), '');
    if v_source_id is null then raise exception 'watchlist source id is required'; end if;
    if nullif(trim(v_watchlist ->> 'name'), '') is null then raise exception 'watchlist name is required'; end if;
    if jsonb_typeof(coalesce(v_watchlist -> 'codes', '[]'::jsonb)) <> 'array' then
      raise exception 'watchlist codes must be an array';
    end if;

    insert into public.watchlists (
      user_id, name, source_id, metadata, created_at, updated_at
    ) values (
      v_user_id,
      v_watchlist ->> 'name',
      v_source_id,
      coalesce(v_watchlist -> 'metadata', '{"groups":[],"codeGroups":{}}'::jsonb),
      coalesce((v_watchlist ->> 'created_at')::timestamptz, now()),
      now()
    )
    on conflict (user_id, source_id) do update set
      name = excluded.name,
      metadata = excluded.metadata,
      updated_at = now()
    returning id into v_watchlist_id;

    delete from public.watchlist_items
    where user_id = v_user_id and watchlist_id = v_watchlist_id;

    for v_code in select value from jsonb_array_elements(coalesce(v_watchlist -> 'codes', '[]'::jsonb)) loop
      if trim(v_code #>> '{}') !~ '^[0-9]{6}$' then raise exception 'valid six digit code is required'; end if;
      insert into public.watchlist_items (
        user_id, watchlist_id, code, enabled, source_id, updated_at
      ) values (
        v_user_id, v_watchlist_id, trim(v_code #>> '{}'), true,
        v_source_id || ':' || trim(v_code #>> '{}'), now()
      );
      v_item_count := v_item_count + 1;
    end loop;
    v_count := v_count + 1;
  end loop;

  delete from public.watchlists existing
  where existing.user_id = v_user_id
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_payload -> 'watchlists', '[]'::jsonb)) supplied
      where supplied ->> 'source_id' = existing.source_id
    );

  insert into public.audit_events (user_id, event_type, entity_type, entity_id, payload)
  values (
    v_user_id, 'cloud_watchlists_replaced', 'watchlists', v_user_id::text,
    jsonb_build_object('watchlists', v_count, 'items', v_item_count)
  );
  return jsonb_build_object('watchlists', v_count, 'items', v_item_count);
end;
$$;

revoke all on function public.replace_cloud_watchlists(jsonb) from public, anon;
grant execute on function public.replace_cloud_watchlists(jsonb) to authenticated;
