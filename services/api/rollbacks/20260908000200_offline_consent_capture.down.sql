-- Rollback for 20260908000200_offline_consent_capture.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- **This restores a defect, and it is worth being explicit about which one.** After this,
-- `capture_consent` validates the displayed notice against `now()` again, so a notice
-- superseded while an MR was offline refuses every capture taken that day, with the
-- doctors already gone and the prescribed remedy — re-read the notice and ask again —
-- impossible to carry out. That is the FIX-02 behaviour, and FIX-02 was right about the
-- defect it was fixing and wrong about the offline case.
--
-- Do not apply this to recover from an offline-capture problem. If the maximum sync lag
-- is the trouble, change `consent_max_sync_lag_hours` — it is a threshold, and changing it
-- is a new append-only row, not a migration.
--
-- The `capture_lag` column IS dropped, because it is generated and carries nothing that
-- is not still derivable from `received_at - captured_at`. The two source columns stay.
-- The `app_thresholds` row is NOT deleted: that table is append-only and enforced by a
-- statement-level reject_mutation trigger, so a delete would be refused with 23001 and
-- this file would fail halfway. An unread threshold is inert.
--
-- `active_consent_text_at` is dropped and `active_consent_text` is restored to its own
-- inline body, so no function is left calling something that no longer exists.

alter table public.consent_records drop column if exists capture_lag;

create or replace function public.capture_consent(
  p_id                      uuid,
  p_visit_id                uuid,
  p_outcome                 public.consent_outcome,
  p_language                text,
  p_consent_text_version_id uuid,
  p_not_asked_reason        text        default null,
  p_captured_at             timestamptz default null
)
returns public.consent_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid;
  v_visit    public.visits%rowtype;
  v_active   public.consent_text_versions%rowtype;
  v_existing public.consent_records%rowtype;
  v_row      public.consent_records%rowtype;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_existing from public.consent_records c where c.id = p_id;
  if found then
    if v_existing.captured_by_mr_id <> v_uid then
      raise exception 'consent record % belongs to another user', p_id using errcode = '42501';
    end if;
    return v_existing;
  end if;

  select * into v_visit from public.visits v where v.id = p_visit_id and v.mr_id = v_uid;
  if not found then
    raise exception 'visit % is not yours', p_visit_id using errcode = '42501';
  end if;

  if p_consent_text_version_id is null then
    raise exception 'consent capture requires the consent text version that was displayed'
      using errcode = '22023';
  end if;

  v_active := public.active_consent_text(p_language);
  if v_active.id is null then
    raise exception 'no active consent text for language %', p_language using errcode = '22023';
  end if;

  if p_consent_text_version_id <> v_active.id then
    perform 1 from public.consent_text_versions v where v.id = p_consent_text_version_id;
    if not found then
      raise exception 'consent text version % does not exist', p_consent_text_version_id
        using errcode = '22023';
    end if;

    raise exception
      'the consent notice changed since it was displayed; re-read the current notice and ask again'
      using errcode = '45001',
            detail  = format('displayed %s, current %s, language %s',
                             p_consent_text_version_id, v_active.id, p_language);
  end if;

  insert into public.consent_records
    (id, visit_id, doctor_id, captured_by_mr_id, outcome, not_asked_reason,
     consent_text_version_id, displayed_language, captured_at)
  values
    (p_id, p_visit_id, v_visit.doctor_id, v_uid, p_outcome,
     case when p_outcome = 'not_asked' then p_not_asked_reason else null end,
     p_consent_text_version_id, v_active.language, coalesce(p_captured_at, now()))
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.active_consent_text(p_language text)
returns public.consent_text_versions
language sql
stable
security definer
set search_path = ''
as $$
  select v.*
    from public.consent_text_versions v
   where v.language = p_language
     and v.effective_from <= now()
     and (v.effective_until is null or v.effective_until > now())
   order by v.effective_from desc, v.created_at desc, v.id desc
   limit 1;
$$;

drop function if exists public.active_consent_text_at(text, timestamptz);
