-- Rollback for MR-51 C3 -- removes the 18 restrictive tenant boundaries 20260922000300 added. The
-- permissive policies, and visible_user_ids()'s own organisation filter, are what remain.

drop policy adverse_event_reports_tenant_boundary on public.adverse_event_reports;
drop policy beat_plan_entries_tenant_boundary on public.beat_plan_entries;
drop policy beat_plans_tenant_boundary on public.beat_plans;
drop policy call_report_approvals_tenant_boundary on public.call_report_approvals;
drop policy call_reports_tenant_boundary on public.call_reports;
drop policy check_ins_tenant_boundary on public.check_ins;
drop policy check_outs_tenant_boundary on public.check_outs;
drop policy recordings_tenant_boundary on public.recordings;
drop policy samples_and_inputs_tenant_boundary on public.samples_and_inputs;
drop policy sync_batches_tenant_boundary on public.sync_batches;
drop policy sync_events_tenant_boundary on public.sync_events;
drop policy sync_item_reinstatements_tenant_boundary on public.sync_item_reinstatements;
drop policy sync_items_tenant_boundary on public.sync_items;
drop policy upload_grants_tenant_boundary on public.upload_grants;
drop policy visit_audio_quarantine_tenant_boundary on public.visit_audio_quarantine;
drop policy visit_audio_quarantine_clearances_tenant_boundary on public.visit_audio_quarantine_clearances;
drop policy visits_tenant_boundary on public.visits;
drop policy voice_notes_tenant_boundary on public.voice_notes;
