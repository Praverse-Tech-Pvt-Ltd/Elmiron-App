-- Rollback for `BE-W174` (20261009000400_mileage_day_zone): mileage puts a check-in on a day by the
-- DOCTOR's territory zone with an Asia/Kolkata fallback again -- 20260815000100's body, unchanged since.

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
  with scoped as (
    select c.mr_id,
           c.occurred_at,
           c.latitude,
           c.longitude,
           (c.occurred_at at time zone coalesce(
              (select w.timezone from public.resolve_shift_window(d.territory_id) w),
              'Asia/Kolkata'))::date as travel_date
      from public.check_ins c
      join public.visits  v on v.id = c.visit_id
      join public.doctors d on d.id = v.doctor_id
     where c.mr_id in (select public.visible_user_ids())
       and (p_mr_id is null or c.mr_id = p_mr_id)
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
