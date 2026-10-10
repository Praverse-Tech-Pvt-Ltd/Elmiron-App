-- `BE-W174` -- mileage counts a check-in on the same working day as everything else.
--
-- **The defect.** `daily_mileage` put each check-in on a day using
-- `coalesce(resolve_shift_window(<the DOCTOR's territory>).timezone, 'Asia/Kolkata')`. The rest of
-- the field day -- `visit_day()`, `coverage()`, the phone's Today -- uses `day_zone_for(<the REP>)`:
-- the rep's territory zone, falling back to UTC. Two differences, each enough to move a check-in to
-- a different date from its own visit: a different territory (a doctor's can change after the
-- visit; a rep's can too, and the day is the rep's working day), and a different fallback zone
-- (Asia/Kolkata here, UTC everywhere else).
--
-- **The rule now is the one rule.** Each check-in's day is its `occurred_at` in
-- `day_zone_unchecked(<the rep>)` -- the body `day_zone_for` calls (`20261009000200`), unchecked only
-- because this function has already scoped the rows to `visible_user_ids()`. No timezone default is
-- added or kept here; the Asia/Kolkata literal is gone.
--
-- Signature, grants and output are unchanged.
--
-- Rollback: services/api/rollbacks/20261009000400_mileage_day_zone.down.sql

create or replace function public.daily_mileage(
  p_from   date,
  p_to     date,
  p_mr_id  uuid default null
)
returns table (
  mr_id          uuid,
  travel_date    date,
  check_in_count integer,
  distance_metres double precision
)
language sql
stable
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
  with reps as (
    select distinct c.mr_id
      from public.check_ins c
     where c.mr_id in (select public.visible_user_ids())
       and (p_mr_id is null or c.mr_id = p_mr_id)
  ),
  zones as (
    select r.mr_id, (select z.time_zone from public.day_zone_unchecked(r.mr_id) z) as time_zone
      from reps r
  ),
  scoped as (
    select c.mr_id,
           c.occurred_at,
           c.latitude,
           c.longitude,
           (c.occurred_at at time zone zn.time_zone)::date as travel_date
      from public.check_ins c
      join zones zn on zn.mr_id = c.mr_id
  ),
  ordered as (
    select s.mr_id, s.travel_date, s.latitude, s.longitude,
           lag(s.latitude)  over w as prev_latitude,
           lag(s.longitude) over w as prev_longitude
      from scoped s
     where s.travel_date between p_from and p_to
    window w as (partition by s.mr_id, s.travel_date order by s.occurred_at)
  )
  select o.mr_id, o.travel_date, count(*)::integer,
         coalesce(sum(public.distance_metres(o.prev_latitude, o.prev_longitude,
                                             o.latitude, o.longitude)), 0)
    from ordered o
   group by o.mr_id, o.travel_date
   order by o.travel_date desc, o.mr_id;
$$;
