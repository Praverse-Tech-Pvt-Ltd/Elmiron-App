-- ============================================================================
-- BE-W7 (2 of 5) · The organisation default shift window now expires
--
-- BE-W3 refused every capture in a territory with no configured shift window.
-- BE-W6 reversed that under time pressure and added an organisation-level default,
-- flagged in a stored column and surfaced as a manager exception. The flag was the
-- thing that preserved the original property.
--
-- The flag is only as loud as whoever reads it, and the console that displays it is
-- Frontend's week 11. So between now and then the flag is real and invisible.
--
-- This makes the default SELF-CANCELLING. It carries a mandatory `expiresAt`, no
-- more than 60 days after the moment it was configured. After that it stops
-- applying and capture refuses again — back to the strict BE-W3 rule, automatically,
-- with nobody needing to remember.
--
-- That converts "we will fix this before the pilot" from an intention into a
-- deadline the system enforces. It also means that if the client never sends the
-- real working hours, the system tells them by failing, which is the only message
-- anyone reliably reads.
--
-- The default is still null unless somebody deliberately configures one.
--
-- Rollback: services/api/rollbacks/20260816000200_shift_window_expiry.down.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The ceiling, enforced at configuration time
-- ----------------------------------------------------------------------------

-- Sixty days from `effective_from`, not from `now()`.
--
-- Measured against effective_from because that is when the value starts applying,
-- and because a rule expressed against now() cannot be tested: there would be no
-- legal way to write a row that is already expired, and therefore no way to prove
-- the expired branch does what it claims. A backdated row with a backdated expiry
-- is a legitimate correction to the record AND the only honest way to exercise the
-- far side of the boundary.
create or replace function public.validate_app_threshold()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c_max_days constant integer := 60;
  v_expires  timestamptz;
begin
  if new.key <> 'org_default_shift_window' then
    return new;
  end if;

  -- Null is the "no fallback, refuse every capture" setting and needs no expiry:
  -- there is nothing to expire back to. This is also how the default is switched
  -- off deliberately before its date.
  if new.value is null or jsonb_typeof(new.value) = 'null' then
    return new;
  end if;

  if new.value -> 'expiresAt' is null or jsonb_typeof(new.value -> 'expiresAt') <> 'string' then
    raise exception
      'an org_default_shift_window must carry an expiresAt; it is a temporary measure by construction'
      using errcode = '22023',
            hint = 'Set expiresAt to an ISO timestamp no more than 60 days after effective_from.';
  end if;

  begin
    v_expires := (new.value ->> 'expiresAt')::timestamptz;
  exception when others then
    raise exception 'expiresAt % is not a timestamp', new.value ->> 'expiresAt'
      using errcode = '22023';
  end;

  if v_expires <= new.effective_from then
    raise exception 'expiresAt % is not after effective_from %', v_expires, new.effective_from
      using errcode = '22023';
  end if;

  if v_expires > new.effective_from + make_interval(days => c_max_days) then
    raise exception 'expiresAt % is more than % days after effective_from %',
      v_expires, c_max_days, new.effective_from
      using errcode = '22023',
            hint = 'The ceiling is deliberate. A fallback that can be configured for a year is not a fallback.';
  end if;

  return new;
end;
$$;

create trigger app_thresholds_validate
  before insert on public.app_thresholds
  for each row execute function public.validate_app_threshold();

-- ----------------------------------------------------------------------------
-- 2. Resolution stops honouring an expired default
-- ----------------------------------------------------------------------------

-- Identical to the BE-W6 body apart from the expiry check. A territory window still
-- always wins, and still never expires — a territory's real working hours are a
-- fact about the territory, not a stopgap.
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
  v_window  public.territory_shift_windows%rowtype;
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

  -- Expired, or configured before the expiry rule existed and therefore carrying no
  -- date at all. Both return no rows, which is_within_shift turns into a refusal.
  -- A default with no expiry is treated as expired rather than as permanent: the
  -- unsafe reading of missing data is the one that keeps capture flowing.
  if v_default -> 'expiresAt' is null
     or jsonb_typeof(v_default -> 'expiresAt') <> 'string'
     or (v_default ->> 'expiresAt')::timestamptz <= now() then
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

-- ----------------------------------------------------------------------------
-- 3. The refusal says which of the two things is wrong
-- ----------------------------------------------------------------------------

-- "No window configured" and "the stopgap window ran out" need different actions
-- from different people, and an MR who is told the wrong one raises the wrong
-- ticket. is_within_shift is the only place the distinction is visible.
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
        using errcode = '22023',
              hint = 'This was always temporary. Configure the territory''s real working hours.';
    end if;

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

-- ----------------------------------------------------------------------------
-- 4. The expiry is readable before it bites
-- ----------------------------------------------------------------------------

-- So the app and a manager can see the deadline coming rather than discovering it
-- on the morning every capture starts failing.
create or replace function public.org_default_shift_window_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with v as (select public.threshold('org_default_shift_window') as value)
  select case
    when v.value is null or jsonb_typeof(v.value) = 'null' then
      jsonb_build_object('configured', false, 'expiresAt', null, 'expired', null, 'daysRemaining', null)
    when v.value -> 'expiresAt' is null or jsonb_typeof(v.value -> 'expiresAt') <> 'string' then
      jsonb_build_object('configured', true, 'expiresAt', null, 'expired', true, 'daysRemaining', 0)
    else
      jsonb_build_object(
        'configured', true,
        'expiresAt', v.value ->> 'expiresAt',
        'expired', (v.value ->> 'expiresAt')::timestamptz <= now(),
        'daysRemaining',
          greatest(0, ceil(extract(epoch from ((v.value ->> 'expiresAt')::timestamptz - now())) / 86400)::integer))
  end
  from v;
$$;

comment on function public.org_default_shift_window_status() is
  'The deadline on the organisation default shift window, readable before it bites. '
  'A stopgap whose expiry is only discoverable by everything breaking is a worse '
  'stopgap than one with a visible date.';

grant execute on function public.org_default_shift_window_status() to authenticated;
