-- MR-24 B -- `is_within_shift` wrapped the grace past midnight and refused EVERYTHING.
--
-- Found on an emulator, on the first check-in this project has ever landed on the server.
-- The write reached `sync_push`, `apply_sync_item` routed it, and it came back
-- `rejected / outside_shift_window` for a capture at 10:55 IST inside a 04:00-23:59 window.
--
-- The last two lines of the function were:
--
--   return v_local_time >= (v_window.shift_start - make_interval(mins => grace))
--      and v_local_time <= (v_window.shift_end   + make_interval(mins => grace));
--
-- Both operands are `time`, and `time` WRAPS at midnight:
--
--   time '23:59' + make_interval(mins => 30)  ->  00:29:00
--
-- So the predicate became `>= 03:30 AND <= 00:29` -- a condition **no time of day can
-- satisfy**. Every check-in and check-out was refused, all day, for any territory whose
-- `shift_end + grace_minutes` crosses midnight. `seed-day.mjs` seeds exactly 23:59 / 30,
-- so the demo data was in the failing configuration and nobody could check in at all.
--
-- The fix compares INTERVALS SINCE MIDNIGHT rather than `time` values. `time - time`
-- yields an interval, and intervals do not wrap: 23:59 + 30 min is 24:29:00, which is
-- exactly the "half an hour past the end of shift" the grace was always meant to express.
-- A negative lower bound (a 00:15 shift with 30 minutes' grace) is likewise honest --
-- it admits midnight onward instead of wrapping back to 23:45 and admitting nothing.
--
-- WHAT THIS DELIBERATELY DOES NOT CHANGE: a window whose `shift_start` is LATER than its
-- `shift_end` -- a genuine night shift, 22:00 to 06:00 -- is still impossible to satisfy,
-- under the old arithmetic and the new. That is a real gap and a different decision (it
-- needs a rule for which calendar day such a shift belongs to, which is a product
-- question, not a rounding one). It is registered rather than smuggled in here.
--
-- Nothing else in the function changes: the same `resolve_shift_window` lookup, the same
-- 45002 refusals when no window resolves, the same weekday check, the same timezone
-- conversion.

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
  -- Intervals since local midnight. `time - time` is an interval, and an interval of
  -- 24:29:00 stays 24:29:00 instead of collapsing to 00:29:00.
  v_since      interval;
  v_from       interval;
  v_until      interval;
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

  v_since := v_local_time      - time '00:00';
  v_from  := (v_window.shift_start - time '00:00') - make_interval(mins => v_window.grace_minutes);
  v_until := (v_window.shift_end   - time '00:00') + make_interval(mins => v_window.grace_minutes);

  return v_since >= v_from and v_since <= v_until;
end;
$$;
