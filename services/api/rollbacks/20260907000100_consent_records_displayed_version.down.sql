-- Rollback for 20260907000100_consent_records_displayed_version.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- Restores both functions to their 20260815000300 bodies: capture_consent back to
-- the six-argument form that re-derives the active notice, and active_consent_text
-- back to the untie-broken ordering.
--
-- Restoring this reinstates the defect FIX-02 exists to remove -- a capture can
-- again record a notice version the doctor never saw. That is what a rollback of
-- this migration means, and it is stated here rather than discovered later.
--
-- consent_records rows written while the forward migration was in force are NOT
-- touched. They are correct under both schemas: their consent_text_version_id is
-- the version the client displayed, which is a strict improvement on what the old
-- path would have written, and the table is append-only in any case.

drop function if exists public.capture_consent(
  uuid, uuid, public.consent_outcome, text, uuid, text, timestamptz
);

create function public.capture_consent(
  p_id               uuid,
  p_visit_id         uuid,
  p_outcome          public.consent_outcome,
  p_language         text,
  p_not_asked_reason text default null,
  p_captured_at      timestamptz default null
)
returns public.consent_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid;
  v_visit    public.visits%rowtype;
  v_text     public.consent_text_versions%rowtype;
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

  v_text := public.active_consent_text(p_language);
  if v_text.id is null then
    raise exception 'no active consent text for language %', p_language using errcode = '22023';
  end if;

  -- All three outcomes take this path and all three succeed. `declined` is an
  -- ordinary completed capture: no error shape, no penalty flag, no
  -- nullable-because-it-failed column anywhere in the row it produces.
  insert into public.consent_records
    (id, visit_id, doctor_id, captured_by_mr_id, outcome, not_asked_reason,
     consent_text_version_id, displayed_language, captured_at)
  values
    (p_id, p_visit_id, v_visit.doctor_id, v_uid, p_outcome,
     case when p_outcome = 'not_asked' then p_not_asked_reason else null end,
     v_text.id, v_text.language, coalesce(p_captured_at, now()))
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.capture_consent(
  uuid, uuid, public.consent_outcome, text, text, timestamptz
) to authenticated;

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
   order by v.effective_from desc
   limit 1;
$$;
