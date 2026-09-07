-- Rollback for 20260907000800_search_doctors_sargable.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- Restores the body from 20260814000100_manager_surface.sql:350-386 verbatim, which
-- means restoring a doctor search that sequentially scans the whole table on every
-- keystroke: 2,082 ms at 99,968 doctors, linear in table size, with
-- doctors_full_name_trgm_idx present and never used.
--
-- The restored body is `security invoker`, so the scope filter goes back to being the
-- two RLS policies on public.doctors rather than the predicate in the body. That is a
-- correctness-neutral swap in both directions -- the predicate transcribes the
-- policies -- but it is the reason this rollback is a whole function definition
-- rather than an `alter function ... security invoker`.
--
-- The GRANT is restored too. The pre-BE-W64 function was granted to `authenticated`
-- only, which is what it is set back to.

create or replace function public.search_doctors(
  p_query        text default null,
  p_territory_id uuid default null,
  p_limit        integer default 50
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with bounded as (
    select least(greatest(coalesce(p_limit, 50), 1), 200) as lim
  ),
  -- One more than asked for, so truncation is measured rather than guessed at.
  matched as (
    select d.*
      from public.doctors d, bounded
     where d.is_active
       and (p_territory_id is null or d.territory_id = p_territory_id)
       and (
         p_query is null
         or btrim(p_query) = ''
         or d.full_name ilike '%' || p_query || '%'
         or d.specialty ilike '%' || p_query || '%'
         or d.registration_number = p_query
       )
     order by d.full_name
     limit (select lim + 1 from bounded)
  )
  select jsonb_build_object(
    'items', coalesce(
      (select jsonb_agg(to_jsonb(m) order by m.full_name)
         from (select * from matched order by full_name limit (select lim from bounded)) m),
      '[]'::jsonb),
    'truncated', (select count(*) from matched) > (select lim from bounded),
    'limit', (select lim from bounded)
  );
$$;

revoke execute on function public.search_doctors(text, uuid, integer) from public, anon;
grant execute on function public.search_doctors(text, uuid, integer) to authenticated;

comment on function public.search_doctors(text, uuid, integer) is
  'Returns { items, truncated, limit }. `truncated` is measured by fetching one row '
  'beyond the limit — a silent cap would let an MR believe partial results are complete.';
