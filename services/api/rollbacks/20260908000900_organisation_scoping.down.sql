-- Rollback for 20260908000900_organisation_scoping.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- **This reopens BE-W76 in full.** It restores the exact pre-MR-06 behaviour: an
-- administrator's scope becomes every territory and every user profile in every tenant,
-- `search_doctors` goes back to transcribing the admin rule by hand as "every territory",
-- and `organisations` becomes readable in its entirety by any authenticated user -- so
-- one client can enumerate every other client on the platform.
--
-- Apply this BEFORE 20260908000800's rollback: the policies below stop referencing
-- `current_user_organisation_id()`, which that file drops.
--
-- It also removes the two integrity triggers, which is the less obvious half. Without
-- `territories_parent_same_organisation` a territory tree may again be parented across
-- tenants, and without `doctors_derive_organisation` a doctor's `organisation_id` may
-- again disagree with the organisation of the territory they sit in. Any row written
-- while those triggers were absent is NOT re-checked when they are recreated.

drop trigger if exists doctors_derive_organisation on public.doctors;
drop function if exists public.doctors_derive_organisation();

drop trigger if exists territories_parent_same_organisation on public.territories;
drop function if exists public.territories_parent_same_organisation();

-- ---- the six policies, back to a role test with no tenant in it ----

drop policy if exists organisations_admin_all on public.organisations;
create policy organisations_admin_all on public.organisations
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists organisations_select_own on public.organisations;
create policy organisations_select_authenticated on public.organisations
  for select to authenticated
  using (true);

drop policy if exists doctors_admin_all on public.doctors;
create policy doctors_admin_all on public.doctors
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists territories_admin_all on public.territories;
create policy territories_admin_all on public.territories
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists user_profiles_admin_all on public.user_profiles;
create policy user_profiles_admin_all on public.user_profiles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists clinic_addresses_admin_all on public.clinic_addresses;
create policy clinic_addresses_admin_all on public.clinic_addresses
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists territory_shift_windows_admin_all on public.territory_shift_windows;
create policy territory_shift_windows_admin_all on public.territory_shift_windows
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---- the scoping functions, back to "everything" for an admin ----

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
begin
  select p.role, p.territory_id, p.is_active
    into v_role, v_territory, v_is_active
    from public.user_profiles p
   where p.id = p_user_id;

  if v_role is null or v_is_active is not true then
    return;
  end if;

  if v_role = 'admin' then
    return query select t.id from public.territories t;
    return;
  end if;

  if v_territory is null then
    return;
  end if;

  if v_role = 'mr' then
    return query select v_territory;
    return;
  end if;

  return query
    with recursive subtree as (
      select t.id from public.territories t where t.id = v_territory
      union all
      select c.id from public.territories c join subtree s on c.parent_id = s.id
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
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    return;
  end if;

  select p.role, p.is_active into v_role, v_is_active
    from public.user_profiles p
   where p.id = v_uid;

  if v_role is null or v_is_active is not true then
    return;
  end if;

  if v_role = 'admin' then
    return query select p.id from public.user_profiles p;
    return;
  end if;

  if v_role = 'mr' then
    return query select v_uid;
    return;
  end if;

  return query select v_uid;

  return query
    select p.id from public.user_profiles p
     where p.territory_id in (select public.visible_territory_ids(v_uid));

  return query
    with recursive reports as (
      select p.id from public.user_profiles p where p.reporting_manager_id = v_uid
      union all
      select c.id
        from public.user_profiles c
        join reports r on c.reporting_manager_id = r.id
    ) cycle id set is_cycle using path
    select reports.id from reports where not reports.is_cycle;
end
$$;

revoke execute on function public.visible_user_ids() from public;

-- ---- search_doctors, back to carrying its own copy of the admin rule ----

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
  if public.is_admin() then
    select array_agg(t.id) into v_scope from public.territories t;
  else
    select array_agg(t) into v_scope from public.current_user_visible_territory_ids() t;
  end if;
  v_scope := coalesce(v_scope, '{}'::uuid[]);

  if p_query is null or btrim(p_query) = '' then
    with matched as (
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
