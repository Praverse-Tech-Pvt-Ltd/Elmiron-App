-- ============================================================================
-- BE-W2 · The security boundary
--
-- Every RLS policy and every grant in the schema, in one file, so the boundary can
-- be read as a single document rather than reconstructed from six migrations.
--
-- Two rules this file follows without exception:
--
--   1. Revoke, then grant. Supabase's default privileges hand `authenticated` and
--      `anon` a TRUNCATE grant on new public tables, and TRUNCATE ignores RLS.
--   2. RLS is ENABLE + FORCE on every table. FORCE does not stop a BYPASSRLS role
--      (measured — see 20260811000100), so nothing here relies on it to constrain
--      `service_role`. Immutability is enforced by triggers, which BYPASSRLS does
--      not skip.
--
-- Authorization reads the ROLE FROM user_profiles, not from the JWT claim. The
-- claim is refreshed at most once per token lifetime (1 hour), so a demoted or
-- deactivated user would keep their old powers for up to an hour. current_app_role()
-- remains as the BE-W1 deliverable and is fine for display; it is not the
-- authorization source. This closes BE-W1 open question 3.
--
-- Rollback: services/api/rollbacks/20260811000400_rls_policies.down.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Authorization helpers that read the profile, not the token
-- ----------------------------------------------------------------------------

create or replace function public.effective_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
    from public.user_profiles p
   where p.id = (select auth.uid())
     and p.is_active;
$$;

comment on function public.effective_role() is
  'The caller''s role as stored, not as claimed. Deactivated users get null. '
  'Every policy in this schema authorizes against this, never against the JWT.';

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.effective_role() = 'admin', false);
$$;

-- ----------------------------------------------------------------------------
-- 2. Enable and force RLS on everything added in BE-W2
-- ----------------------------------------------------------------------------

alter table public.organisations          enable row level security;
alter table public.doctors                enable row level security;
alter table public.clinic_addresses       enable row level security;
alter table public.beat_plans             enable row level security;
alter table public.beat_plan_entries      enable row level security;
alter table public.visits                 enable row level security;
alter table public.check_ins              enable row level security;
alter table public.check_outs             enable row level security;
alter table public.call_reports           enable row level security;
alter table public.samples_and_inputs     enable row level security;
alter table public.analyses               enable row level security;
alter table public.consent_text_versions  enable row level security;
alter table public.consent_records        enable row level security;
alter table public.audit_log              enable row level security;

alter table public.organisations          force row level security;
alter table public.doctors                force row level security;
alter table public.clinic_addresses       force row level security;
alter table public.beat_plans             force row level security;
alter table public.beat_plan_entries      force row level security;
alter table public.visits                 force row level security;
alter table public.check_ins              force row level security;
alter table public.check_outs             force row level security;
alter table public.call_reports           force row level security;
alter table public.samples_and_inputs     force row level security;
alter table public.analyses               force row level security;
alter table public.consent_text_versions  force row level security;
alter table public.consent_records        force row level security;
alter table public.audit_log              force row level security;

-- ----------------------------------------------------------------------------
-- 3. Revoke every default privilege
-- ----------------------------------------------------------------------------

revoke all on table public.organisations         from anon, authenticated;
revoke all on table public.doctors               from anon, authenticated;
revoke all on table public.clinic_addresses      from anon, authenticated;
revoke all on table public.beat_plans            from anon, authenticated;
revoke all on table public.beat_plan_entries     from anon, authenticated;
revoke all on table public.visits                from anon, authenticated;
revoke all on table public.check_ins             from anon, authenticated;
revoke all on table public.check_outs            from anon, authenticated;
revoke all on table public.call_reports          from anon, authenticated;
revoke all on table public.samples_and_inputs    from anon, authenticated;
revoke all on table public.analyses              from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Organisations — the employer's own name. Readable, never writable.
-- ----------------------------------------------------------------------------

create policy organisations_select_authenticated
  on public.organisations for select to authenticated
  using (true);

create policy organisations_admin_all
  on public.organisations for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select on table public.organisations to authenticated;
grant insert, update, delete on table public.organisations to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Territories — BE-W1 policy stands; admin gains write
-- ----------------------------------------------------------------------------

create policy territories_admin_all
  on public.territories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant insert, update, delete on table public.territories to authenticated;

-- ----------------------------------------------------------------------------
-- 6. User profiles — self read stands; admin gains full access
-- ----------------------------------------------------------------------------

-- A field manager can see the profiles of people in their scope. Without this a
-- manager can read their team's visits but not learn whose they are.
create policy user_profiles_select_team
  on public.user_profiles for select to authenticated
  using (id in (select public.visible_user_ids()));

create policy user_profiles_admin_all
  on public.user_profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant insert, update, delete on table public.user_profiles to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Doctors and clinic addresses — read within territory
-- ----------------------------------------------------------------------------

create policy doctors_select_in_territory
  on public.doctors for select to authenticated
  using (territory_id in (select public.current_user_visible_territory_ids()));

create policy doctors_admin_all
  on public.doctors for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select on table public.doctors to authenticated;
grant insert, update, delete on table public.doctors to authenticated;

create policy clinic_addresses_select_visible_doctor
  on public.clinic_addresses for select to authenticated
  using (
    doctor_id in (
      select d.id from public.doctors d
       where d.territory_id in (select public.current_user_visible_territory_ids())
    )
  );

create policy clinic_addresses_admin_all
  on public.clinic_addresses for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select on table public.clinic_addresses to authenticated;
grant insert, update, delete on table public.clinic_addresses to authenticated;

-- ----------------------------------------------------------------------------
-- 8. Beat plans — an MR owns their own; a manager reads their team's
-- ----------------------------------------------------------------------------

create policy beat_plans_select_own_or_team
  on public.beat_plans for select to authenticated
  using (mr_id in (select public.visible_user_ids()));

create policy beat_plans_insert_own
  on public.beat_plans for insert to authenticated
  with check (mr_id = (select auth.uid()));

create policy beat_plans_update_own
  on public.beat_plans for update to authenticated
  using (mr_id = (select auth.uid()))
  with check (mr_id = (select auth.uid()));

grant select, insert, update on table public.beat_plans to authenticated;

create policy beat_plan_entries_select_via_plan
  on public.beat_plan_entries for select to authenticated
  using (
    beat_plan_id in (
      select b.id from public.beat_plans b where b.mr_id in (select public.visible_user_ids())
    )
  );

create policy beat_plan_entries_write_own_plan
  on public.beat_plan_entries for all to authenticated
  using (
    beat_plan_id in (select b.id from public.beat_plans b where b.mr_id = (select auth.uid()))
  )
  with check (
    beat_plan_id in (select b.id from public.beat_plans b where b.mr_id = (select auth.uid()))
  );

grant select, insert, update, delete on table public.beat_plan_entries to authenticated;

-- ----------------------------------------------------------------------------
-- 9. Visits, check-ins, check-outs
-- ----------------------------------------------------------------------------

create policy visits_select_own_or_team
  on public.visits for select to authenticated
  using (mr_id in (select public.visible_user_ids()));

create policy visits_insert_own
  on public.visits for insert to authenticated
  with check (mr_id = (select auth.uid()));

create policy visits_update_own
  on public.visits for update to authenticated
  using (mr_id = (select auth.uid()))
  with check (mr_id = (select auth.uid()));

grant select, insert, update on table public.visits to authenticated;

create policy check_ins_select_own_or_team
  on public.check_ins for select to authenticated
  using (mr_id in (select public.visible_user_ids()));

-- The visit must also be the caller's own. Without the second clause an MR could
-- attach a check-in to somebody else's visit while still passing the mr_id test.
create policy check_ins_insert_own
  on public.check_ins for insert to authenticated
  with check (
    mr_id = (select auth.uid())
    and visit_id in (select v.id from public.visits v where v.mr_id = (select auth.uid()))
  );

grant select, insert on table public.check_ins to authenticated;

create policy check_outs_select_own_or_team
  on public.check_outs for select to authenticated
  using (mr_id in (select public.visible_user_ids()));

create policy check_outs_insert_own
  on public.check_outs for insert to authenticated
  with check (
    mr_id = (select auth.uid())
    and visit_id in (select v.id from public.visits v where v.mr_id = (select auth.uid()))
  );

grant select, insert on table public.check_outs to authenticated;

-- ----------------------------------------------------------------------------
-- 10. Call reports — authored by the MR, approved by someone else
-- ----------------------------------------------------------------------------

create policy call_reports_select_own_or_team
  on public.call_reports for select to authenticated
  using (mr_id in (select public.visible_user_ids()));

create policy call_reports_insert_own
  on public.call_reports for insert to authenticated
  with check (
    mr_id = (select auth.uid())
    and status <> 'approved'
    and visit_id in (select v.id from public.visits v where v.mr_id = (select auth.uid()))
  );

-- An MR may move their own report draft -> submitted. They cannot approve it: the
-- WITH CHECK forbids the approved status, and approval is only reachable through
-- public.approve_call_report, which rejects the author.
create policy call_reports_update_own_not_approval
  on public.call_reports for update to authenticated
  using (mr_id = (select auth.uid()))
  with check (mr_id = (select auth.uid()) and status <> 'approved');

grant select, insert, update on table public.call_reports to authenticated;

-- ----------------------------------------------------------------------------
-- 11. Samples and inputs
-- ----------------------------------------------------------------------------

create policy samples_and_inputs_select_own_or_team
  on public.samples_and_inputs for select to authenticated
  using (mr_id in (select public.visible_user_ids()));

create policy samples_and_inputs_insert_own
  on public.samples_and_inputs for insert to authenticated
  with check (
    mr_id = (select auth.uid())
    and visit_id in (select v.id from public.visits v where v.mr_id = (select auth.uid()))
  );

grant select, insert on table public.samples_and_inputs to authenticated;

-- ----------------------------------------------------------------------------
-- 12. Analyses — no direct access for anyone, at any role
-- ----------------------------------------------------------------------------

-- RLS is enabled and forced, and there is deliberately NO policy and NO grant for
-- `authenticated`. A direct SELECT is a genuine permission denied, which is exactly
-- what amendment criterion 3 requires where there is no grant.
--
-- Reads go through public.read_analysis / public.list_analyses, which write the
-- audit row before returning. That is how "every read of an analysis is logged"
-- is true for MRs and managers, not only for admins.

grant execute on function public.read_analysis(uuid, text)  to authenticated;
grant execute on function public.list_analyses(uuid, text)  to authenticated;
grant execute on function public.respond_to_analysis(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 13. Consent — text is readable, records are write-only for the field
-- ----------------------------------------------------------------------------

-- The MR's device must fetch the exact text it is about to display, so the version
-- table is readable. It is immutable at the trigger layer.
create policy consent_text_versions_select_authenticated
  on public.consent_text_versions for select to authenticated
  using (true);

grant select on table public.consent_text_versions to authenticated;

-- Records: INSERT only, own captures only. No SELECT grant — reads go through the
-- logged RPCs, same as analyses. There is no UPDATE or DELETE policy for any role,
-- and the statement-level trigger refuses both regardless of RLS.
create policy consent_records_insert_own
  on public.consent_records for insert to authenticated
  with check (
    captured_by_mr_id = (select auth.uid())
    and visit_id in (select v.id from public.visits v where v.mr_id = (select auth.uid()))
  );

grant insert on table public.consent_records to authenticated;

grant execute on function public.read_consent_record(uuid, text)  to authenticated;
grant execute on function public.list_consent_records(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 14. Audit log — no read, no write, no policy, for anyone but BYPASSRLS roles
-- ----------------------------------------------------------------------------

-- No policy and no grant is not an omission. Nothing in the app reads the audit
-- log this week; the admin audit console is week 11 and will read it through a
-- logged RPC of its own.

-- ----------------------------------------------------------------------------
-- 15. Views — security_invoker, always
-- ----------------------------------------------------------------------------

-- A view is a bypass vector by default. It runs with the privileges and the RLS
-- context of its OWNER, and every view here is owned by postgres, which holds
-- BYPASSRLS. Without `security_invoker = true` this view would hand every MR the
-- entire company's visit history through a table they are otherwise walled out of.
--
-- services/api/tests/rls.spec.ts asserts that EVERY view in the public schema has
-- security_invoker set, so the next view someone adds cannot quietly omit it.
create view public.visit_summary
with (security_invoker = true) as
  select
    v.id            as visit_id,
    v.mr_id,
    v.doctor_id,
    v.status        as visit_status,
    v.started_at,
    v.completed_at,
    d.full_name     as doctor_name,
    d.territory_id,
    cr.status       as call_report_status
  from public.visits v
  join public.doctors d on d.id = v.doctor_id
  left join public.call_reports cr on cr.visit_id = v.id;

revoke all on public.visit_summary from anon, authenticated;
grant select on public.visit_summary to authenticated;

-- ----------------------------------------------------------------------------
-- 16. Remaining function grants
-- ----------------------------------------------------------------------------

grant execute on function public.visible_user_ids()                   to authenticated;
grant execute on function public.effective_role()                     to authenticated;
grant execute on function public.is_admin()                           to authenticated;
grant execute on function public.approve_call_report(uuid, boolean, text) to authenticated;

-- Internal only. current_request_id and current_client_ip are called from
-- SECURITY DEFINER contexts and have no business being callable by a client.
revoke execute on function public.current_request_id()  from public, anon, authenticated;
revoke execute on function public.current_client_ip()   from public, anon, authenticated;
revoke execute on function public.write_audit_row()     from public, anon, authenticated;
revoke execute on function public.reject_mutation()     from public, anon, authenticated;
