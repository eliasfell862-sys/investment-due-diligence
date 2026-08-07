create or replace function public.mark_cloud_signal_alert_read(
  p_alert_id uuid,
  p_read_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_changed boolean := false;
begin
  if v_user_id is null then raise exception 'authentication is required'; end if;
  if p_alert_id is null or p_read_at is null then raise exception 'alert id and read time are required'; end if;

  update public.signal_alerts
  set read_at = coalesce(read_at, p_read_at)
  where id = p_alert_id and user_id = v_user_id
  returning true into v_changed;
  if not found then raise exception 'cloud signal alert was not found'; end if;

  insert into public.audit_events (user_id, event_type, entity_type, entity_id, payload)
  values (
    v_user_id, 'cloud_signal_alert_read', 'signal_alert', p_alert_id::text,
    jsonb_build_object('read_at', p_read_at)
  );
  return coalesce(v_changed, false);
end;
$$;

revoke all on function public.mark_cloud_signal_alert_read(uuid, timestamptz) from public, anon;
grant execute on function public.mark_cloud_signal_alert_read(uuid, timestamptz) to authenticated;
