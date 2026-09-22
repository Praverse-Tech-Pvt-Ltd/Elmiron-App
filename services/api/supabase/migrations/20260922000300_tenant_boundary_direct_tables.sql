-- ============================================================================
-- MR-51 C3 -- BE-W83: a restrictive tenant boundary on the directly readable tables.
-- ============================================================================
--
-- MR-07 D (20260908001300) made the tenant boundary RESTRICTIVE on the seven tables that carry a
-- tenant or reach one in a single hop, and registered the rest as BE-W83. MR-50 C4 measured them:
-- 19 tables are granted SELECT to `authenticated` with only PERMISSIVE policies, scoped by
-- `visible_user_ids()` or `auth.uid()`. MR-51 C1 probed each over real HTTP: an MR and an admin of
-- one organisation read another's row. 18 do not leak -- because `visible_user_ids()` filters by
-- organisation INSIDE its body (MR-06 / BE-W76), so every permissive policy here is tenant-bounded
-- by one function, not by anything on the table. `app_thresholds` does leak; it is BE-W106, a
-- settings-model decision the operator has not made, and is NOT touched here (C13).
--
-- What this adds is the second layer: a restrictive policy on each of the 18, so isolation no
-- longer depends on territory scoping, or on one function body, happening to stop at the tenant.
-- A restrictive policy is AND-ed; nothing added later can widen past it.
--
-- THE PREDICATE, and why it is the existing helper, not a new one. None of the 18 carries an
-- organisation column. Each reaches one through the MR who owns the row:
--
--     mr_id in (select p.id from public.user_profiles p
--                where p.organisation_id = public.current_user_organisation_id())
--
-- -- the same shape as `clinic_addresses_tenant_boundary`, which reaches its tenant through
-- `doctors`. The subquery runs under the caller's RLS on `user_profiles`, so it yields the caller's
-- visible profiles AND those in the caller's organisation (`user_profiles_tenant_boundary`, plus the
-- explicit filter). The explicit `organisation_id =` is what makes this independent: were
-- `visible_user_ids()` ever to return another tenant's ids again, this still refuses them.
-- Tables owned through a parent reach the MR through that parent (one more hop).
--
-- `to authenticated`, never `public` (see 20260908001300: `supabase_auth_admin` must stay
-- unaffected). `postgres` and `service_role` hold BYPASSRLS, so the SECURITY DEFINER functions --
-- every write path here, and the console's reads -- are unaffected; the boundary for those is still
-- their bodies (MR-50 engineering decision). `sync_pull` is SECURITY INVOKER and DOES pass through
-- these; its cost was measured before and after (PROJECT-OVERVIEW, MR-51 C3).
--
-- Rollback: services/api/rollbacks/20260922000300_tenant_boundary_direct_tables.down.sql

-- --- owned directly by an MR ------------------------------------------------
create policy beat_plans_tenant_boundary on public.beat_plans
  as restrictive for all to authenticated
  using (mr_id in (select p.id from public.user_profiles p
                    where p.organisation_id = public.current_user_organisation_id()))
  with check (mr_id in (select p.id from public.user_profiles p
                         where p.organisation_id = public.current_user_organisation_id()));

create policy call_reports_tenant_boundary on public.call_reports
  as restrictive for all to authenticated
  using (mr_id in (select p.id from public.user_profiles p
                    where p.organisation_id = public.current_user_organisation_id()))
  with check (mr_id in (select p.id from public.user_profiles p
                         where p.organisation_id = public.current_user_organisation_id()));

create policy check_ins_tenant_boundary on public.check_ins
  as restrictive for all to authenticated
  using (mr_id in (select p.id from public.user_profiles p
                    where p.organisation_id = public.current_user_organisation_id()))
  with check (mr_id in (select p.id from public.user_profiles p
                         where p.organisation_id = public.current_user_organisation_id()));

create policy check_outs_tenant_boundary on public.check_outs
  as restrictive for all to authenticated
  using (mr_id in (select p.id from public.user_profiles p
                    where p.organisation_id = public.current_user_organisation_id()))
  with check (mr_id in (select p.id from public.user_profiles p
                         where p.organisation_id = public.current_user_organisation_id()));

create policy recordings_tenant_boundary on public.recordings
  as restrictive for all to authenticated
  using (mr_id in (select p.id from public.user_profiles p
                    where p.organisation_id = public.current_user_organisation_id()))
  with check (mr_id in (select p.id from public.user_profiles p
                         where p.organisation_id = public.current_user_organisation_id()));

create policy samples_and_inputs_tenant_boundary on public.samples_and_inputs
  as restrictive for all to authenticated
  using (mr_id in (select p.id from public.user_profiles p
                    where p.organisation_id = public.current_user_organisation_id()))
  with check (mr_id in (select p.id from public.user_profiles p
                         where p.organisation_id = public.current_user_organisation_id()));

create policy sync_batches_tenant_boundary on public.sync_batches
  as restrictive for all to authenticated
  using (mr_id in (select p.id from public.user_profiles p
                    where p.organisation_id = public.current_user_organisation_id()))
  with check (mr_id in (select p.id from public.user_profiles p
                         where p.organisation_id = public.current_user_organisation_id()));

create policy sync_items_tenant_boundary on public.sync_items
  as restrictive for all to authenticated
  using (mr_id in (select p.id from public.user_profiles p
                    where p.organisation_id = public.current_user_organisation_id()))
  with check (mr_id in (select p.id from public.user_profiles p
                         where p.organisation_id = public.current_user_organisation_id()));

create policy upload_grants_tenant_boundary on public.upload_grants
  as restrictive for all to authenticated
  using (mr_id in (select p.id from public.user_profiles p
                    where p.organisation_id = public.current_user_organisation_id()))
  with check (mr_id in (select p.id from public.user_profiles p
                         where p.organisation_id = public.current_user_organisation_id()));

create policy visits_tenant_boundary on public.visits
  as restrictive for all to authenticated
  using (mr_id in (select p.id from public.user_profiles p
                    where p.organisation_id = public.current_user_organisation_id()))
  with check (mr_id in (select p.id from public.user_profiles p
                         where p.organisation_id = public.current_user_organisation_id()));

create policy voice_notes_tenant_boundary on public.voice_notes
  as restrictive for all to authenticated
  using (mr_id in (select p.id from public.user_profiles p
                    where p.organisation_id = public.current_user_organisation_id()))
  with check (mr_id in (select p.id from public.user_profiles p
                         where p.organisation_id = public.current_user_organisation_id()));

-- --- owned through a visit ----------------------------------------------------
-- `adverse_event_reports.reported_by_mr_id` is null for a transcript-detected report, so the
-- tenant is reached through the visit, which every report has.
create policy adverse_event_reports_tenant_boundary on public.adverse_event_reports
  as restrictive for all to authenticated
  using (visit_id in (select v.id from public.visits v
                       where v.mr_id in (select p.id from public.user_profiles p
                                          where p.organisation_id = public.current_user_organisation_id())))
  with check (visit_id in (select v.id from public.visits v
                            where v.mr_id in (select p.id from public.user_profiles p
                                               where p.organisation_id = public.current_user_organisation_id())));

create policy visit_audio_quarantine_tenant_boundary on public.visit_audio_quarantine
  as restrictive for all to authenticated
  using (visit_id in (select v.id from public.visits v
                       where v.mr_id in (select p.id from public.user_profiles p
                                          where p.organisation_id = public.current_user_organisation_id())))
  with check (visit_id in (select v.id from public.visits v
                            where v.mr_id in (select p.id from public.user_profiles p
                                               where p.organisation_id = public.current_user_organisation_id())));

create policy visit_audio_quarantine_clearances_tenant_boundary on public.visit_audio_quarantine_clearances
  as restrictive for all to authenticated
  using (visit_id in (select v.id from public.visits v
                       where v.mr_id in (select p.id from public.user_profiles p
                                          where p.organisation_id = public.current_user_organisation_id())))
  with check (visit_id in (select v.id from public.visits v
                            where v.mr_id in (select p.id from public.user_profiles p
                                               where p.organisation_id = public.current_user_organisation_id())));

-- --- owned through another parent -----------------------------------------------
create policy beat_plan_entries_tenant_boundary on public.beat_plan_entries
  as restrictive for all to authenticated
  using (beat_plan_id in (select b.id from public.beat_plans b
                           where b.mr_id in (select p.id from public.user_profiles p
                                              where p.organisation_id = public.current_user_organisation_id())))
  with check (beat_plan_id in (select b.id from public.beat_plans b
                                where b.mr_id in (select p.id from public.user_profiles p
                                                   where p.organisation_id = public.current_user_organisation_id())));

create policy call_report_approvals_tenant_boundary on public.call_report_approvals
  as restrictive for all to authenticated
  using (call_report_id in (select cr.id from public.call_reports cr
                             where cr.mr_id in (select p.id from public.user_profiles p
                                                 where p.organisation_id = public.current_user_organisation_id())))
  with check (call_report_id in (select cr.id from public.call_reports cr
                                  where cr.mr_id in (select p.id from public.user_profiles p
                                                      where p.organisation_id = public.current_user_organisation_id())));

create policy sync_item_reinstatements_tenant_boundary on public.sync_item_reinstatements
  as restrictive for all to authenticated
  using (sync_item_id in (select s.id from public.sync_items s
                           where s.mr_id in (select p.id from public.user_profiles p
                                              where p.organisation_id = public.current_user_organisation_id())))
  with check (sync_item_id in (select s.id from public.sync_items s
                                where s.mr_id in (select p.id from public.user_profiles p
                                                   where p.organisation_id = public.current_user_organisation_id())));

-- `sync_events` holds exactly one of a former MR or a former territory (a CHECK says so).
create policy sync_events_tenant_boundary on public.sync_events
  as restrictive for all to authenticated
  using (
    former_mr_id in (select p.id from public.user_profiles p
                      where p.organisation_id = public.current_user_organisation_id())
    or former_territory_id in (select t.id from public.territories t
                                where t.organisation_id = public.current_user_organisation_id()))
  with check (
    former_mr_id in (select p.id from public.user_profiles p
                      where p.organisation_id = public.current_user_organisation_id())
    or former_territory_id in (select t.id from public.territories t
                                where t.organisation_id = public.current_user_organisation_id()));

-- --- the guard: exactly these 18, each restrictive, to authenticated, through the helper -------
do $$
declare
  v_expected text[] := array[
    'adverse_event_reports', 'beat_plan_entries', 'beat_plans', 'call_report_approvals',
    'call_reports', 'check_ins', 'check_outs', 'recordings', 'samples_and_inputs',
    'sync_batches', 'sync_events', 'sync_item_reinstatements', 'sync_items', 'upload_grants',
    'visit_audio_quarantine', 'visit_audio_quarantine_clearances', 'visits', 'voice_notes'];
  v_found text[];
begin
  select array_agg(c.relname::text order by c.relname)
    into v_found
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
   where p.polname = c.relname || '_tenant_boundary'
     and not p.polpermissive
     and p.polroles = array['authenticated'::regrole]::oid[]
     and position('current_user_organisation_id()' in pg_get_expr(p.polqual, p.polrelid)) > 0
     and position('current_user_organisation_id()' in pg_get_expr(p.polwithcheck, p.polrelid)) > 0
     and c.relname = any (v_expected);

  if v_found is distinct from (select array_agg(x order by x) from unnest(v_expected) x) then
    raise exception 'MR-51 C3: expected 18 restrictive tenant boundaries, found %', v_found;
  end if;

  if exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
              where c.relname = 'app_thresholds' and not p.polpermissive) then
    raise exception 'MR-51 C3: app_thresholds is BE-W106 and must not be changed here';
  end if;
end;
$$;
