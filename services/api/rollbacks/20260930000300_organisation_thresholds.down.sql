-- Rollback for W1-L Part C -- `app_thresholds` loses its organisation scope.
--
-- **What rolling back MEANS, and why this file can REFUSE to run.**
--
-- Dropping `organisation_id` drops every per-company setting with it. Each of those rows is
-- an override a company's admin chose, and removing it silently returns that company to the
-- `global` value -- **which for the AI feature flag means a company that switched AI OFF has
-- it switched back ON by a rollback.** That is not a rollback; it is an undisclosed change of
-- behaviour wearing a rollback's name.
--
-- **So this file stops if any organisation-scoped row exists** and prints how many. The
-- operator then makes the decision explicitly, which is the point: it should not be possible
-- to discard a per-company choice by running a script that looked routine.
--
-- To proceed deliberately, as `postgres`:
--
--     alter table public.app_thresholds disable trigger app_thresholds_reject_mutation;
--     delete from public.app_thresholds where scope = 'organisation';
--     alter table public.app_thresholds enable trigger app_thresholds_reject_mutation;
--
-- and then run this file again. **The trigger is disabled explicitly and by hand because the
-- table is append-only by design** -- see `20260815000100_thresholds_and_shift_defaults.sql`.
--
-- **Roll back the console's settings screen with this**, or it calls two functions that no
-- longer exist. Nothing else needs rolling back: `threshold()` and `threshold_number()` keep
-- their signatures through both directions, so the 52 call sites across 23 migrations are
-- untouched here exactly as they were untouched going forward.

do $$
declare
  v_rows bigint;
begin
  select count(*) into v_rows from public.app_thresholds where scope = 'organisation';
  if v_rows > 0 then
    raise exception
      'refusing to roll back: % organisation-scoped setting(s) would be destroyed. See the header of this file.',
      v_rows
      using errcode = '23001';
  end if;
end;
$$;

drop function if exists public.organisation_threshold(text);
drop function if exists public.set_organisation_threshold(text, jsonb, text);

-- The body restored here is the one that was installed before this migration, taken from
-- `pg_proc.prosrc` on the running database rather than retyped from the migration that first
-- created it -- `20260815000100` is not necessarily the last file to have redefined it.
create or replace function public.threshold(p_key text, p_territory_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select t.value
    from public.app_thresholds t
   where t.key = p_key
     and t.effective_from <= now()
     and (t.territory_id is null or t.territory_id = p_territory_id)
   order by (t.territory_id is not null) desc, t.effective_from desc
   limit 1;
$$;

alter table public.app_thresholds drop constraint if exists app_thresholds_unique_version;
alter table public.app_thresholds drop constraint if exists app_thresholds_scope_matches_ids;
alter table public.app_thresholds drop constraint if exists app_thresholds_scope_check;
drop index if exists public.app_thresholds_org_lookup_idx;

alter table public.app_thresholds drop column if exists organisation_id;

alter table public.app_thresholds
  add constraint app_thresholds_scope_check check (scope in ('global', 'territory'));
alter table public.app_thresholds
  add constraint app_thresholds_scope_matches_territory
  check ((scope = 'territory') = (territory_id is not null));
alter table public.app_thresholds
  add constraint app_thresholds_unique_version unique (key, territory_id, effective_from);
