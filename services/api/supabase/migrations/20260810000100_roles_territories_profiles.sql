-- ============================================================================
-- BE-W1 · Roles, territories, user profiles and the two JWT helper functions
--
-- Scope note: this migration deliberately contains no commercial schema
-- (doctors, visits, call reports) and no clinical schema of any kind. Commercial
-- tables land in BE-W2. There is no patient data in this database, ever.
--
-- Rollback: services/api/rollbacks/20260810000100_roles_territories_profiles.down.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Role enum
-- ----------------------------------------------------------------------------

-- Exactly three roles. Adding a fourth is a schema change and a review conversation,
-- which is the point of using an enum rather than a text column.
create type public.app_role as enum ('mr', 'field_manager', 'admin');

-- ----------------------------------------------------------------------------
-- 2. Shared updated_at trigger
-- ----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger helper. Keeps updated_at honest regardless of what the caller sends.';

-- ----------------------------------------------------------------------------
-- 3. Territories — hierarchical, self-referencing
-- ----------------------------------------------------------------------------

create table public.territories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) > 0),
  code        text not null unique check (length(btrim(code)) > 0),
  -- null at the root of the hierarchy. `restrict` so a parent cannot be deleted
  -- out from under its children and orphan a manager's subtree.
  parent_id   uuid references public.territories (id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint territories_no_self_parent check (parent_id is null or parent_id <> id)
);

create index territories_parent_id_idx on public.territories (parent_id);

create trigger territories_set_updated_at
  before update on public.territories
  for each row execute function public.set_updated_at();

comment on table public.territories is
  'Sales territory hierarchy. An MR sees one; a field manager sees their own subtree.';

-- ----------------------------------------------------------------------------
-- 4. User profiles
-- ----------------------------------------------------------------------------

-- Email is deliberately NOT duplicated here. It lives on auth.users and is read
-- from the session; a second copy is a second thing to keep in sync and a second
-- place it can be wrong.
create table public.user_profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  full_name            text not null check (length(btrim(full_name)) > 0),
  role                 public.app_role not null,
  territory_id         uuid references public.territories (id) on delete restrict,
  reporting_manager_id uuid references public.user_profiles (id) on delete set null,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint user_profiles_no_self_manager
    check (reporting_manager_id is null or reporting_manager_id <> id),
  -- An MR or a field manager without a territory has no scope at all, which would
  -- silently mean "sees nothing" and read as a bug. Admins legitimately have none.
  constraint user_profiles_field_roles_require_territory
    check (role = 'admin' or territory_id is not null)
);

create index user_profiles_territory_id_idx on public.user_profiles (territory_id);
create index user_profiles_reporting_manager_id_idx on public.user_profiles (reporting_manager_id);
create index user_profiles_role_idx on public.user_profiles (role);

create trigger user_profiles_set_updated_at
  before update on public.user_profiles
  for each row execute function public.set_updated_at();

comment on table public.user_profiles is
  'One row per auth user: exactly one role, one territory, one reporting manager, one active flag.';

-- ----------------------------------------------------------------------------
-- 5. Custom access token hook — puts the role into the JWT
-- ----------------------------------------------------------------------------

-- Registered in supabase/config.toml under [auth.hook.custom_access_token].
-- Runs as supabase_auth_admin at token issue time.
--
-- Consequence worth knowing: a role change takes effect on the next token refresh,
-- not instantly. Deactivating a user must therefore also be enforced by policy,
-- not only by this claim.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role        public.app_role;
  v_territory   uuid;
  v_is_active   boolean;
  v_claims      jsonb;
begin
  select p.role, p.territory_id, p.is_active
    into v_role, v_territory, v_is_active
    from public.user_profiles p
   where p.id = (event ->> 'user_id')::uuid;

  v_claims := coalesce(event -> 'claims', '{}'::jsonb);

  if v_role is not null then
    v_claims := jsonb_set(v_claims, '{app_role}', to_jsonb(v_role::text));
    v_claims := jsonb_set(v_claims, '{app_is_active}', to_jsonb(v_is_active));
    if v_territory is not null then
      v_claims := jsonb_set(v_claims, '{app_territory_id}', to_jsonb(v_territory::text));
    end if;
  end if;

  return jsonb_set(event, '{claims}', v_claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

-- ----------------------------------------------------------------------------
-- 6. Helper 1 — the caller's role, from their JWT
-- ----------------------------------------------------------------------------

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
set search_path = ''
as $$
  select nullif(auth.jwt() ->> 'app_role', '')::public.app_role;
$$;

comment on function public.current_app_role() is
  'The caller''s role, read from the app_role JWT claim set by custom_access_token_hook. '
  'Returns null for an unauthenticated caller or a user with no profile.';

-- ----------------------------------------------------------------------------
-- 7. Helper 2 — the territory ids a given user may see
-- ----------------------------------------------------------------------------

-- mr             -> their own territory, and nothing else
-- field_manager  -> their own territory plus every territory beneath it
-- admin          -> all territories
-- inactive user  -> nothing
--
-- SECURITY DEFINER because it must read user_profiles and territories regardless
-- of the caller's own policies. It takes an arbitrary user id, so EXECUTE is NOT
-- granted to authenticated — an MR must not be able to enumerate a colleague's
-- scope. Client code uses current_user_visible_territory_ids() below.
create or replace function public.visible_territory_ids(p_user_id uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
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

  -- No profile, or deactivated: no scope at all.
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

  -- field_manager: own territory plus the whole subtree below it.
  return query
    with recursive subtree as (
      select t.id from public.territories t where t.id = v_territory
      union all
      select c.id from public.territories c join subtree s on c.parent_id = s.id
    )
    select subtree.id from subtree;
end;
$$;

create or replace function public.current_user_visible_territory_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select public.visible_territory_ids((select auth.uid()));
$$;

comment on function public.current_user_visible_territory_ids() is
  'The caller''s own visible territory set. The safe, grantable wrapper around visible_territory_ids.';

-- ----------------------------------------------------------------------------
-- 8. Row-level security
-- ----------------------------------------------------------------------------

-- RLS is on from the first table, not retrofitted in week 2. There is no INSERT,
-- UPDATE or DELETE policy on either table, so writes by `authenticated` are denied.
-- Provisioning happens through service_role until the admin APIs land in week 11.
--
-- FORCE is deliberately not used here: the SECURITY DEFINER helpers above run as
-- the table owner and FORCE would subject them to these same policies, which would
-- make them return nothing. Append-only tables in BE-W2 (audit_log, consent_records)
-- have different requirements and are handled there.

alter table public.territories   enable row level security;
alter table public.user_profiles enable row level security;

create policy user_profiles_select_self
  on public.user_profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

-- The auth server needs to read profiles to mint the role claim.
create policy user_profiles_select_auth_admin
  on public.user_profiles
  for select
  to supabase_auth_admin
  using (true);

create policy territories_select_visible
  on public.territories
  for select
  to authenticated
  using (id in (select public.current_user_visible_territory_ids()));

-- ----------------------------------------------------------------------------
-- 9. Grants
-- ----------------------------------------------------------------------------

-- Revoke first, then grant exactly what is needed.
--
-- This is not defensive noise. Supabase's default privileges hand `authenticated`
-- and `anon` a TRUNCATE grant on new public tables even when the Data API is not
-- auto-exposing them, and TRUNCATE ignores row-level security completely. Verified
-- by services/api/tests/foundations.spec.ts, which fails if this block is removed.
revoke all on table public.territories   from anon, authenticated;
revoke all on table public.user_profiles from anon, authenticated;

grant select on table public.territories   to authenticated;
grant select on table public.user_profiles to authenticated;
grant select on table public.user_profiles to supabase_auth_admin;

grant execute on function public.current_app_role() to authenticated;
grant execute on function public.current_user_visible_territory_ids() to authenticated;

-- Not granted to authenticated on purpose: see the comment above the function.
revoke execute on function public.visible_territory_ids(uuid) from public, anon, authenticated;
grant execute on function public.visible_territory_ids(uuid) to service_role;
