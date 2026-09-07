-- FIX-02 — consent capture records the version that was displayed.
--
-- `capture_consent` re-derived the active consent text at write time and had no
-- parameter for the version the client had on screen. If a newer notice became
-- active between the doctor reading v1 and the capture landing, the row recorded
-- v2 — an attestation to a document the doctor never saw. `consent_records` is
-- append-only with no UPDATE policy, so that is permanent by design.
--
-- `packages/core/src/field/consent.ts` already states the requirement in words —
-- "The exact text version displayed on screen. Not the current version." — and
-- `apps/field` already sends `consentTextVersionId`. The contract was right and the
-- schema disagreed. The schema moves to meet the contract.
--
-- The rule this encodes: **re-derive facts the server owns, record facts the client
-- witnessed.** Whether an MR is inside their shift window is the server's fact and
-- `record_check_in` correctly re-resolves it. Which document a doctor read before
-- agreeing is the client's witness, and re-resolving it substitutes a different
-- document for the one actually shown.

-- ----------------------------------------------------------------------------
-- 1. Deterministic resolution of the active notice
-- ----------------------------------------------------------------------------
--
-- Unchanged: the selection is already bounded to the present in both directions,
-- so a future-dated row is not active. That was checked, not assumed.
--
-- Changed: `order by effective_from desc limit 1` had no tie-break. Two rows
-- sharing an instant resolved arbitrarily — which is exactly how the fixtures
-- competed, because every run seeds its own `en-IN` notice at `now()`. `created_at`
-- alone does not settle it either: `now()` is the transaction timestamp, so two
-- rows inserted in one transaction tie on both columns. `id` is the primary key,
-- so appending it guarantees a total order and therefore a deterministic answer.
--
-- Determinism is the goal, not correctness of choice: `id desc` is arbitrary as a
-- business rule. Two notices genuinely in force for one language at the same
-- instant is undefined data, and the durable fix for that is a constraint
-- forbidding it. That is left for the reviewer — see FIX-02 in PROJECT-OVERVIEW.md.
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

-- ----------------------------------------------------------------------------
-- 2. capture_consent takes the displayed version and stores it
-- ----------------------------------------------------------------------------
--
-- The old function is DROPPED, not replaced. Adding a parameter creates an
-- overload rather than a replacement, and leaving the six-argument version in
-- place would leave `authenticated` holding EXECUTE on the defective path — the
-- fix would be reachable around. Dropping it also breaks every stale caller
-- loudly, which is the intent.
drop function if exists public.capture_consent(
  uuid, uuid, public.consent_outcome, text, text, timestamptz
);

create function public.capture_consent(
  p_id                       uuid,
  p_visit_id                 uuid,
  p_outcome                  public.consent_outcome,
  p_language                 text,
  p_consent_text_version_id  uuid,
  p_not_asked_reason         text default null,
  p_captured_at              timestamptz default null
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
    -- Two different failures, and the MR can act on only one of them.
    perform 1 from public.consent_text_versions v where v.id = p_consent_text_version_id;
    if not found then
      raise exception 'consent text version % does not exist', p_consent_text_version_id
        using errcode = '22023';
    end if;

    -- SQLSTATE 45001 is project-defined and deliberately not one of the four
    -- standard codes used elsewhere in these migrations. The client must be able to
    -- tell this apart from every other refusal, because it is the only one with a
    -- remedy the MR can carry out: re-read the current notice and ask again. Matching
    -- on message text would be the alternative and it is not a contract.
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

comment on function public.capture_consent(
  uuid, uuid, public.consent_outcome, text, uuid, text, timestamptz
) is
  'Records a consent capture against the notice version the client displayed. Refuses '
  '(SQLSTATE 45001) if that version is no longer the active one, rather than silently '
  'substituting the current version. See FIX-02.';

grant execute on function public.capture_consent(
  uuid, uuid, public.consent_outcome, text, uuid, text, timestamptz
) to authenticated;
