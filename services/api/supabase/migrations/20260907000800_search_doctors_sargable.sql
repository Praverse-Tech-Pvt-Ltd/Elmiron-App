-- ============================================================================
-- BE-W64 · `search_doctors` uses the trigram index that has existed since August
--
-- `doctors_full_name_trgm_idx` and `doctors_specialty_trgm_idx` were created in
-- `20260812000100_field_operations.sql:490-495` under a comment promising "an MR
-- standing in a waiting room needs a doctor in under three seconds". FIX-09 measured
-- the search at **2,082 ms over 99,968 doctors**, linear in table size, on a
-- `Seq Scan`. The indexes had never been used. Not once.
--
-- ----------------------------------------------------------------------------
-- WHY THE INDEX NEVER FIRED. FIX-09 GOT THIS WRONG AND THE CORRECTION MATTERS.
-- ----------------------------------------------------------------------------
--
-- FIX-09 recorded the cause as `p_query is null or ... ilike` being non-sargable.
-- That is **not** the cause. Measured on the live database at 99,968 rows:
--
--   as `postgres`, the exact null-OR disjunction, ILIKE via a parameter
--     -> Bitmap Index Scan on doctors_full_name_trgm_idx, 0.055 ms
--   as `authenticated`, a bare ILIKE with NO null-OR at all
--     -> Seq Scan, 2,205.952 ms, 201,488 buffers
--   as `authenticated`, `full_name = '...'` on the same column, same role
--     -> Bitmap Index Scan on doctors_full_name_trgm_idx, 0.396 ms
--
-- The difference between the last two is not the predicate shape. It is that
-- `texteq` is LEAKPROOF and `texticlike` is not:
--
--   select proname, proleakproof from pg_proc where proname in ('texteq','texticlike');
--    texteq     | t
--    texticlike | f
--
-- `public.doctors` has RLS enabled and FORCED. Postgres will not evaluate a
-- non-leakproof qual before a security qual, because a fast operator that can raise
-- or time differently would leak the contents of rows the policy is hiding. So the
-- ILIKE is demoted to a post-filter and **can never become an index condition while
-- the scope comes from RLS**. That is a Postgres correctness rule, not a planner
-- mood; no index and no rewrite of the predicate can change it.
--
-- ----------------------------------------------------------------------------
-- THE SECOND CAUSE, WHICH IS REAL BUT WOULD NOT HAVE SHOWN UP YET
-- ----------------------------------------------------------------------------
--
-- The null-OR disjunction *is* a latent problem, just not this one. A custom plan
-- folds `$1 is null` and keeps the index. A GENERIC plan cannot, and a cached plan
-- becomes generic after five executions if it looks no more expensive:
--
--   set plan_cache_mode = force_generic_plan;
--   -- with the null branch:    Seq Scan, Rows Removed by Filter: 99968
--   -- with the null branch removed: Bitmap Index Scan on doctors_full_name_trgm_idx
--
-- That is a query which is fast five times and slow for ever after -- the worst
-- shape a performance defect can take, because the first person to measure it sees
-- the fast number. So the branch is split even though it is not today's cause.
--
-- ----------------------------------------------------------------------------
-- THE FIX, AND WHY THIS ONE
-- ----------------------------------------------------------------------------
--
-- 1. `security definer`, with the scope applied in the body. This is the only thing
--    that removes the leakproof barrier, and it is not a new pattern here: nine
--    tables already have RLS forced with zero policies and are read exclusively
--    through `security definer` bodies, and `.ai-collab/architecture.md` records
--    that the authorisation surface of this schema is 88 function bodies rather
--    than 41 policies. The scope predicate below is a transcription of the two
--    policies on `doctors`, and `field.spec.ts` asserts the cross-territory refusal
--    directly rather than trusting the transcription.
--
--    Rejected: `alter function texticlike leakproof`. It is superuser-only (this
--    project's `postgres` role is `rolsuper = f`), it is global, and it would weaken
--    every RLS-protected ILIKE in the database to buy speed in one function.
--
-- 2. `plpgsql` with an IF, so the empty-query listing and the text search are two
--    statements with two plans, neither of which has to serve the other. The
--    alternative -- one statement whose plan depends on the planner folding a
--    parameter -- is the generic-plan trap above.
--
-- 3. The scope is resolved to a `uuid[]` BEFORE the query, so the row predicate is a
--    plain `territory_id = any(...)` with no OR in it. The RLS policies are
--    `territory_id in (...) OR is_admin()`, and that OR is separately fatal: a
--    disjunction with a non-indexable branch forces a scan of everything, which is
--    why the first attempt at this fix -- `security definer` with the policy
--    predicate transcribed verbatim, OR included -- still produced a Seq Scan at
--    2,310 ms. `is_admin()` does not depend on the row, so it belongs outside the
--    row predicate. An admin's scope is every territory, enumerated; `territory_id`
--    is `not null` on this table, so enumerating is exactly equivalent to the
--    admin policy's "all rows" and not merely close to it.
--
-- Behaviour is unchanged, and `field.spec.ts` proves it by running the OLD body
-- beside the new one over the same inputs (empty string, null, one character,
-- substring, accent, case) and asserting identical output.
--
-- Rollback: services/api/rollbacks/20260907000800_search_doctors_sargable.down.sql
-- ============================================================================

create or replace function public.search_doctors(
  p_query        text    default null,
  p_territory_id uuid    default null,
  p_limit        integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- Was `bounded` in the SQL body. Same arithmetic, same order of operations.
  v_lim    integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_scope  uuid[];
  v_result jsonb;
begin
  -- The caller's scope, resolved once and as a value, so the row predicate below can
  -- be indexed. `doctors_admin_all` is `using (is_admin())` and does not depend on
  -- the row, so for an admin the equivalent scope is every territory.
  if public.is_admin() then
    select array_agg(t.id) into v_scope from public.territories t;
  else
    select array_agg(t) into v_scope from public.current_user_visible_territory_ids() t;
  end if;
  -- A caller with no visible territories gets an empty list, not a null one: null
  -- would make `= any(null)` return null and the empty result would be an accident
  -- of three-valued logic rather than a decision.
  v_scope := coalesce(v_scope, '{}'::uuid[]);

  -- The two branches are deliberately near-duplicates. The only difference is the
  -- text predicate, and keeping them side by side is what makes it obvious that the
  -- listing branch and the search branch return the same shape. Factoring the shared
  -- half into a helper would hide exactly the thing a reader needs to check.
  if p_query is null or btrim(p_query) = '' then
    with matched as (
      -- One more than asked for, so truncation is measured rather than guessed at.
      select d.*
        from public.doctors d
       where d.is_active
         and (p_territory_id is null or d.territory_id = p_territory_id)
         and d.territory_id = any(v_scope)
       order by d.full_name
       limit v_lim + 1
    )
    select jsonb_build_object(
      'items', coalesce(
        (select jsonb_agg(to_jsonb(m) order by m.full_name)
           from (select * from matched order by full_name limit v_lim) m),
        '[]'::jsonb),
      'truncated', (select count(*) from matched) > v_lim,
      'limit', v_lim
    )
    into v_result;
  else
    with matched as (
      select d.*
        from public.doctors d
       where d.is_active
         and (p_territory_id is null or d.territory_id = p_territory_id)
         and d.territory_id = any(v_scope)
         and (
           d.full_name ilike '%' || p_query || '%'
           or d.specialty ilike '%' || p_query || '%'
           or d.registration_number = p_query
         )
       order by d.full_name
       limit v_lim + 1
    )
    select jsonb_build_object(
      'items', coalesce(
        (select jsonb_agg(to_jsonb(m) order by m.full_name)
           from (select * from matched order by full_name limit v_lim) m),
        '[]'::jsonb),
      'truncated', (select count(*) from matched) > v_lim,
      'limit', v_lim
    )
    into v_result;
  end if;

  return v_result;
end;
$$;

-- Supabase's default ACL grants `anon` EXECUTE on every new function in `public` and
-- no migration can change that default (FIX-06 D2), so every function revokes for
-- itself and `rls.spec.ts` fails the build if one forgets. `search_doctors` is now
-- `security definer`, which makes that revoke load-bearing rather than hygienic.
revoke execute on function public.search_doctors(text, uuid, integer) from public, anon;
grant execute on function public.search_doctors(text, uuid, integer) to authenticated;

comment on function public.search_doctors(text, uuid, integer) is
  'BE-W64. security definer so the trigram index can be used: an ILIKE is not '
  'leakproof and Postgres will not evaluate it before an RLS security qual, which '
  'made doctors_full_name_trgm_idx unusable and the search linear in table size. '
  'The scope predicate transcribes the two policies on public.doctors; '
  'field.spec.ts asserts the cross-territory refusal against this body directly.';
