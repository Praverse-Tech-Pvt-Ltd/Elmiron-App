-- FIX-05 — the oversight record.
--
-- `POST /analyses/:id/overrides` has been declared in the contract since BE-W6 and had
-- no backend at all: no table, no function, no column. `services/mock` answered it with
-- `201` and a fabricated row, and `apps/console` rendered that row.
--
-- `docs/fe-w3-spec.md` calls this row **"the evidence of human oversight"**, and §3.6 —
-- a regulatory line against showing a manager an AI analysis of a named employee — was
-- reversed on the strength of it. A manager could believe they had corrected a finding
-- about a named person and nothing was recorded anywhere. Oversight that does not
-- persist is not oversight.
--
-- Nothing was live: the console has never been deployed. This is a pre-release defect,
-- which is the only good time to find one.

-- ----------------------------------------------------------------------------
-- 1. The table
-- ----------------------------------------------------------------------------
--
-- `finding_id` carries **no foreign key**, and that is recorded rather than hidden:
-- there is no findings table in this schema. The contract has always declared
-- `findingId` as nullable, and the analysis engine that will produce findings is
-- weeks 8-10 and may be cut. A FK to a table that does not exist cannot be written,
-- and inventing the table to satisfy one column would be worse.
create table public.analysis_overrides (
  id                     uuid primary key default gen_random_uuid(),
  analysis_id            uuid not null references public.analyses(id) on delete restrict,
  finding_id             uuid,
  overridden_by_user_id  uuid not null references public.user_profiles(id) on delete restrict,
  reason                 text not null,
  created_at             timestamptz not null default now(),

  -- A click is not oversight. `CreateAnalysisOverrideRequestSchema.reason` is
  -- `.min(1)` and the database agrees, because this row is the evidence that somebody
  -- thought rather than that somebody clicked.
  constraint analysis_overrides_reason_not_blank check (length(btrim(reason)) > 0)
);

comment on table public.analysis_overrides is
  'Append-only record of a human overriding a machine finding. The artefact §3.6 was '
  'reversed on the strength of. Never edited, never deleted, by any role.';

create index analysis_overrides_analysis_idx
  on public.analysis_overrides (analysis_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 2. Append-only, enforced the way audit_log is
-- ----------------------------------------------------------------------------
--
-- A statement-level trigger, not a policy: `service_role` and the table owner hold
-- BYPASSRLS and never see a policy, so a policy would protect this from everybody
-- except the two roles most able to rewrite history. `reject_mutation` raises for
-- UPDATE, DELETE and TRUNCATE regardless of who is asking.
create trigger analysis_overrides_reject_mutation
  before delete or update or truncate on public.analysis_overrides
  for each statement execute function public.reject_mutation();

create trigger analysis_overrides_audit
  after insert on public.analysis_overrides
  for each row execute function public.write_audit_row();

-- ----------------------------------------------------------------------------
-- 3. No policies, matching `analyses`
-- ----------------------------------------------------------------------------
--
-- RLS enabled and forced with no policy at all, so direct table access is a genuine
-- `permission denied` rather than an empty result. Every read and write goes through
-- the two functions below, which is the same shape `analyses` already uses and the
-- reason it has no policies either.
alter table public.analysis_overrides enable row level security;
alter table public.analysis_overrides force row level security;

revoke all on public.analysis_overrides from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Write
-- ----------------------------------------------------------------------------
--
-- Overriding is the manager's act. An MR may read what was said about them — see
-- below — but may not override an analysis, including their own: a finding an MR
-- could erase is not oversight of the MR.
--
-- Out of scope raises `42501`. It does **not** return null. The reads in
-- `read_analysis` return null for an invisible row and that was settled as acceptable
-- on 10 August because no client consumes them; this one has a client, and a UI cannot
-- render a denial as a denial if the server returns nothing.
create function public.create_analysis_override(
  p_analysis_id uuid,
  p_finding_id  uuid,
  p_reason      text
)
returns public.analysis_overrides
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid;
  v_role public.app_role;
  v_row  public.analysis_overrides%rowtype;
begin
  v_uid  := (select auth.uid());
  v_role := public.current_app_role();

  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if v_role not in ('field_manager', 'admin') then
    raise exception 'only a manager may override a finding'
      using errcode = '42501';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'an override requires a reason'
      using errcode = '22023',
            hint = 'A row with no reason proves a click happened, not that anybody thought.';
  end if;

  -- Scope, before anything is written.
  if not exists (
    select 1 from public.analyses a
     where a.id = p_analysis_id
       and (v_role = 'admin' or a.mr_id in (select public.visible_user_ids()))
  ) then
    raise exception 'analysis % is not within your scope', p_analysis_id
      using errcode = '42501';
  end if;

  insert into public.analysis_overrides
    (analysis_id, finding_id, overridden_by_user_id, reason)
  values
    (p_analysis_id, p_finding_id, v_uid, btrim(p_reason))
  returning * into v_row;

  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Read
-- ----------------------------------------------------------------------------
--
-- An MR may read overrides on analyses about themselves. Being able to see what a
-- manager recorded about you is the half of the design that makes the system
-- contestable, and `visible_user_ids()` already returns the caller's own id for an MR.
create function public.list_analysis_overrides(
  p_analysis_id uuid,
  p_reason      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid;
  v_role     public.app_role;
  v_rows     jsonb;
  v_audit_id bigint;
begin
  v_uid  := (select auth.uid());
  v_role := public.current_app_role();

  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if v_role = 'admin' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'admin access to an override requires a reason'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.analyses a
     where a.id = p_analysis_id
       and (v_role = 'admin' or a.mr_id in (select public.visible_user_ids()))
  ) then
    raise exception 'analysis % is not within your scope', p_analysis_id
      using errcode = '42501';
  end if;

  -- Audit first. If this throws, nothing is returned.
  insert into public.audit_log
    (actor_id, actor_role, action, table_name, row_id, reason, request_id, ip_address,
     occurred_at)
  values
    (v_uid, v_role, 'select', 'analysis_overrides', p_analysis_id::text, p_reason,
     public.current_request_id(), public.current_client_ip(), clock_timestamp())
  returning id into v_audit_id;

  select coalesce(jsonb_agg(to_jsonb(o) order by o.created_at desc), '[]'::jsonb)
    into v_rows
    from public.analysis_overrides o
   where o.analysis_id = p_analysis_id;

  return jsonb_build_object('data', v_rows, 'readAt', clock_timestamp(),
                            'auditLogId', v_audit_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Grants — explicit, and PUBLIC revoked
-- ----------------------------------------------------------------------------
--
-- Born with the second control FIX-05 Part C adds to the older functions. Postgres
-- grants EXECUTE to PUBLIC on a new function by default, which leaves the function's
-- own `auth.uid()` check as the only thing standing between `anon` and the body.
revoke execute on function public.create_analysis_override(uuid, uuid, text) from public;
revoke execute on function public.list_analysis_overrides(uuid, text) from public;
grant execute on function public.create_analysis_override(uuid, uuid, text) to authenticated;
grant execute on function public.list_analysis_overrides(uuid, text) to authenticated;
