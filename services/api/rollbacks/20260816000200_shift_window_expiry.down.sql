-- Rollback for 20260816000200_shift_window_expiry.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- Restores the BE-W6 behaviour: an organisation default shift window applies for as
-- long as it is configured, with no expiry and no ceiling on how long it may stand.
--
-- Note what this rollback does NOT do. Any org_default_shift_window row already
-- written carries an `expiresAt` inside its jsonb value, and this cannot remove it —
-- `app_thresholds` is append-only. The restored `resolve_shift_window` simply stops
-- reading the field, so the default becomes permanent again with the date left in
-- the record as a fossil. That is the correct outcome: the row is history, and
-- history is what an append-only table is for.

drop trigger if exists app_thresholds_validate on public.app_thresholds;
drop function if exists public.validate_app_threshold();
drop function if exists public.org_default_shift_window_status();

-- The BE-W6 body, with no expiry check.
create or replace function public.resolve_shift_window(p_territory_id uuid)
returns table (
  shift_start                time,
  shift_end                  time,
  timezone                   text,
  grace_minutes              integer,
  active_weekdays            smallint[],
  source                     public.shift_window_source_kind,
  resolved_from_territory_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_window public.territory_shift_windows%rowtype;
  v_default jsonb;
begin
  v_window := public.effective_shift_window(p_territory_id);

  if v_window.id is not null then
    return query select v_window.shift_start, v_window.shift_end, v_window.timezone,
                        v_window.grace_minutes, v_window.active_weekdays,
                        'territory'::public.shift_window_source_kind, v_window.territory_id;
    return;
  end if;

  v_default := public.threshold('org_default_shift_window');

  if v_default is null or jsonb_typeof(v_default) = 'null' then
    return;
  end if;

  return query select
    (v_default ->> 'shiftStart')::time,
    (v_default ->> 'shiftEnd')::time,
    coalesce(v_default ->> 'timezone', 'Asia/Kolkata'),
    coalesce((v_default ->> 'graceMinutes')::integer, 15),
    coalesce(
      (select array_agg(value::text::smallint)
         from jsonb_array_elements_text(coalesce(v_default -> 'activeWeekdays', '[1,2,3,4,5,6]'::jsonb)) value),
      '{1,2,3,4,5,6}'::smallint[]),
    'org_default'::public.shift_window_source_kind,
    null::uuid;
end;
$$;

-- The BE-W6 body, with one refusal message rather than two.
create or replace function public.is_within_shift(
  p_territory_id uuid,
  p_occurred_at  timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_window     record;
  v_local      timestamp;
  v_local_time time;
  v_weekday    smallint;
begin
  select * into v_window from public.resolve_shift_window(p_territory_id);

  if not found then
    raise exception 'no shift window configured for territory % or any ancestor, and no organisation default', p_territory_id
      using errcode = '22023',
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
$$;
