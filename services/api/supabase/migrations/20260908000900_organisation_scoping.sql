-- ============================================================================
-- MR-06 B2 (2 of 2) - the organisation boundary, on all five paths
--
-- The previous migration gave a user a tenant. This one enforces it.
--
-- ----------------------------------------------------------------------------
-- WHERE THE SCOPING GOES, AND WHY THAT IS RIGHT RATHER THAN CONVENIENT
-- ----------------------------------------------------------------------------
--
-- Three placements were available (MR-06 B2): inside `is_admin()`, inside the two scoping
-- functions, or in each policy. The answer is not one of them -- it is TWO of them, and
-- the split follows the structure of the schema rather than taste.
--
-- **NOT in `is_admin()`.** That function answers "is this caller an administrator", which
-- is a question about ROLE. Folding a tenant test into it would make one predicate answer
-- two questions, and the next reader would have no way to tell which of the two a given
-- call site meant. `is_admin()` is left exactly as it is.
--
-- **In `visible_user_ids()` and `visible_territory_ids()` -- the two scoping functions --
-- for everything that already delegates to them.** This is the large half and it is the
-- important one:
--
--   * ~30 of the 45 policies are already `... in (select public.visible_user_ids())` or
--     `... in (select public.current_user_visible_territory_ids())`.
--   * EIGHTEEN SECURITY DEFINER functions call `visible_user_ids()` -- `team_activity`,
--     `coverage`, `mr_activity_detail`, `approvable_call_reports`, `approve_call_report`,
--     `list_consent_records`, `read_consent_record`, `daily_mileage`, `team_exceptions`,
--     `list_analyses`, `list_analysis_overrides`, `read_analysis`,
--     `create_analysis_override`, `overdue_call_reports`, `my_upload_queue`,
--     `sync_queue_status`, `list_sync_rejections`, `reinstate_sync_item`.
--
--   Every one of those is cross-tenant for an admin today, and every one of them is
--   closed by changing two `if v_role = 'admin'` branches. Adding a predicate to each
--   instead would be a hand-maintained list of thirty policies and eighteen functions --
--   and this repo's own rule is that a control invoked by a hand-maintained list will
--   eventually be left off it. Deriving from the two functions everything already calls
--   IS deriving from the catalog.
--
-- **In the policies directly, for the six that BYPASS those functions.** The
-- `*_admin_all` policies are `using (is_admin())` with no scoping call at all, so no
-- change to a scoping function can reach them. They are the reference-data tables --
-- organisations, doctors, territories, territory_shift_windows, clinic_addresses,
-- user_profiles -- and each gets an explicit tenant predicate here.
--
-- ----------------------------------------------------------------------------
-- TWO HOLES THAT WOULD HAVE LET THE NEW PREDICATE BE WALKED AROUND
-- ----------------------------------------------------------------------------
--
-- Found while writing the above, and closed here, because a boundary that can be stepped
-- over is a boundary that looks fixed and is not:
--
--   1. **`territories.parent_id` had no same-organisation constraint.** Only
--      `territories_no_self_parent` and a cycle trigger existed. A territory in org A
--      could be parented to one in org B, and the field_manager subtree walk in
--      `visible_territory_ids()` follows `parent_id` -- so a manager's scope could leave
--      their tenant through the tree itself, with every policy behaving correctly.
--
--   2. **`doctors.organisation_id` and `doctors.territory_id` could disagree.** Both are
--      NOT NULL and nothing tied them together. A doctor labelled org A while sitting in
--      a territory of org B is readable by org B through `doctors_select_in_territory`
--      (territory-based) no matter what the new org-based admin predicate says. The org
--      column would have been decorative on exactly the table the matrix probes.
--
-- Both are now derived or refused rather than trusted, for the same reason
-- `user_profiles.organisation_id` is: a value a caller can set wrong is a value that will
-- be set wrong.
--
-- Rollback: services/api/rollbacks/20260908000900_organisation_scoping.down.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Integrity: a tenant's tree and its doctors stay inside the tenant.
-- ----------------------------------------------------------------------------

create or replace function public.territories_parent_same_organisation()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_parent_org uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  select t.organisation_id into v_parent_org
    from public.territories t where t.id = new.parent_id;

  if v_parent_org is distinct from new.organisation_id then
    raise exception
      'territory % is in organisation % but its parent % is in organisation %',
      new.id, new.organisation_id, new.parent_id, v_parent_org
      using errcode = '23514',
            hint = 'A territory tree belongs to one tenant. Cross-organisation parenting '
                   'would let a field_manager subtree walk leave its own organisation.';
  end if;

  return new;
end
$$;

revoke execute on function public.territories_parent_same_organisation() from public;

create trigger territories_parent_same_organisation
  before insert or update of parent_id, organisation_id on public.territories
  for each row execute function public.territories_parent_same_organisation();

create or replace function public.doctors_derive_organisation()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_org uuid;
begin
  select t.organisation_id into v_org
    from public.territories t where t.id = new.territory_id;

  if v_org is null then
    raise exception 'territory % has no organisation', new.territory_id
      using errcode = '23503';
  end if;

  if new.organisation_id is not null and new.organisation_id <> v_org then
    raise exception
      'doctor.organisation_id % contradicts the organisation % of territory %',
      new.organisation_id, v_org, new.territory_id
      using errcode = '23514',
            hint = 'A doctor belongs to the organisation that owns their territory. '
                   'Leave organisation_id out and it is derived.';
  end if;

  new.organisation_id := v_org;
  return new;
end
$$;

revoke execute on function public.doctors_derive_organisation() from public;

create trigger doctors_derive_organisation
  before insert or update of territory_id, organisation_id on public.doctors
  for each row execute function public.doctors_derive_organisation();

-- ----------------------------------------------------------------------------
-- 2. The two scoping functions. The admin branches stop meaning "everything".
-- ----------------------------------------------------------------------------

create or replace function public.visible_territory_ids(p_user_id uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path to ''
set statement_timeout to '5s'
as $$
declare
  v_role      public.app_role;
  v_territory uuid;
  v_is_active boolean;
  v_org       uuid;
begin
  select p.role, p.territory_id, p.is_active, p.organisation_id
    into v_role, v_territory, v_is_active, v_org
    from public.user_profiles p
   where p.id = p_user_id;

  -- No profile, or deactivated: no scope at all.
  if v_role is null or v_is_active is not true then
    return;
  end if;

  -- MR-06 / BE-W76. Without an organisation there is no scope, rather than every scope.
  -- `organisation_id` is NOT NULL, so this is unreachable through the table; it is here
  -- because the alternative reading of a null -- "unscoped" -- is the exact shape of the
  -- defect this migration closes, and it should be impossible to reintroduce by accident.
  if v_org is null then
    return;
  end if;

  if v_role = 'admin' then
    -- WAS: `select t.id from public.territories t` -- every territory in every tenant.
    -- An admin is a TENANT administrator (MR-06 section 3), so their scope is their own
    -- organisation's tree and nothing else.
    return query
      select t.id from public.territories t where t.organisation_id = v_org;
    return;
  end if;

  if v_territory is null then
    return;
  end if;

  if v_role = 'mr' then
    return query select v_territory;
    return;
  end if;

  -- field_manager: own territory plus the whole subtree below it.
  --
  -- The CYCLE clause is not optional. territories_no_self_parent blocks A -> A but
  -- nothing blocks A -> B -> A, and an unguarded recursive CTE over a cycle does not
  -- error -- it runs until the timeout above, which is a hang, not a failure.
  --
  -- The `organisation_id = v_org` filter is belt and braces alongside the new
  -- territories_parent_same_organisation trigger: the trigger stops a cross-tenant parent
  -- being WRITTEN, and this stops one already in the table being WALKED. A boundary
  -- enforced only at write time is a boundary that trusts every row already there.
  return query
    with recursive subtree as (
      select t.id, t.organisation_id
        from public.territories t
       where t.id = v_territory and t.organisation_id = v_org
      union all
      select c.id, c.organisation_id
        from public.territories c
        join subtree s on c.parent_id = s.id
       where c.organisation_id = v_org
    ) cycle id set is_cycle using path
    select subtree.id from subtree where not subtree.is_cycle;
end
$$;

revoke execute on function public.visible_territory_ids(uuid) from public;

create or replace function public.visible_user_ids()
returns setof uuid
language plpgsql
stable
security definer
set search_path to ''
set statement_timeout to '5s'
as $$
declare
  v_uid       uuid;
  v_role      public.app_role;
  v_is_active boolean;
  v_org       uuid;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    return;
  end if;

  select p.role, p.is_active, p.organisation_id
    into v_role, v_is_active, v_org
    from public.user_profiles p
   where p.id = v_uid;

  if v_role is null or v_is_active is not true then
    return;
  end if;

  -- MR-06 / BE-W76: no organisation, no scope. See visible_territory_ids().
  if v_org is null then
    return;
  end if;

  if v_role = 'admin' then
    -- WAS: `select p.id from public.user_profiles p` -- EVERY user profile in EVERY
    -- tenant. This single line is what made the eighteen SECURITY DEFINER console
    -- functions and the ~30 `mr_id in (select visible_user_ids())` policies read across
    -- the tenant boundary for an admin.
    return query
      select p.id from public.user_profiles p where p.organisation_id = v_org;
    return;
  end if;

  if v_role = 'mr' then
    return query select v_uid;
    return;
  end if;

  -- field_manager. Duplicates across the three branches are harmless: every caller
  -- uses this as `... in (select public.visible_user_ids())`.
  return query select v_uid;

  return query
    select p.id from public.user_profiles p
     where p.territory_id in (select public.visible_territory_ids(v_uid))
       and p.organisation_id = v_org;

  return query
    with recursive reports as (
      select p.id, p.organisation_id
        from public.user_profiles p
       where p.reporting_manager_id = v_uid and p.organisation_id = v_org
      union all
      select c.id, c.organisation_id
        from public.user_profiles c
        join reports r on c.reporting_manager_id = r.id
       where c.organisation_id = v_org
    ) cycle id set is_cycle using path
    select reports.id from reports where not reports.is_cycle;
end
$$;

revoke execute on function public.visible_user_ids() from public;

-- ----------------------------------------------------------------------------
-- 3. `search_doctors` stops transcribing the policy by hand.
-- ----------------------------------------------------------------------------
--
-- The old body carried its own copy of the admin rule:
--
--     if public.is_admin() then
--       select array_agg(t.id) into v_scope from public.territories t;   -- every tenant
--     else
--       select array_agg(t) into v_scope from public.current_user_visible_territory_ids() t;
--
-- with the comment "for an admin the equivalent scope is every territory". That was a
-- true statement about the old policy and it is a false one now, which is precisely the
-- failure mode the G-RLS-C `function` cell exists to catch: a SECURITY DEFINER function
-- restating a policy it does not share. The branch is DELETED rather than corrected --
-- one expression of the rule, in `visible_territory_ids()`, which the admin branch above
-- now scopes. There is nothing left here to fall out of step.

create or replace function public.search_doctors(
  p_query text default null,
  p_territory_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_lim    integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_scope  uuid[];
  v_result jsonb;
begin
  -- The caller's scope, resolved once and as a value, so the row predicate below can be
  -- indexed. One source for every role, admin included -- see the note above.
  select array_agg(t) into v_scope from public.current_user_visible_territory_ids() t;

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
end
$$;

revoke execute on function public.search_doctors(text, uuid, integer) from public;
grant execute on function public.search_doctors(text, uuid, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. The six policies that bypass the scoping functions entirely.
-- ----------------------------------------------------------------------------
--
-- Each was `using (is_admin()) with check (is_admin())` -- a role test with no tenant in
-- it. Each now carries the tenant explicitly, because nothing else in the request path
-- will do it for them.

drop policy if exists organisations_admin_all on public.organisations;
create policy organisations_admin_all on public.organisations
  for all to authenticated
  using (public.is_admin() and id = public.current_user_organisation_id())
  with check (public.is_admin() and id = public.current_user_organisation_id());

-- And the reason `organisations` needed more than its admin policy: every authenticated
-- user could read EVERY organisation. `organisations_select_authenticated` was
-- `using (true)`, so an MR at one pharmaceutical company could enumerate the names of
-- every other client on the platform. Not doctor data, but the client list is the most
-- commercially sensitive thing a multi-tenant vendor holds, and "true" is not a scope.
drop policy if exists organisations_select_authenticated on public.organisations;
create policy organisations_select_own on public.organisations
  for select to authenticated
  using (id = public.current_user_organisation_id());

drop policy if exists doctors_admin_all on public.doctors;
create policy doctors_admin_all on public.doctors
  for all to authenticated
  using (public.is_admin() and organisation_id = public.current_user_organisation_id())
  with check (public.is_admin() and organisation_id = public.current_user_organisation_id());

drop policy if exists territories_admin_all on public.territories;
create policy territories_admin_all on public.territories
  for all to authenticated
  using (public.is_admin() and organisation_id = public.current_user_organisation_id())
  with check (public.is_admin() and organisation_id = public.current_user_organisation_id());

drop policy if exists user_profiles_admin_all on public.user_profiles;
create policy user_profiles_admin_all on public.user_profiles
  for all to authenticated
  using (public.is_admin() and organisation_id = public.current_user_organisation_id())
  with check (public.is_admin() and organisation_id = public.current_user_organisation_id());

-- clinic_addresses has no organisation of its own; it reaches one through its doctor.
drop policy if exists clinic_addresses_admin_all on public.clinic_addresses;
create policy clinic_addresses_admin_all on public.clinic_addresses
  for all to authenticated
  using (
    public.is_admin()
    and doctor_id in (
      select d.id from public.doctors d
       where d.organisation_id = public.current_user_organisation_id())
  )
  with check (
    public.is_admin()
    and doctor_id in (
      select d.id from public.doctors d
       where d.organisation_id = public.current_user_organisation_id())
  );

-- territory_shift_windows likewise, through its territory.
drop policy if exists territory_shift_windows_admin_all on public.territory_shift_windows;
create policy territory_shift_windows_admin_all on public.territory_shift_windows
  for all to authenticated
  using (
    public.is_admin()
    and territory_id in (
      select t.id from public.territories t
       where t.organisation_id = public.current_user_organisation_id())
  )
  with check (
    public.is_admin()
    and territory_id in (
      select t.id from public.territories t
       where t.organisation_id = public.current_user_organisation_id())
  );
