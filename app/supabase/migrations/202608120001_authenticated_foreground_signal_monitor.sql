create or replace function public.commit_authenticated_signal_transition(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  return public.commit_signal_transition((coalesce(p_payload, '{}'::jsonb) - 'user_id') || jsonb_build_object('user_id', v_user_id));
end;
$$;

create or replace function public.upsert_authenticated_signal_state(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  if coalesce(p_payload ->> 'code', '') !~ '^[0-9]{6}$' then raise exception 'valid code is required'; end if;
  insert into public.signal_states (
    user_id, code, strategy_id, strategy_version, buy_direction, sell_direction,
    buy_cycle_id, sell_cycle_id, pending_virtual_sell, updated_at
  ) values (
    v_user_id, p_payload ->> 'code', p_payload ->> 'strategy_id', p_payload ->> 'strategy_version',
    coalesce(p_payload ->> 'buy_direction', 'hold'), coalesce(p_payload ->> 'sell_direction', 'hold'),
    p_payload ->> 'buy_cycle_id', p_payload ->> 'sell_cycle_id', p_payload -> 'pending_virtual_sell',
    coalesce((p_payload ->> 'updated_at')::timestamptz, now())
  ) on conflict (user_id, code, strategy_id) do update set
    strategy_version = excluded.strategy_version,
    buy_direction = excluded.buy_direction,
    sell_direction = excluded.sell_direction,
    buy_cycle_id = excluded.buy_cycle_id,
    sell_cycle_id = excluded.sell_cycle_id,
    pending_virtual_sell = excluded.pending_virtual_sell,
    updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.commit_authenticated_signal_transition(jsonb) from public, anon;
grant execute on function public.commit_authenticated_signal_transition(jsonb) to authenticated;
revoke all on function public.upsert_authenticated_signal_state(jsonb) from public, anon;
grant execute on function public.upsert_authenticated_signal_state(jsonb) to authenticated;
