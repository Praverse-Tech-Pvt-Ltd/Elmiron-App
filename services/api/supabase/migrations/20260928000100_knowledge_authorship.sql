-- W1-A E1 -- AI-generated knowledge is never born approved, and it says who wrote it.
--
-- `C24` (`.ai-collab/decisions.md`, 28 September 2026) permits AI-generated text to be used
-- extensively in the LMS **as draft knowledge**. That is the single most dangerous permission in
-- this release: it is the one that could put unreviewed, machine-written product statements in
-- front of a rep who will repeat them to a doctor.
--
-- `C24`'s hard rule, in full: AI-generated text enters as a DRAFT, is LABELLED with the fact that
-- a model produced it, and can only become approved through the existing four-eyes path. No seed,
-- script or migration may insert approved knowledge.
--
-- **Two gaps this migration closes. Both were found by reading `20260924000600_knowledge.sql`,
-- not by recollection.**
--
-- 1. **Nothing recorded who — or what — wrote the text.** `knowledge_document_versions` carried
--    `created_by_user_id` and `source_reference`, and a model's draft was indistinguishable from
--    a colleague's. An approver cannot apply more care to machine-written text they cannot
--    identify, so `C24`'s labelling half had no column to live in.
--
-- 2. **The insert trigger COERCED where it should have REFUSED.** `new.status := 'draft'` meant an
--    insert claiming `status = 'approved'` **succeeded**, silently, as a draft. The stored outcome
--    was correct and the signal was wrong, which is the worse of the two failures: a seed asking
--    for approved knowledge received a success, and whoever wrote it would believe the content was
--    approved and live. `C24` requires that attempt to FAIL. The same applies to every lifecycle
--    column — a caller who sets `approval_attestation` on an insert is asking for something the
--    four-eyes path exists to refuse, and should be told so.
--
-- **NOT closed by this migration, and registered rather than quietly left.** A caller holding
-- BYPASSRLS (`postgres`, `service_role`) can still reach `approved` by two direct UPDATEs —
-- draft -> in_review with the submitted columns set, then in_review -> approved with an
-- attestation. `knowledge_versions_before_update` permits those transitions because the FOUR-EYES
-- check lives in `approve_knowledge_version`'s body, not in the trigger. Closing it needs a way
-- for the trigger to know it was called from that function, which means a session-scoped flag —
-- a mechanism this schema does not have anywhere yet, and `.ai-collab/constraints.md` requires
-- asking before introducing one. Registered as **BE-W115**. What this migration does do is make
-- the cheap, direct route — a plain INSERT — fail loudly, which is the route a seed or a
-- migration would actually take.

create type public.knowledge_authorship as enum ('human', 'ai_generated');

revoke all on type public.knowledge_authorship from public, anon;
grant usage on type public.knowledge_authorship to authenticated;

alter table public.knowledge_document_versions
  -- Defaulting to `human` is deliberate. Every version that exists today was written by a person,
  -- and a default of 'ai_generated' would relabel history. A model's draft must SAY so.
  add column authorship public.knowledge_authorship not null default 'human',
  -- Which model, as the vendor names it. Free text because no vendor is chosen (`#5`) and an enum
  -- here would have to be guessed at, then migrated the moment a real name arrived.
  add column authoring_model text;

alter table public.knowledge_document_versions
  -- The two columns cannot disagree. 'ai_generated' with no model names nothing an approver can
  -- weigh; 'human' with a model is a mislabelled machine draft, which is the exact thing `C24`
  -- exists to prevent.
  add constraint knowledge_versions_authorship_names_its_model
    check (
      (authorship = 'ai_generated' and length(btrim(coalesce(authoring_model, ''))) > 0)
      or (authorship = 'human' and authoring_model is null)
    );

comment on column public.knowledge_document_versions.authorship is
  'W1-A E1 / C24. Whether a person or a model produced this text. A model''s draft must say so: an '
  'approver applies different care to machine-written text, and cannot if it is not labelled.';
comment on column public.knowledge_document_versions.authoring_model is
  'W1-A E1 / C24. The model that produced the draft, as the vendor names it. Null for human text, '
  'required for ai_generated -- enforced by knowledge_versions_authorship_names_its_model.';

/**
 * Versions, BEFORE INSERT -- W1-A E1 replaces AI-C1's version.
 *
 * Identical in what it STORES. Different in what it does with a caller who asks for more than a
 * draft: AI-C1 overwrote the request, this refuses it.
 *
 * Every line of the original's behaviour is preserved -- tenant from the document, the next
 * version number, born a draft authored by the caller, market required for product content.
 */
create or replace function public.knowledge_versions_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.knowledge_documents%rowtype;
begin
  select * into v_doc from public.knowledge_documents d where d.id = new.document_id;
  new.organisation_id := v_doc.organisation_id;

  select coalesce(max(v.version_number), 0) + 1 into new.version_number
    from public.knowledge_document_versions v where v.document_id = new.document_id;

  -- W1-A E1 / `C24`. REFUSE, do not coerce.
  --
  -- The column defaults to 'draft', so an ordinary insert that says nothing about status arrives
  -- here already correct and passes. Only a caller who ASKED for another status is refused, and
  -- being told is the point: this is the check that makes "no seed, script or migration may insert
  -- approved knowledge" a mechanism rather than a sentence in a document.
  if new.status is distinct from 'draft' then
    raise exception
      'knowledge version cannot be created as %; every version is born a draft', new.status
      using errcode = '23514',
            hint = 'C24: AI-generated text is never born approved. Insert a draft, then submit it '
                   'and have a SECOND admin approve it through approve_knowledge_version.';
  end if;

  -- The same refusal for the lifecycle columns. A caller setting these is asking to skip the
  -- four-eyes path, and AI-C1 silently nulled them.
  if new.submitted_at is not null or new.submitted_by_user_id is not null
     or new.decided_at is not null or new.decided_by_user_id is not null
     or new.approval_attestation is not null or new.rejection_reason is not null
     or new.retired_at is not null or new.retired_by_user_id is not null then
    raise exception
      'knowledge version: the review and approval columns are set by the RPCs, never on insert'
      using errcode = '23514',
            hint = 'C24 / four eyes: submit_knowledge_version and approve_knowledge_version own '
                   'these columns. An insert that sets them is asking to bypass the approver.';
  end if;

  new.created_by_user_id := coalesce((select auth.uid()), new.created_by_user_id);

  if new.market_id is not null and not exists (
    select 1 from public.markets m
     where m.id = new.market_id and m.organisation_id = new.organisation_id) then
    raise exception 'knowledge version: market is not in this organisation' using errcode = '23514';
  end if;
  if v_doc.product_id is not null and new.market_id is null then
    raise exception 'knowledge version: content about a product must name its market'
      using errcode = '23514',
            hint = 'One country''s promotional or regulatory content never applies everywhere.';
  end if;
  return new;
end;
$$;

-- The trigger itself is unchanged and is not recreated; `create or replace function` above is the
-- whole change. Stated explicitly because a reader looking for a `create trigger` here and not
-- finding one should know it is deliberate.
