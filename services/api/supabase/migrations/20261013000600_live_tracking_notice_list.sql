-- `BE-W201` -- the company's live-tracking notice versions, for an admin, in one read.
--
-- **What existed.** `20261013000100_live_tracking` (`BE-W180`) gave an admin
-- `propose_live_tracking_notice` and a SECOND admin `approve_live_tracking_notice` (four eyes, held by
-- the `live_tracking_notice_approvals_valid` trigger), and decided which notice is in force with
-- `current_live_tracking_notice` -- which is granted to nobody. There was no read an admin screen
-- could make to show which version is in force, which versions are waiting, who wrote each one and
-- whether the caller may approve it. The tables are readable under RLS, but "in force" is the
-- helper's rule (latest APPROVAL, else the engineering draft), and a screen that recomputed it would
-- be a second implementation of the rule the phone obeys.
--
-- **What this returns.** The notice in force (`isDraft` when no company version is approved), and
-- every version the company has loaded, newest first: its text, author, whether the CALLER wrote it
-- (the trigger refuses the author's approval; the screen says so before anybody presses anything),
-- and its status -- `in_force`, `superseded` (approved, then replaced by a later approval) or
-- `waiting` (loaded, not yet approved by a second admin).
--
-- Admin only, refused `42501` rather than emptied, like its neighbours. Read-only and not audited:
-- the texts are already readable by every member of the company (`live_tracking_notice_versions_select`),
-- and loading and approving them ARE audited (`live_tracking_notice_*_audit`).
--
-- Rollback: services/api/rollbacks/20261013000600_live_tracking_notice_list.down.sql

create or replace function public.live_tracking_notices()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_caller  record;
  v_current public.live_tracking_notice_versions%rowtype;
  v_approved_at timestamptz;
begin
  select * into v_caller from public.lms_caller();
  if v_caller.role <> 'admin' then
    raise exception 'only an admin manages the live tracking notice' using errcode = '42501';
  end if;

  v_current := public.current_live_tracking_notice(v_caller.organisation_id);
  select a.created_at into v_approved_at
    from public.live_tracking_notice_approvals a where a.notice_version_id = v_current.id;

  return jsonb_build_object(
    'current', case when v_current.id is null then null else jsonb_build_object(
      'id', v_current.id,
      'versionLabel', v_current.version_label,
      'body', v_current.body,
      'isDraft', v_current.organisation_id is null,
      'approvedAt', v_approved_at) end,
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id,
               'versionLabel', v.version_label,
               'body', v.body,
               'createdAt', v.created_at,
               'authorName', author.full_name,
               'authoredByYou', v.authored_by_user_id = v_caller.user_id,
               'status', case when v.id = v_current.id then 'in_force'
                              when a.id is not null then 'superseded'
                              else 'waiting' end,
               'approvedAt', a.created_at,
               'approverName', approver.full_name,
               'attestation', a.attestation)
             order by v.created_at desc, v.id)
        from public.live_tracking_notice_versions v
        left join public.live_tracking_notice_approvals a on a.notice_version_id = v.id
        left join public.user_profiles author on author.id = v.authored_by_user_id
        left join public.user_profiles approver on approver.id = a.approved_by_user_id
       where v.organisation_id = v_caller.organisation_id),
      '[]'::jsonb),
    'serverTime', now());
end;
$$;

revoke all on function public.live_tracking_notices() from public, anon;
grant execute on function public.live_tracking_notices() to authenticated;

comment on function public.live_tracking_notices() is
  'BE-W201: admin only. The live-tracking notice in force for the caller''s company (the engineering '
  'draft when none is approved) and every version the company loaded, newest first, with its author, '
  'whether the caller wrote it, and in_force / superseded / waiting.';
