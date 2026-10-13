-- `BE-W185` -- users and roles, administered from the console instead of by hand.
--
-- **What existed.** `docs/DEPLOY-RUNBOOK.md` step 4 made every account by hand: a dashboard "Add
-- user", then an INSERT into `user_profiles` typed into the SQL editor. The runbook lists the five
-- mistakes that path accepts SILENTLY: `admin` typed for a rep, a valid but wrong territory, a
-- mistyped territory (`INSERT 0 0` -- no profile, no error), no reporting manager, and "Auto-confirm"
-- left unticked. The schema refuses three other mistakes; it refuses none of these five.
--
-- **What this adds.** Every profile write the console makes is one of the functions below, called as
-- the signed-in admin, checked against the caller's organisation, and audited twice: the existing
-- `user_profiles_audit` trigger records the row change, and each function adds a row carrying the
-- admin's stated reason. Each of the five becomes impossible or a named refusal:
--
--   | mistake                     | now                                                              |
--   | `admin` for a rep           | the admin role needs the person's email typed again (`admin_confirmation_mismatch`) |
--   | a wrong territory           | picked from the company's own tree; read back on the Users screen  |
--   | a mistyped territory        | an id, never a code; an id outside the company is `territory_not_in_organisation` |
--   | no reporting manager        | a rep without one is `rep_needs_manager`                          |
--   | auto-confirm unticked       | the account is created confirmed by `admin-accounts`; an unconfirmed one is `account_unconfirmed` |
--
-- **The account itself is not created here.** A sign-in account is GoTrue's, and creating one needs
-- the service role, which this database cannot hold and must not. The `admin-accounts` Edge Function
-- (`BE-W186`) does it, between `admin_begin_user_creation` and `admin_finish_user_creation`, both
-- called AS THE ADMIN -- so who may create whom is decided here, not in the function.
--
-- **Why a provisioning row.** Creating an account and its profile are two systems, and the second
-- can fail after the first succeeded. The row is the record that the first was asked for: it is
-- scoped to the admin's company, so the Users screen can list "started, not finished" and finish or
-- cancel it, and an auth user without a profile is never left unnoticed. Listing every profile-less
-- auth user instead would show one company's admin another company's half-made accounts.
--
-- **Never a delete.** A `user_profiles` row cannot be deleted (the delete cascades into append-only
-- tables, measured 10 October). Deactivation is the only removal, as the runbook says.
--
-- **The direct table paths are NOT withdrawn here.** `user_profiles_admin_all` still lets an admin
-- write the table over REST. Withdrawing it is the house rule and is left as a reviewed step of its
-- own (`BE-W185` notes), because RLS suites written before this migration exercise that path.
--
-- Rollback: services/api/rollbacks/20261013000200_console_user_admin.down.sql

-- ---------------------------------------------------------------------------
-- 1. The provisioning record
-- ---------------------------------------------------------------------------

create table public.user_provisioning (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete restrict,
  email                text not null,
  full_name            text not null,
  role                 public.app_role not null,
  territory_id         uuid references public.territories (id) on delete set null,
  reporting_manager_id uuid references public.user_profiles (id) on delete restrict,
  -- An account that already existed (made in the dashboard, with no profile) is ADOPTED rather than
  -- created: `admin-accounts` then creates nothing and sets no password.
  adopt_existing       boolean not null default false,
  requested_by_user_id uuid not null references public.user_profiles (id) on delete restrict,
  requested_at         timestamptz not null default clock_timestamp(),
  state                text not null default 'open',
  auth_user_id         uuid,
  closed_by_user_id    uuid references public.user_profiles (id) on delete restrict,
  closed_at            timestamptz,
  close_note           text,
  constraint user_provisioning_email_normalised
    check (email = lower(btrim(email)) and char_length(email) between 3 and 254
           and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint user_provisioning_full_name_check check (char_length(btrim(full_name)) between 1 and 200),
  constraint user_provisioning_state_check check (state in ('open', 'completed', 'cancelled')),
  constraint user_provisioning_closed_consistently
    check ((state = 'open') = (closed_at is null and closed_by_user_id is null)),
  constraint user_provisioning_completed_names_account
    check ((state = 'completed') = (auth_user_id is not null))
);

-- One creation in flight per address, across every company: two admins racing for one address
-- would otherwise both reach GoTrue, and the second would fail AFTER its row was written.
create unique index user_provisioning_one_open_per_email
  on public.user_provisioning (email) where state = 'open';
create index user_provisioning_organisation_idx on public.user_provisioning (organisation_id, state);

-- No policy at all: reached only through the functions below, like `audit_log`.
alter table public.user_provisioning enable row level security;
alter table public.user_provisioning force row level security;
revoke all on public.user_provisioning from public, anon, authenticated, service_role;

create trigger user_provisioning_audit after insert or update on public.user_provisioning
  for each row execute function public.write_audit_row();

-- ---------------------------------------------------------------------------
-- 2. Internal helpers -- granted to nobody; called from the functions below
-- ---------------------------------------------------------------------------

-- The caller, when they are an ACTIVE admin. `effective_role()`'s rule, read from the table rather
-- than the JWT: a role claim lives an hour, and a deactivated admin must stop at once.
create or replace function public.console_admin()
returns public.user_profiles
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_me public.user_profiles;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into v_me from public.user_profiles p where p.id = (select auth.uid());
  if v_me.id is null or v_me.role is distinct from 'admin' or v_me.is_active is not true then
    raise exception 'not_an_admin: only an active admin administers users and territories'
      using errcode = '42501';
  end if;
  return v_me;
end;
$$;

-- How deep a territory sits: 1 = National, 2 = Region, 3 = Area/Territory
-- (`check-territory-sheet.mjs`'s levels; the table stores no level, so depth is the level).
create or replace function public.territory_depth(p_territory_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_cursor uuid := p_territory_id;
  v_depth  integer := 0;
begin
  while v_cursor is not null and v_depth < 64 loop
    v_depth := v_depth + 1;
    select t.parent_id into v_cursor from public.territories t where t.id = v_cursor;
    if not found then
      return null;
    end if;
  end loop;
  return v_depth;
end;
$$;

-- An audit row that carries the admin's reason. The row change itself is the trigger's.
create or replace function public.console_audit(
  p_me     public.user_profiles,
  p_action public.audit_action,
  p_table  text,
  p_row_id text,
  p_reason text
)
returns bigint
language sql
volatile
security definer
set search_path to ''
as $$
  insert into public.audit_log
    (actor_id, actor_role, action, table_name, row_id, reason, request_id, ip_address, occurred_at)
  values
    (p_me.id, p_me.role, p_action, p_table, p_row_id, p_reason,
     public.current_request_id(), public.current_client_ip(), clock_timestamp())
  returning id;
$$;

-- The one rule for what a profile may look like, for creation, change and reactivation alike.
-- Raises the first problem with a stable token at the start of its message; the console names each.
create or replace function public.validate_console_profile(
  p_org        uuid,
  p_user_id    uuid,
  p_role       public.app_role,
  p_territory  uuid,
  p_manager    uuid
)
returns void
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_territory public.territories;
  v_manager   public.user_profiles;
  v_depth     integer;
begin
  if p_role is null then
    raise exception 'role_required: choose a role' using errcode = '22023';
  end if;

  if p_role = 'admin' then
    if p_territory is not null then
      raise exception 'admin_has_no_territory: an admin administers the whole company and has no territory'
        using errcode = '22023';
    end if;
    if p_manager is not null then
      raise exception 'admin_has_no_manager: an admin reports to nobody in this system'
        using errcode = '22023';
    end if;
    return;
  end if;

  if p_territory is null then
    raise exception 'territory_required: a % must have a territory', p_role using errcode = '22023';
  end if;
  select * into v_territory from public.territories t where t.id = p_territory;
  if v_territory.id is null or v_territory.organisation_id <> p_org then
    raise exception 'territory_not_in_organisation: territory % is not one of your company''s', p_territory
      using errcode = '42501';
  end if;

  if p_role = 'mr' then
    -- A rep works the bottom of the tree: an Area/Territory, never a National or Region row that
    -- has territories beneath it (`check-territory-sheet.mjs`, `mr_territory_level`). A two-level
    -- tree's lower level is that bottom too, which is why "no children, not the root" is the rule
    -- rather than "depth 3".
    v_depth := public.territory_depth(p_territory);
    if v_territory.parent_id is null
       or exists (select 1 from public.territories c where c.parent_id = p_territory) then
      raise exception 'territory_level_for_rep: a rep is placed on an Area/Territory -- the lowest level of its branch -- and % is not', v_territory.code
        using errcode = '22023',
              hint = format('%s sits at level %s and has territories beneath it or none above it.',
                            v_territory.code, v_depth);
    end if;
    if p_manager is null then
      raise exception 'rep_needs_manager: a rep must report to a manager, or nobody sees their work'
        using errcode = '22023';
    end if;
  end if;

  if p_manager is not null then
    select * into v_manager from public.user_profiles m where m.id = p_manager;
    if v_manager.id is null or v_manager.organisation_id <> p_org or v_manager.is_active is not true
       or v_manager.role not in ('field_manager', 'admin') then
      raise exception 'manager_invalid: the manager must be an active field manager or admin of your company'
        using errcode = '22023';
    end if;
    if p_user_id is not null and v_manager.id = p_user_id then
      raise exception 'manager_invalid: nobody reports to themselves' using errcode = '22023';
    end if;
    -- A field manager plans and reviews the reps in their own subtree; a rep outside it would be a
    -- report the manager cannot plan for. An admin manager sees the whole company, so is exempt.
    if v_manager.role = 'field_manager'
       and p_territory not in (select public.visible_territory_ids(v_manager.id)) then
      raise exception 'manager_does_not_cover_territory: % does not cover territory %', v_manager.full_name, v_territory.code
        using errcode = '22023',
              hint = 'Choose a manager whose territory contains this one, or move the manager first.';
    end if;
  end if;
end;
$$;

-- One user as the Users screen shows them.
create or replace function public.console_user_json(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select jsonb_build_object(
    'id',            p.id,
    'email',         u.email,
    'fullName',      p.full_name,
    'role',          p.role,
    'territoryId',   p.territory_id,
    'territoryName', t.name,
    'territoryCode', t.code,
    'managerId',     p.reporting_manager_id,
    'managerName',   m.full_name,
    'isActive',      p.is_active,
    'confirmed',     u.email_confirmed_at is not null,
    'lastSignInAt',  u.last_sign_in_at,
    'createdAt',     p.created_at,
    'activeReports', (select count(*)::integer from public.user_profiles r
                       where r.reporting_manager_id = p.id and r.is_active))
    from public.user_profiles p
    left join auth.users u on u.id = p.id
    left join public.territories t on t.id = p.territory_id
    left join public.user_profiles m on m.id = p.reporting_manager_id
   where p.id = p_user_id;
$$;

-- ---------------------------------------------------------------------------
-- 3. The reads
-- ---------------------------------------------------------------------------

-- Every user of the admin's company, and every creation started and not finished. Emails are
-- personal data, so the read is audited with a reason, as `list_audit_log` is.
create or replace function public.admin_list_users(p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_me    public.user_profiles := public.console_admin();
  v_audit bigint;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'reason_required: reading the user list requires a reason' using errcode = '22023';
  end if;
  v_audit := public.console_audit(v_me, 'select', 'user_profiles', null, p_reason);

  return jsonb_build_object(
    'users', coalesce((
      select jsonb_agg(public.console_user_json(p.id) order by p.is_active desc, p.role, p.full_name)
        from public.user_profiles p where p.organisation_id = v_me.organisation_id), '[]'::jsonb),
    'pending', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',                 v.id,
               'email',              v.email,
               'fullName',           v.full_name,
               'role',               v.role,
               'territoryId',        v.territory_id,
               'managerId',          v.reporting_manager_id,
               'adoptExisting',      v.adopt_existing,
               'requestedAt',        v.requested_at,
               'requestedBy',        r.full_name,
               'accountExists',      u.id is not null,
               'accountConfirmed',   u.email_confirmed_at is not null,
               'accountHasProfile',  exists (select 1 from public.user_profiles x where x.id = u.id))
             order by v.requested_at)
        from public.user_provisioning v
        join public.user_profiles r on r.id = v.requested_by_user_id
        left join auth.users u on lower(u.email) = v.email
       where v.organisation_id = v_me.organisation_id and v.state = 'open'), '[]'::jsonb),
    'readAt', clock_timestamp(),
    'auditLogId', v_audit);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Creating a user: begin -> (the Edge Function makes the account) -> finish, or cancel
-- ---------------------------------------------------------------------------

create or replace function public.admin_begin_user_creation(
  p_email              text,
  p_full_name          text,
  p_role               public.app_role,
  p_territory_id       uuid,
  p_reporting_manager_id uuid,
  p_admin_confirmation text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_me      public.user_profiles := public.console_admin();
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_account auth.users;
  v_row     public.user_provisioning;
begin
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(v_email) > 254 then
    raise exception 'email_invalid: % is not an email address', coalesce(p_email, '(empty)')
      using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_full_name, ''))) not between 1 and 200 then
    raise exception 'name_required: give the person''s full name' using errcode = '22023';
  end if;

  perform public.validate_console_profile(
    v_me.organisation_id, null, p_role, p_territory_id, p_reporting_manager_id);

  -- The runbook's first silent mistake: `admin` typed for a rep reads the whole company. Making
  -- someone an admin is a deliberate act, so the address is typed twice.
  if p_role = 'admin' and lower(btrim(coalesce(p_admin_confirmation, ''))) <> v_email then
    raise exception 'admin_confirmation_mismatch: type the new admin''s email again to confirm the admin role'
      using errcode = '22023';
  end if;

  select * into v_account from auth.users u where lower(u.email) = v_email;
  if v_account.id is not null
     and exists (select 1 from public.user_profiles p where p.id = v_account.id) then
    raise exception 'account_exists: % already has an account', v_email using errcode = '23505';
  end if;

  if exists (select 1 from public.user_provisioning v where v.email = v_email and v.state = 'open') then
    raise exception 'provisioning_open: a creation for % is already in progress -- finish or cancel it on the Users screen', v_email
      using errcode = '23505';
  end if;

  insert into public.user_provisioning
    (organisation_id, email, full_name, role, territory_id, reporting_manager_id, adopt_existing,
     requested_by_user_id)
  values
    (v_me.organisation_id, v_email, btrim(p_full_name), p_role, p_territory_id,
     p_reporting_manager_id, v_account.id is not null, v_me.id)
  returning * into v_row;

  return jsonb_build_object(
    'provisioningId', v_row.id,
    'email',          v_row.email,
    'existingAccount', v_row.adopt_existing);
end;
$$;

create or replace function public.admin_finish_user_creation(p_provisioning_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_me      public.user_profiles := public.console_admin();
  v_row     public.user_provisioning;
  v_account auth.users;
begin
  select * into v_row from public.user_provisioning v
   where v.id = p_provisioning_id and v.organisation_id = v_me.organisation_id
   for update;
  if v_row.id is null then
    raise exception 'provisioning_not_found: that creation is not one of your company''s'
      using errcode = '42501';
  end if;
  if v_row.state <> 'open' then
    raise exception 'provisioning_closed: that creation was already %', v_row.state using errcode = '22023';
  end if;

  select * into v_account from auth.users u where lower(u.email) = v_row.email;
  if v_account.id is null then
    raise exception 'account_missing: no sign-in account exists for % yet', v_row.email
      using errcode = '22023',
            hint = 'Creating the account failed or has not run. Cancel this and create the user again.';
  end if;
  -- The runbook's fifth silent mistake: an unconfirmed account cannot sign in.
  if v_account.email_confirmed_at is null then
    raise exception 'account_unconfirmed: the account for % is not confirmed and cannot sign in', v_row.email
      using errcode = '22023';
  end if;
  if exists (select 1 from public.user_profiles p where p.id = v_account.id) then
    raise exception 'account_exists: % already has a profile', v_row.email using errcode = '23505';
  end if;

  -- Checked again: a territory or a manager can have changed since the creation began.
  perform public.validate_console_profile(
    v_me.organisation_id, v_account.id, v_row.role, v_row.territory_id, v_row.reporting_manager_id);

  insert into public.user_profiles
    (id, full_name, role, territory_id, reporting_manager_id, organisation_id)
  values
    (v_account.id, v_row.full_name, v_row.role, v_row.territory_id, v_row.reporting_manager_id,
     v_me.organisation_id);

  update public.user_provisioning
     set state = 'completed', auth_user_id = v_account.id,
         closed_by_user_id = v_me.id, closed_at = clock_timestamp()
   where id = v_row.id;

  perform public.console_audit(v_me, 'insert', 'user_profiles', v_account.id::text,
    format('created %s as %s', v_row.email, v_row.role));

  return public.console_user_json(v_account.id);
end;
$$;

create or replace function public.admin_cancel_user_creation(p_provisioning_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_me  public.user_profiles := public.console_admin();
  v_row public.user_provisioning;
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'reason_required: say why the creation is cancelled' using errcode = '22023';
  end if;
  select * into v_row from public.user_provisioning v
   where v.id = p_provisioning_id and v.organisation_id = v_me.organisation_id
   for update;
  if v_row.id is null then
    raise exception 'provisioning_not_found: that creation is not one of your company''s'
      using errcode = '42501';
  end if;
  if v_row.state <> 'open' then
    raise exception 'provisioning_closed: that creation was already %', v_row.state using errcode = '22023';
  end if;
  update public.user_provisioning
     set state = 'cancelled', closed_by_user_id = v_me.id, closed_at = clock_timestamp(),
         close_note = btrim(p_reason)
   where id = v_row.id;
  return jsonb_build_object('provisioningId', v_row.id, 'state', 'cancelled');
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Changing a user
-- ---------------------------------------------------------------------------

-- Role, territory, manager and name, as one write: they are checked as a combination, because each
-- rule (a rep's territory level, a rep's manager, a manager's cover) involves two of them.
create or replace function public.admin_update_user(
  p_user_id              uuid,
  p_full_name            text,
  p_role                 public.app_role,
  p_territory_id         uuid,
  p_reporting_manager_id uuid,
  p_admin_confirmation   text,
  p_reason               text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_me     public.user_profiles := public.console_admin();
  v_target public.user_profiles;
  v_email  text;
  v_n      integer;
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'reason_required: say why -- the reason is kept in the audit log' using errcode = '22023';
  end if;
  select * into v_target from public.user_profiles p
   where p.id = p_user_id and p.organisation_id = v_me.organisation_id
   for update;
  if v_target.id is null then
    raise exception 'user_not_found: that user is not one of your company''s' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_full_name, ''))) not between 1 and 200 then
    raise exception 'name_required: give the person''s full name' using errcode = '22023';
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_target.id;

  if v_target.id = v_me.id and p_role is distinct from v_target.role then
    raise exception 'self_role_change: you cannot change your own role -- another admin must'
      using errcode = '42501';
  end if;

  if p_role = 'admin' and v_target.role <> 'admin'
     and lower(btrim(coalesce(p_admin_confirmation, ''))) is distinct from v_email then
    raise exception 'admin_confirmation_mismatch: type this person''s email again to confirm the admin role'
      using errcode = '22023';
  end if;

  -- No "last admin" guard is needed: the caller is an active admin of this company and is never
  -- the target (`self_role_change`), so demoting the target always leaves the caller.

  -- A manager who stops managing would leave their reps reporting to a rep, which
  -- `validate_reporting_manager` refuses only for the REP's next write -- i.e. never.
  if p_role = 'mr' and v_target.role <> 'mr' then
    select count(*) into v_n from public.user_profiles r
     where r.reporting_manager_id = v_target.id and r.is_active;
    if v_n > 0 then
      raise exception 'has_reports: % active rep(s) report to this person -- give them another manager first', v_n
        using errcode = '22023';
    end if;
  end if;

  -- A field manager moved to a territory that no longer covers their reps.
  if p_role = 'field_manager' and p_territory_id is not null then
    select count(*) into v_n from public.user_profiles r
     where r.reporting_manager_id = v_target.id and r.is_active
       and r.territory_id is not null
       and r.territory_id not in (
         with recursive sub as (
           select t.id from public.territories t where t.id = p_territory_id
           union
           select c.id from public.territories c join sub s on c.parent_id = s.id
         ) select sub.id from sub);
    if v_n > 0 then
      raise exception 'reports_outside_territory: % active rep(s) reporting to this manager are outside that territory', v_n
        using errcode = '22023',
              hint = 'Give those reps another manager, or choose a territory that contains theirs.';
    end if;
  end if;

  perform public.validate_console_profile(
    v_me.organisation_id, v_target.id, p_role, p_territory_id, p_reporting_manager_id);

  update public.user_profiles
     set full_name = btrim(p_full_name), role = p_role, territory_id = p_territory_id,
         reporting_manager_id = p_reporting_manager_id,
         -- An admin names its organisation explicitly (`user_profiles_derive_organisation`).
         organisation_id = v_me.organisation_id
   where id = v_target.id;

  perform public.console_audit(v_me, 'update', 'user_profiles', v_target.id::text,
    format('%s -> role %s; reason: %s', coalesce(v_email, v_target.id::text), p_role, btrim(p_reason)));

  return public.console_user_json(v_target.id);
end;
$$;

-- Deactivate or reactivate. Never a delete (see the header).
create or replace function public.admin_set_user_active(
  p_user_id uuid,
  p_active  boolean,
  p_reason  text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_me     public.user_profiles := public.console_admin();
  v_target public.user_profiles;
  v_n      integer;
begin
  if p_active is null then
    raise exception 'active_required: say whether the user is active' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'reason_required: say why -- the reason is kept in the audit log' using errcode = '22023';
  end if;
  select * into v_target from public.user_profiles p
   where p.id = p_user_id and p.organisation_id = v_me.organisation_id
   for update;
  if v_target.id is null then
    raise exception 'user_not_found: that user is not one of your company''s' using errcode = '42501';
  end if;
  if v_target.id = v_me.id then
    raise exception 'self_deactivate: you cannot change your own access -- another admin must'
      using errcode = '42501';
  end if;
  if v_target.is_active = p_active then
    return public.console_user_json(v_target.id);
  end if;

  if not p_active then
    -- No "last admin" guard: the caller is an active admin and is never the target.
    select count(*) into v_n from public.user_profiles r
     where r.reporting_manager_id = v_target.id and r.is_active;
    if v_n > 0 then
      raise exception 'has_reports: % active rep(s) report to this person -- give them another manager first', v_n
        using errcode = '22023';
    end if;
  else
    -- Coming back, the profile must still be valid: its territory may have moved, its manager left.
    perform public.validate_console_profile(
      v_me.organisation_id, v_target.id, v_target.role, v_target.territory_id,
      v_target.reporting_manager_id);
  end if;

  update public.user_profiles set is_active = p_active where id = v_target.id;

  perform public.console_audit(v_me, 'update', 'user_profiles', v_target.id::text,
    format('%s; reason: %s', case when p_active then 'reactivated' else 'deactivated' end, btrim(p_reason)));

  return public.console_user_json(v_target.id);
end;
$$;

-- `admin-accounts` resets a password only after this says the caller may, and this is what writes
-- the audit row. It records the REQUEST: the function reports the outcome to the admin.
create or replace function public.admin_authorize_password_reset(p_user_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_me     public.user_profiles := public.console_admin();
  v_target public.user_profiles;
  v_email  text;
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'reason_required: say why the password is being reset' using errcode = '22023';
  end if;
  select * into v_target from public.user_profiles p
   where p.id = p_user_id and p.organisation_id = v_me.organisation_id;
  if v_target.id is null then
    raise exception 'user_not_found: that user is not one of your company''s' using errcode = '42501';
  end if;
  if v_target.id = v_me.id then
    raise exception 'self_password_reset: change your own password from the sign-in page, not here'
      using errcode = '42501';
  end if;
  select u.email into v_email from auth.users u where u.id = v_target.id;
  perform public.console_audit(v_me, 'update', 'auth.users', v_target.id::text,
    format('password reset requested; reason: %s', btrim(p_reason)));
  return jsonb_build_object('userId', v_target.id, 'email', v_email);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants: the eight console functions to `authenticated`; the helpers to nobody
-- ---------------------------------------------------------------------------

revoke execute on function public.console_admin() from public, anon, authenticated;
revoke execute on function public.territory_depth(uuid) from public, anon, authenticated;
revoke execute on function public.console_audit(public.user_profiles, public.audit_action, text, text, text) from public, anon, authenticated;
revoke execute on function public.validate_console_profile(uuid, uuid, public.app_role, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.console_user_json(uuid) from public, anon, authenticated;

revoke execute on function public.admin_list_users(text) from public, anon;
revoke execute on function public.admin_begin_user_creation(text, text, public.app_role, uuid, uuid, text) from public, anon;
revoke execute on function public.admin_finish_user_creation(uuid) from public, anon;
revoke execute on function public.admin_cancel_user_creation(uuid, text) from public, anon;
revoke execute on function public.admin_update_user(uuid, text, public.app_role, uuid, uuid, text, text) from public, anon;
revoke execute on function public.admin_set_user_active(uuid, boolean, text) from public, anon;
revoke execute on function public.admin_authorize_password_reset(uuid, text) from public, anon;

grant execute on function public.admin_list_users(text) to authenticated;
grant execute on function public.admin_begin_user_creation(text, text, public.app_role, uuid, uuid, text) to authenticated;
grant execute on function public.admin_finish_user_creation(uuid) to authenticated;
grant execute on function public.admin_cancel_user_creation(uuid, text) to authenticated;
grant execute on function public.admin_update_user(uuid, text, public.app_role, uuid, uuid, text, text) to authenticated;
grant execute on function public.admin_set_user_active(uuid, boolean, text) to authenticated;
grant execute on function public.admin_authorize_password_reset(uuid, text) to authenticated;
