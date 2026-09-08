-- ============================================================================
-- MR-06 B2 (1 of 2) - a USER gets an organisation, because today one does not have one
--
-- BE-W76 is usually stated as "no policy mentions organisation_id". That is true --
-- `select count(*) from pg_policy where pg_get_expr(polqual, polrelid) like
-- '%organisation_id%'` returns 0 of 45 -- but it is the symptom, not the cause.
--
-- THE CAUSE: `user_profiles` HAS NO ORGANISATION COLUMN. Only `doctors` and
-- `territories` carry `organisation_id` in the entire schema. A user's sole link to a
-- tenant is `territory_id -> territories.organisation_id`, and that link is optional:
--
--     user_profiles_field_roles_require_territory
--       CHECK (role = 'admin' OR territory_id IS NOT NULL)
--
-- The schema EXPLICITLY exempts an admin from having a territory, and `seedFixtures()`
-- duly creates one with `territory_id = null`. So an admin has no territory and no
-- organisation column: **there is no data path from an administrator to a tenant.**
-- No predicate could have been written, however carefully, because there was nothing to
-- write it against. That is why BE-W76 is a migration and not a one-line policy edit.
--
-- It also explains the shape of the leak precisely. MR and field_manager isolation is an
-- INCIDENTAL consequence of territory scoping -- they are excluded from another tenant
-- because that tenant's territories are not in their `visible_territory_ids`, not because
-- anything checked the tenant. `is_admin()` skips territory scoping entirely, and the
-- incidental protection leaves with it. The boundary was never built; it was inherited
-- from something else, and one role does not inherit it.
--
-- ----------------------------------------------------------------------------
-- THE DECISION THIS ENCODES: an admin is a TENANT ADMINISTRATOR
-- ----------------------------------------------------------------------------
--
-- Ratified by the reviewer, MR-06 section 3. An admin manages users, territories,
-- consent versions, retention and approvals FOR THEIR COMPANY; every one of those nouns
-- is tenant-scoped. Under DPDP each pharma company is a Data Fiduciary for its own data
-- and Praverse is a Processor, so a vendor employee reading a client's data is a
-- different actor with different legal standing and cannot share a role with the client's
-- own administrator -- not least because the audit log could then never answer the first
-- question asked after an incident: was that the client's admin, or ours?
--
-- **Platform access is therefore NOT this column.** It becomes a separate, audited
-- break-glass path with a typed reason recorded BEFORE data returns (S9), and it is out
-- of MR v1 scope. Building it now would be deliberately rebuilding the thing that just
-- failed.
--
-- ----------------------------------------------------------------------------
-- WHY A TRIGGER DERIVES IT RATHER THAN EVERY CALLER SUPPLYING IT
-- ----------------------------------------------------------------------------
--
-- `organisation_id` is NOT NULL, so it cannot be forgotten. But for a field role it is
-- also not a free choice: a user in a territory belongs to that territory's organisation
-- and to no other. A caller that could pass its own value could pass a WRONG one, and a
-- user labelled org X while standing in a territory of org Y is a tenancy hole wearing
-- the fix as a disguise.
--
-- So the trigger DERIVES it from the territory and REFUSES a contradiction, and the only
-- actor a human must decide for is the one whose organisation was genuinely undefined:
-- the admin, who has no territory. That is derivation from the catalog rather than a
-- hand-maintained list, which is this repo's rule, and it means the existing insert sites
-- for field roles keep working unchanged while every admin-creating site is forced to
-- state a tenant.
--
-- Rollback: services/api/rollbacks/20260908000800_user_profiles_organisation.down.sql
-- ============================================================================

alter table public.user_profiles add column organisation_id uuid;

comment on column public.user_profiles.organisation_id is
  'The tenant this user belongs to. Derived from territory_id by '
  'user_profiles_derive_organisation() for any user that has a territory, and required '
  'explicitly for one that does not (an admin). MR-06 / BE-W76: before this column a '
  'user had no organisation at all and the tenant boundary could not be expressed.';

-- Backfill 1: every user with a territory takes that territory's organisation. This is
-- the definition, not a guess, and it is exactly what the trigger enforces from here on.
update public.user_profiles p
   set organisation_id = t.organisation_id
  from public.territories t
 where t.id = p.territory_id;

-- Backfill 2: the users with no territory -- the admins. There is no derivation
-- available for them, so this either resolves unambiguously or it STOPS.
--
-- **It stops rather than guessing.** Picking an organisation for an administrator is
-- picking whose data they may read, and a migration that silently chose wrong would hand
-- one tenant's admin another tenant. With a single organisation present the answer is not
-- a choice; with more than one it is a decision that belongs to a human, and the
-- exception says so.
--
-- UNVERIFIED against production data: on a fresh database this block is a no-op, so the
-- single-organisation branch is exercised only by its test, not by CI's migration run.
do $$
declare
  v_orphans integer;
  v_orgs    integer;
  v_org     uuid;
begin
  select count(*) into v_orphans
    from public.user_profiles where organisation_id is null;

  if v_orphans = 0 then
    return;
  end if;

  select count(*), min(id) into v_orgs, v_org from public.organisations;

  if v_orgs = 1 then
    update public.user_profiles set organisation_id = v_org where organisation_id is null;
    raise notice 'MR-06: assigned % territory-less user(s) to the only organisation %',
      v_orphans, v_org;
  else
    raise exception
      'MR-06 / BE-W76: % user(s) have no territory and there are % organisations, so '
      'their tenant cannot be derived. Set user_profiles.organisation_id for each by '
      'hand BEFORE applying this migration. Choosing one for them is choosing whose '
      'data they may read.', v_orphans, v_orgs
      using errcode = '23502';
  end if;
end
$$;

alter table public.user_profiles alter column organisation_id set not null;

alter table public.user_profiles
  add constraint user_profiles_organisation_id_fkey
  foreign key (organisation_id) references public.organisations (id) on delete restrict;

-- Every organisation-scoped policy added by the next migration reads this column for the
-- current user and for the rows it filters, so it is on the hot path of every request.
create index user_profiles_organisation_id_idx
  on public.user_profiles (organisation_id);

-- ----------------------------------------------------------------------------
-- The trigger: derive, or refuse.
-- ----------------------------------------------------------------------------

create or replace function public.user_profiles_derive_organisation()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_org uuid;
begin
  if new.territory_id is not null then
    select t.organisation_id into v_org
      from public.territories t where t.id = new.territory_id;

    if v_org is null then
      -- The FK on territory_id raises this first for a missing territory; reaching it
      -- here would mean a territory row with a null organisation, which that column's
      -- NOT NULL forbids. Kept so the derivation can never silently produce null.
      raise exception 'territory % has no organisation', new.territory_id
        using errcode = '23503';
    end if;

    if new.organisation_id is not null and new.organisation_id <> v_org then
      raise exception
        'user_profiles.organisation_id % contradicts the organisation % of territory %',
        new.organisation_id, v_org, new.territory_id
        using errcode = '23514',
              hint = 'A user belongs to the organisation that owns their territory. Do '
                     'not pass a different one; leave organisation_id out and it is '
                     'derived.';
    end if;

    new.organisation_id := v_org;

  elsif new.role <> 'admin' then
    -- A field role with no territory is refused by
    -- `user_profiles_field_roles_require_territory`, which predates this trigger and is
    -- the more specific guard. It is named here rather than left to fire on its own
    -- because `organisation_id` is NOT NULL and would otherwise report a null violation
    -- first -- a true statement about the column that says nothing about the real
    -- problem, which is that the user has no territory.
    raise exception
      'user_profiles_field_roles_require_territory: a % must have a territory', new.role
      using errcode = '23514';

  elsif new.organisation_id is null then
    -- 23514 rather than 23502, and the choice is deliberate. `packages/core`'s
    -- SQLSTATE contract requires every code the database raises to have a client-side
    -- explanation, and `error-contract.spec.ts` fails the build in both directions. This
    -- is a provisioning-time refusal that no field client can reach, so minting it a
    -- refusal code of its own would add an entry to that map for something an MR can
    -- never see. `23514 -> invalid_for_this_record, actionable: false` is already in the
    -- contract and already true of this row.
    raise exception
      'a user with no territory must name its organisation explicitly'
      using errcode = '23514',
            detail = 'user_profiles_field_roles_require_territory permits a null '
                     'territory only for an admin, so this is an admin with no tenant.',
            hint   = 'An admin is a TENANT administrator (MR-06 section 3). Pass the '
                     'organisation_id of the company they administer. Platform-wide '
                     'access is a separate audited break-glass path, not this column.';
  end if;

  return new;
end
$$;

revoke execute on function public.user_profiles_derive_organisation() from public;

create trigger user_profiles_derive_organisation
  before insert or update of territory_id, organisation_id on public.user_profiles
  for each row execute function public.user_profiles_derive_organisation();

-- ----------------------------------------------------------------------------
-- The helper every organisation-scoped policy calls.
-- ----------------------------------------------------------------------------

create or replace function public.current_user_organisation_id()
returns uuid
language sql
stable
security definer
set search_path to ''
as $$
  select p.organisation_id
    from public.user_profiles p
   where p.id = (select auth.uid())
     and p.is_active;
$$;

comment on function public.current_user_organisation_id() is
  'The tenant of the calling user, or null for anon / no profile / a deactivated one. '
  'MR-06: the single expression of the organisation boundary. A null result scopes to '
  'nothing rather than to everything -- every caller compares with = and null = anything '
  'is null, which excludes the row rather than admitting it.';

revoke execute on function public.current_user_organisation_id() from public;
grant execute on function public.current_user_organisation_id() to authenticated;
