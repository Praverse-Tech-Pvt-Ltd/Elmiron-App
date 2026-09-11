-- Rollback for MR-24 B -- the shift-window grace wrap.
--
-- Restores `is_within_shift` to the definition captured with `pg_get_functiondef`
-- immediately before the change.
--
-- THIS REINSTATES A TOTAL OUTAGE. The restored body adds `grace_minutes` to a Postgres
-- `time`, which wraps: `time '23:59' + 30 minutes` is `00:29:00`, so the predicate becomes
-- `>= 03:30 AND <= 00:29` and NO time of day satisfies it. Every check-in and check-out is
-- refused, all day, for any territory whose `shift_end + grace_minutes` crosses midnight --
-- which is exactly what `seed-day.mjs` seeds (23:59 / 30).
--
-- Applying this rollback therefore breaks capture for the demo data. That is what rolling
-- back this migration MEANS, and it is stated here rather than discovered.

CREATE OR REPLACE FUNCTION public.is_within_shift(p_territory_id uuid, p_occurred_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_window     record;
  v_default    jsonb;
  v_local      timestamp;
  v_local_time time;
  v_weekday    smallint;
begin
  select * into v_window from public.resolve_shift_window(p_territory_id);

  if not found then
    v_default := public.threshold('org_default_shift_window');

    if v_default is not null and jsonb_typeof(v_default) <> 'null' then
      raise exception
        'the organisation default shift window expired on %; territory % still has no window of its own',
        coalesce(v_default ->> 'expiresAt', 'an unrecorded date'), p_territory_id
        using errcode = '45002',
              hint = 'This was always temporary. Configure the territory''s real working hours.';
    end if;

    raise exception 'no shift window configured for territory % or any ancestor, and no organisation default', p_territory_id
      using errcode = '45002',
            hint = 'Insert a territory_shift_windows row, or set the org_default_shift_window threshold.';
  end if;

  v_local := p_occurred_at at time zone v_window.timezone;
  v_local_time := v_local::time;
  v_weekday := extract(isodow from v_local)::smallint;

  if not (v_weekday = any (v_window.active_weekdays)) then
    return false;
  end if;

  return v_local_time >= (v_window.shift_start - make_interval(mins => v_window.grace_minutes))
     and v_local_time <= (v_window.shift_end   + make_interval(mins => v_window.grace_minutes));
end;
$function$;
