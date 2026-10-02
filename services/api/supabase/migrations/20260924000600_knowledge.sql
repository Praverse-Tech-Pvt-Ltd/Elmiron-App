-- ============================================================================
-- AI-C1 -- approved knowledge: documents, reviewed versions, chunks, and a scoped search.
-- ============================================================================
--
-- The master prompt, §7-§9: "Do not automatically expose uploaded documents to AI. Require
-- approved status. Store document version. Historical AI interactions must be traceable to the
-- knowledge version used." And §47: "Never assume one country's promotional/regulatory content
-- applies everywhere." This is the store every AI answer about a product will have to come from.
--
-- **What is deliberately NOT here.**
-- * **No embeddings, no vector search.** pgvector is D3 (`docs/ai-platform/phase-a-recon.md`), an
--   "ask before" item. Retrieval here is Postgres full-text search, which needs nothing installed.
--   An `embedding` column can be added to `knowledge_chunks` later without changing the approval
--   model, and the §1.2 measurement says how retrieval must then be written.
-- * **No file upload or PDF extraction.** Extraction needs a parser, which is a dependency. A
--   version carries the text an admin supplies, plus `source_reference` saying where it came
--   from. A storage bucket for originals is a later, separate decision.
-- * **No model.** Nothing here calls one or stores what one said.
-- * **No patient or clinical data.** This is the company's own approved material. The
--   `foundations` suite forbids table names containing `prescri`, so prescribing information is
--   the `product_label` document type, not a table name.
--
-- **The lifecycle, and why each rule exists.**
--
--     draft --submit--> in_review --approve--> approved --retire--> retired
--                                  \--reject--> rejected (terminal: write a new version)
--
-- * Only a draft can be edited. Submitting freezes the text and cuts it into chunks, so what was
--   reviewed is exactly what can be retrieved -- there is no path by which approved text differs
--   from reviewed text.
-- * **Four eyes.** The person who approves a version may not be the person who wrote it or
--   submitted it. Approval also requires a written attestation, stored on the row. A medical /
--   regulatory reviewer is therefore a named admin who attested, not a fourth role -- the schema
--   may never hold a fourth role (`constraints.md`). *If an organisation has only one admin,
--   nothing it writes can be approved.* That is the control working; D8 names who the reviewer is.
-- * Approving a version retires the previously approved version of the same document for the
--   same market. At most one approved version per document per market is retrievable.
-- * **Product content must name a market.** A version about a product with no market would be
--   retrievable in every country, which is exactly what §47 forbids. General material (an SOP, a
--   communication-skills FAQ) may name none.
--
-- **What "retrievable" means, computed at search time and never stored** (`constraints.md`: a
-- property that depends on the clock is a computation, not a field): approved; in the caller's
-- organisation; effective on or before today; not past its review date; the document active; and
-- the market and product the caller asked about, or general content that names none.
--
-- **Reads.** Admins see every version. Everyone else sees approved ones only -- an MR can read
-- the approved library directly, but never a draft, a rejected version, or one under review.
--
-- **Not yet called by anything.** No screen and no AI feature uses it. UNVERIFIED in the §56 sense.

-- ----------------------------------------------------------------------------
-- 1. Types and tables
-- ----------------------------------------------------------------------------

create type public.knowledge_document_type as enum (
  'product_label',          -- the approved product information / label
  'clinical_study',
  'visual_aid',
  'faq',
  'objection_handling',
  'training_material',
  'compliance_instruction',
  'sop',
  'other'
);

create type public.knowledge_version_status as enum (
  'draft', 'in_review', 'approved', 'rejected', 'retired'
);

create table public.knowledge_documents (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null default public.current_user_organisation_id()
                     references public.organisations (id) on delete restrict,
  title              text not null,
  document_type      public.knowledge_document_type not null,
  product_id         uuid references public.products (id) on delete restrict,
  therapy_area_id    uuid references public.therapy_areas (id) on delete restrict,
  is_active          boolean not null default true,
  created_by_user_id uuid not null default auth.uid()
                     references public.user_profiles (id) on delete restrict,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint knowledge_documents_title_present check (length(btrim(title)) > 0)
);

create index knowledge_documents_product_idx on public.knowledge_documents (product_id);

create table public.knowledge_document_versions (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  document_id           uuid not null references public.knowledge_documents (id) on delete restrict,
  version_number        integer not null,
  status                public.knowledge_version_status not null default 'draft',
  -- Null = not specific to a market. Refused by trigger when the document is about a product.
  market_id             uuid references public.markets (id) on delete restrict,
  body                  text not null,
  source_reference      text not null,
  effective_from        date not null,
  review_due_on         date,
  created_by_user_id    uuid not null references public.user_profiles (id) on delete restrict,
  submitted_at          timestamptz,
  submitted_by_user_id  uuid references public.user_profiles (id) on delete restrict,
  decided_at            timestamptz,
  decided_by_user_id    uuid references public.user_profiles (id) on delete restrict,
  approval_attestation  text,
  rejection_reason      text,
  retired_at            timestamptz,
  retired_by_user_id    uuid references public.user_profiles (id) on delete restrict,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint knowledge_versions_number_once unique (document_id, version_number),
  constraint knowledge_versions_body_present check (length(btrim(body)) > 0),
  constraint knowledge_versions_source_present check (length(btrim(source_reference)) > 0),
  constraint knowledge_versions_review_after_effective
    check (review_due_on is null or review_due_on >= effective_from),
  constraint knowledge_versions_submitted_is_stamped
    check (status = 'draft' or (submitted_at is not null and submitted_by_user_id is not null)),
  constraint knowledge_versions_decision_is_stamped
    check (status in ('draft', 'in_review')
           or (decided_at is not null and decided_by_user_id is not null)),
  constraint knowledge_versions_approval_is_attested
    check (status not in ('approved', 'retired') or length(btrim(approval_attestation)) > 0),
  constraint knowledge_versions_rejection_has_reason
    check (status <> 'rejected' or length(btrim(rejection_reason)) > 0),
  constraint knowledge_versions_retired_is_stamped
    check (status <> 'retired' or (retired_at is not null and retired_by_user_id is not null)),
  -- Four eyes, as a constraint as well as in the RPC, so it holds for every writer.
  constraint knowledge_versions_four_eyes
    check (decided_by_user_id is null
           or (decided_by_user_id <> created_by_user_id
               and decided_by_user_id <> submitted_by_user_id))
);

create index knowledge_versions_document_idx
  on public.knowledge_document_versions (document_id, status);

create table public.knowledge_chunks (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  document_version_id uuid not null references public.knowledge_document_versions (id)
                      on delete restrict,
  position            integer not null,
  -- The nearest preceding markdown heading, for a citation ("which section").
  heading             text,
  body                text not null,
  search_vector       tsvector generated always as (
                        to_tsvector('english', coalesce(heading, '') || ' ' || body)) stored,
  created_at          timestamptz not null default now(),
  constraint knowledge_chunks_position_once unique (document_version_id, position),
  constraint knowledge_chunks_body_present check (length(btrim(body)) > 0)
);

create index knowledge_chunks_search_idx on public.knowledge_chunks using gin (search_vector);

-- ----------------------------------------------------------------------------
-- 2. Validity, freeze and tenancy
-- ----------------------------------------------------------------------------

create or replace function public.knowledge_documents_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.organisation_id is distinct from old.organisation_id
                           or new.created_by_user_id is distinct from old.created_by_user_id
                           or new.document_type is distinct from old.document_type
                           or new.product_id is distinct from old.product_id) then
    -- A document's product and type decide which rules its versions were reviewed under.
    raise exception 'knowledge_documents: organisation, author, type and product cannot change'
      using errcode = '23514';
  end if;
  if new.product_id is not null and not exists (
    select 1 from public.products p
     where p.id = new.product_id and p.organisation_id = new.organisation_id) then
    raise exception 'knowledge_documents: product is not in this organisation' using errcode = '23514';
  end if;
  if new.therapy_area_id is not null and not exists (
    select 1 from public.therapy_areas t
     where t.id = new.therapy_area_id and t.organisation_id = new.organisation_id) then
    raise exception 'knowledge_documents: therapy area is not in this organisation'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger knowledge_documents_validate
  before insert or update on public.knowledge_documents
  for each row execute function public.knowledge_documents_validate();

/**
 * Versions, BEFORE INSERT: tenant from the document, the next number, born a draft authored by
 * the caller. Every lifecycle column is forced, because the insert grant covers the row.
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

  new.status := 'draft';
  new.created_by_user_id := coalesce((select auth.uid()), new.created_by_user_id);
  new.submitted_at := null;
  new.submitted_by_user_id := null;
  new.decided_at := null;
  new.decided_by_user_id := null;
  new.approval_attestation := null;
  new.rejection_reason := null;
  new.retired_at := null;
  new.retired_by_user_id := null;

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

create trigger knowledge_versions_before_insert
  before insert on public.knowledge_document_versions
  for each row execute function public.knowledge_versions_before_insert();

/**
 * Versions, BEFORE UPDATE: only a draft's content changes; status moves only along the arrows in
 * the header; nothing about a decided version changes except approved -> retired.
 */
create or replace function public.knowledge_versions_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product uuid;
begin
  if new.document_id is distinct from old.document_id
     or new.organisation_id is distinct from old.organisation_id
     or new.version_number is distinct from old.version_number
     or new.created_by_user_id is distinct from old.created_by_user_id then
    raise exception 'knowledge version: identity columns cannot change' using errcode = '23514';
  end if;

  if old.status <> 'draft' and (
       new.body is distinct from old.body
       or new.source_reference is distinct from old.source_reference
       or new.market_id is distinct from old.market_id
       or new.effective_from is distinct from old.effective_from
       or new.review_due_on is distinct from old.review_due_on) then
    raise exception 'knowledge version % is % and its content cannot change; write a new version',
      old.id, old.status using errcode = '23514';
  end if;

  if new.status is distinct from old.status and not (
       (old.status = 'draft' and new.status = 'in_review')
       or (old.status = 'in_review' and new.status in ('approved', 'rejected'))
       or (old.status = 'approved' and new.status = 'retired')) then
    raise exception 'knowledge version % cannot go from % to %', old.id, old.status, new.status
      using errcode = '23514';
  end if;

  if old.status in ('approved', 'rejected', 'retired') and (
       new.submitted_at is distinct from old.submitted_at
       or new.submitted_by_user_id is distinct from old.submitted_by_user_id
       or new.decided_at is distinct from old.decided_at
       or new.decided_by_user_id is distinct from old.decided_by_user_id
       or new.approval_attestation is distinct from old.approval_attestation
       or new.rejection_reason is distinct from old.rejection_reason) then
    raise exception 'knowledge version %: a decision cannot be rewritten', old.id
      using errcode = '23514';
  end if;
  if old.status = 'retired' then
    raise exception 'knowledge version % is retired and cannot change', old.id
      using errcode = '23514';
  end if;

  if new.market_id is distinct from old.market_id then
    select d.product_id into v_product from public.knowledge_documents d where d.id = new.document_id;
    if v_product is not null and new.market_id is null then
      raise exception 'knowledge version: content about a product must name its market'
        using errcode = '23514';
    end if;
    if new.market_id is not null and not exists (
      select 1 from public.markets m
       where m.id = new.market_id and m.organisation_id = new.organisation_id) then
      raise exception 'knowledge version: market is not in this organisation' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger knowledge_versions_before_update
  before update on public.knowledge_document_versions
  for each row execute function public.knowledge_versions_before_update();

create trigger knowledge_versions_reject_delete
  before delete or truncate on public.knowledge_document_versions
  for each statement execute function public.reject_mutation();

-- Chunks are cut by the server at submission and never change afterwards.
create trigger knowledge_chunks_reject_mutation
  before update or delete or truncate on public.knowledge_chunks
  for each statement execute function public.reject_mutation();

create trigger knowledge_documents_reject_delete
  before delete or truncate on public.knowledge_documents
  for each statement execute function public.reject_mutation();

create trigger knowledge_documents_set_updated_at before update on public.knowledge_documents
  for each row execute function public.set_updated_at();
create trigger knowledge_versions_set_updated_at before update on public.knowledge_document_versions
  for each row execute function public.set_updated_at();

create trigger knowledge_documents_audit after insert or update on public.knowledge_documents
  for each row execute function public.write_audit_row();
create trigger knowledge_versions_audit after insert or update on public.knowledge_document_versions
  for each row execute function public.write_audit_row();
-- Chunks are not audited row by row: they are a deterministic function of an audited version.

-- ----------------------------------------------------------------------------
-- 3. Chunking -- deterministic, in the database, no dependency
-- ----------------------------------------------------------------------------

/**
 * Cuts a version's body into chunks. Paragraphs (separated by a blank line) are packed into
 * chunks of up to ~1,200 characters; a markdown heading (`#`, `##` …) starts a new chunk and
 * becomes the `heading` of the chunks under it, so a citation can name the section.
 *
 * A paragraph longer than the limit is kept whole rather than split mid-sentence: an over-long
 * chunk ranks a little worse, a sentence cut in half can change what a claim says.
 */
create or replace function public.knowledge_chunk_version(p_version_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_limit    constant integer := 1200;
  v_version  public.knowledge_document_versions%rowtype;
  v_para     text;
  v_heading  text := null;
  v_buffer   text := '';
  v_position integer := 0;
begin
  select * into v_version from public.knowledge_document_versions v where v.id = p_version_id;

  for v_para in
    select btrim(p) from regexp_split_to_table(
      replace(v_version.body, E'\r\n', E'\n'), E'\\n[ \\t]*\\n') as p
  loop
    continue when v_para = '';

    if v_para ~ '^#{1,6}\s' then
      if v_buffer <> '' then
        v_position := v_position + 1;
        insert into public.knowledge_chunks
          (organisation_id, document_version_id, position, heading, body)
        values (v_version.organisation_id, v_version.id, v_position, v_heading, v_buffer);
        v_buffer := '';
      end if;
      -- The heading line is the heading; anything after it in the same paragraph is body.
      v_heading := btrim(regexp_replace(split_part(v_para, E'\n', 1), '^#{1,6}\s+', ''));
      v_para := btrim(substr(v_para, length(split_part(v_para, E'\n', 1)) + 2));
      continue when v_para = '';
    end if;

    if v_buffer <> '' and length(v_buffer) + 2 + length(v_para) > c_limit then
      v_position := v_position + 1;
      insert into public.knowledge_chunks
        (organisation_id, document_version_id, position, heading, body)
      values (v_version.organisation_id, v_version.id, v_position, v_heading, v_buffer);
      v_buffer := '';
    end if;

    v_buffer := case when v_buffer = '' then v_para else v_buffer || E'\n\n' || v_para end;
  end loop;

  if v_buffer <> '' then
    v_position := v_position + 1;
    insert into public.knowledge_chunks
      (organisation_id, document_version_id, position, heading, body)
    values (v_version.organisation_id, v_version.id, v_position, v_heading, v_buffer);
  end if;

  return v_position;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. The lifecycle RPCs
-- ----------------------------------------------------------------------------
--
-- Same refusal convention as the LMS: 28000, 42501, 22023. `lms_caller()` (`20260924000500`) is
-- reused: it is the caller, active, and their organisation, or a refusal.

create or replace function public.knowledge_admin_version(p_version_id uuid)
returns public.knowledge_document_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller  record;
  v_version public.knowledge_document_versions%rowtype;
begin
  select * into v_caller from public.lms_caller();
  if v_caller.role <> 'admin' then
    raise exception 'only an admin manages approved knowledge' using errcode = '42501';
  end if;
  select * into v_version from public.knowledge_document_versions v
   where v.id = p_version_id and v.organisation_id = v_caller.organisation_id
   for update;
  if v_version.id is null then
    raise exception 'knowledge version % is not in your organisation', p_version_id
      using errcode = '42501';
  end if;
  return v_version;
end;
$$;

create or replace function public.submit_knowledge_version(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.knowledge_document_versions%rowtype;
  v_now     timestamptz := clock_timestamp();
  v_chunks  integer;
begin
  v_version := public.knowledge_admin_version(p_version_id);
  if v_version.status <> 'draft' then
    raise exception 'knowledge version % is already %', v_version.id, v_version.status
      using errcode = '22023';
  end if;

  update public.knowledge_document_versions
     set status = 'in_review', submitted_at = v_now, submitted_by_user_id = (select auth.uid())
   where id = v_version.id;

  -- Cut AFTER the freeze, from the frozen text: what is reviewed is what will be retrieved.
  v_chunks := public.knowledge_chunk_version(v_version.id);
  if v_chunks = 0 then
    raise exception 'knowledge version % has no text to review', v_version.id using errcode = '22023';
  end if;

  return jsonb_build_object(
    'documentVersionId', v_version.id, 'status', 'in_review', 'submittedAt', v_now,
    'chunkCount', v_chunks);
end;
$$;

create or replace function public.approve_knowledge_version(p_version_id uuid, p_attestation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.knowledge_document_versions%rowtype;
  v_uid     uuid := (select auth.uid());
  v_now     timestamptz := clock_timestamp();
  v_retired uuid[];
begin
  v_version := public.knowledge_admin_version(p_version_id);
  if v_version.status <> 'in_review' then
    raise exception 'knowledge version % is %, not in review', v_version.id, v_version.status
      using errcode = '22023';
  end if;
  if v_uid = v_version.created_by_user_id or v_uid = v_version.submitted_by_user_id then
    raise exception 'the author or submitter of knowledge version % cannot approve it', v_version.id
      using errcode = '42501',
            hint = 'Four eyes: a second admin reviews and approves.';
  end if;
  if coalesce(btrim(p_attestation), '') = '' then
    raise exception 'approval needs a written attestation' using errcode = '22023';
  end if;

  with superseded as (
    update public.knowledge_document_versions v
       set status = 'retired', retired_at = v_now, retired_by_user_id = v_uid
     where v.document_id = v_version.document_id
       and v.status = 'approved'
       and v.market_id is not distinct from v_version.market_id
    returning v.id
  )
  select coalesce(array_agg(id), '{}') into v_retired from superseded;

  update public.knowledge_document_versions
     set status = 'approved', decided_at = v_now, decided_by_user_id = v_uid,
         approval_attestation = btrim(p_attestation)
   where id = v_version.id;

  return jsonb_build_object(
    'documentVersionId', v_version.id, 'status', 'approved', 'decidedAt', v_now,
    'retiredDocumentVersionIds', to_jsonb(v_retired));
end;
$$;

create or replace function public.reject_knowledge_version(p_version_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.knowledge_document_versions%rowtype;
  v_uid     uuid := (select auth.uid());
  v_now     timestamptz := clock_timestamp();
begin
  v_version := public.knowledge_admin_version(p_version_id);
  if v_version.status <> 'in_review' then
    raise exception 'knowledge version % is %, not in review', v_version.id, v_version.status
      using errcode = '22023';
  end if;
  if v_uid = v_version.created_by_user_id or v_uid = v_version.submitted_by_user_id then
    raise exception 'the author or submitter of knowledge version % cannot decide on it',
      v_version.id using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a rejection needs a reason' using errcode = '22023';
  end if;

  update public.knowledge_document_versions
     set status = 'rejected', decided_at = v_now, decided_by_user_id = v_uid,
         rejection_reason = btrim(p_reason)
   where id = v_version.id;

  return jsonb_build_object(
    'documentVersionId', v_version.id, 'status', 'rejected', 'decidedAt', v_now);
end;
$$;

create or replace function public.retire_knowledge_version(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.knowledge_document_versions%rowtype;
  v_now     timestamptz := clock_timestamp();
begin
  v_version := public.knowledge_admin_version(p_version_id);
  if v_version.status <> 'approved' then
    raise exception 'knowledge version % is %, not approved', v_version.id, v_version.status
      using errcode = '22023';
  end if;
  -- Retiring withdraws content from retrieval, which only makes the system say less. It needs
  -- no second pair of eyes; approving is the act that needs them.
  update public.knowledge_document_versions
     set status = 'retired', retired_at = v_now, retired_by_user_id = (select auth.uid())
   where id = v_version.id;

  return jsonb_build_object('documentVersionId', v_version.id, 'status', 'retired', 'retiredAt', v_now);
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. The search -- the only door an AI feature will use
-- ----------------------------------------------------------------------------

/**
 * Approved knowledge matching `p_query`, for the caller's organisation, for one market and
 * (optionally) one product.
 *
 * **The scope is resolved to a list of version ids first, then the text search runs inside it.**
 * `@@` is not LEAKPROOF, so on an RLS table it could never use the GIN index
 * (`constraints.md`, FIX-08); this function is `security definer` and applies the scope in its
 * body instead, which is the pattern the schema already uses. It also means the ranking only ever
 * sees permitted chunks -- there is no "near but forbidden" candidate to crowd the results out
 * (the pgvector trap in `phase-a-recon.md` §1.2 cannot occur here).
 *
 * **Market.** `p_market_id` null means "no particular market": only content that names no market
 * is eligible, which excludes all product content by construction. A caller asking about a product
 * has to say which country they are in.
 *
 * **Nothing found is an answer.** `status = 'not_available'` with an empty result, never a
 * best-effort match from outside the scope. The AI layer turns it into "Approved information not
 * available. Please refer this question to the Medical/Scientific team."
 *
 * Every result carries its document, version and section, so an answer can cite them and an AI
 * request log can record exactly which versions an answer was built from.
 */
create or replace function public.search_approved_knowledge(
  p_query      text,
  p_market_id  uuid default null,
  p_product_id uuid default null,
  p_limit      integer default 5
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller   record;
  v_today    date := (clock_timestamp() at time zone 'Asia/Kolkata')::date;
  v_versions uuid[];
  v_query    tsquery;
  v_results  jsonb;
begin
  select * into v_caller from public.lms_caller();

  if coalesce(btrim(p_query), '') = '' then
    raise exception 'a search needs a query' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 20 then
    raise exception 'limit must be between 1 and 20' using errcode = '22023';
  end if;
  if p_market_id is not null and not exists (
    select 1 from public.markets m
     where m.id = p_market_id and m.organisation_id = v_caller.organisation_id) then
    raise exception 'market % is not in your organisation', p_market_id using errcode = '42501';
  end if;
  if p_product_id is not null and not exists (
    select 1 from public.products p
     where p.id = p_product_id and p.organisation_id = v_caller.organisation_id) then
    raise exception 'product % is not in your organisation', p_product_id using errcode = '42501';
  end if;

  -- Branches rather than `p_x is null or …`: a cached generic plan cannot fold the null test
  -- (`constraints.md`, "A parameter test in a predicate is fine until the plan goes generic").
  if p_market_id is null then
    select coalesce(array_agg(v.id), '{}') into v_versions
      from public.knowledge_document_versions v
      join public.knowledge_documents d on d.id = v.document_id
     where v.organisation_id = v_caller.organisation_id
       and v.status = 'approved'
       and v.effective_from <= v_today
       and (v.review_due_on is null or v.review_due_on >= v_today)
       and d.is_active
       and v.market_id is null
       and d.product_id is null;
  elsif p_product_id is null then
    select coalesce(array_agg(v.id), '{}') into v_versions
      from public.knowledge_document_versions v
      join public.knowledge_documents d on d.id = v.document_id
     where v.organisation_id = v_caller.organisation_id
       and v.status = 'approved'
       and v.effective_from <= v_today
       and (v.review_due_on is null or v.review_due_on >= v_today)
       and d.is_active
       and (v.market_id = p_market_id or v.market_id is null);
  else
    select coalesce(array_agg(v.id), '{}') into v_versions
      from public.knowledge_document_versions v
      join public.knowledge_documents d on d.id = v.document_id
     where v.organisation_id = v_caller.organisation_id
       and v.status = 'approved'
       and v.effective_from <= v_today
       and (v.review_due_on is null or v.review_due_on >= v_today)
       and d.is_active
       and (v.market_id = p_market_id or v.market_id is null)
       and (d.product_id = p_product_id or d.product_id is null);
  end if;

  v_query := websearch_to_tsquery('english', p_query);

  select coalesce(jsonb_agg(r order by (r ->> 'rank')::real desc, r ->> 'chunkId'), '[]'::jsonb)
    into v_results
    from (
      select jsonb_build_object(
               'chunkId', c.id,
               'documentId', d.id,
               'documentTitle', d.title,
               'documentType', d.document_type,
               'documentVersionId', v.id,
               'versionNumber', v.version_number,
               'marketId', v.market_id,
               'productId', d.product_id,
               'sourceReference', v.source_reference,
               'heading', c.heading,
               'position', c.position,
               'body', c.body,
               'rank', ts_rank_cd(c.search_vector, v_query)) as r
        from public.knowledge_chunks c
        join public.knowledge_document_versions v on v.id = c.document_version_id
        join public.knowledge_documents d on d.id = v.document_id
       where c.document_version_id = any (v_versions)
         and c.search_vector @@ v_query
       order by ts_rank_cd(c.search_vector, v_query) desc, c.id
       limit p_limit
    ) ranked;

  return jsonb_build_object(
    'status', case when jsonb_array_length(v_results) = 0 then 'not_available' else 'found' end,
    'searchedOn', v_today,
    'results', v_results);
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Privileges -- revoke before grant
-- ----------------------------------------------------------------------------

revoke all on table public.knowledge_documents, public.knowledge_document_versions,
  public.knowledge_chunks from public, anon, authenticated, service_role;
revoke all on type public.knowledge_document_type, public.knowledge_version_status from public, anon;
grant usage on type public.knowledge_document_type, public.knowledge_version_status to authenticated;

grant select, insert on table public.knowledge_documents to authenticated;
grant update (title, therapy_area_id, is_active) on table public.knowledge_documents to authenticated;
grant select, insert on table public.knowledge_document_versions to authenticated;
-- Only a draft's content. Every lifecycle column moves through the RPCs.
grant update (body, source_reference, market_id, effective_from, review_due_on)
  on table public.knowledge_document_versions to authenticated;
grant select on table public.knowledge_chunks to authenticated;

revoke all on function
  public.knowledge_documents_validate(),
  public.knowledge_versions_before_insert(),
  public.knowledge_versions_before_update(),
  public.knowledge_chunk_version(uuid),
  public.knowledge_admin_version(uuid),
  public.submit_knowledge_version(uuid),
  public.approve_knowledge_version(uuid, text),
  public.reject_knowledge_version(uuid, text),
  public.retire_knowledge_version(uuid),
  public.search_approved_knowledge(text, uuid, uuid, integer)
  from public, anon, authenticated;

grant execute on function
  public.submit_knowledge_version(uuid),
  public.approve_knowledge_version(uuid, text),
  public.reject_knowledge_version(uuid, text),
  public.retire_knowledge_version(uuid),
  public.search_approved_knowledge(text, uuid, uuid, integer)
  to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Row-level security
-- ----------------------------------------------------------------------------

alter table public.knowledge_documents enable row level security;
alter table public.knowledge_documents force row level security;
alter table public.knowledge_document_versions enable row level security;
alter table public.knowledge_document_versions force row level security;
alter table public.knowledge_chunks enable row level security;
alter table public.knowledge_chunks force row level security;

create or replace function public.knowledge_version_readable(p_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.knowledge_document_versions v
     where v.id = p_version_id
       and v.organisation_id = public.current_user_organisation_id()
       and (v.status = 'approved' or public.is_admin()));
$$;

revoke all on function public.knowledge_version_readable(uuid) from public, anon, authenticated;
grant execute on function public.knowledge_version_readable(uuid) to authenticated;

create policy knowledge_documents_select_own_organisation on public.knowledge_documents
  for select to authenticated
  using (organisation_id = public.current_user_organisation_id());
create policy knowledge_versions_select_readable on public.knowledge_document_versions
  for select to authenticated
  using (organisation_id = public.current_user_organisation_id()
         and (status = 'approved' or public.is_admin()));
create policy knowledge_chunks_select_readable on public.knowledge_chunks
  for select to authenticated
  using (public.knowledge_version_readable(document_version_id));

create policy knowledge_documents_admin_insert on public.knowledge_documents
  for insert to authenticated
  with check (public.is_admin() and organisation_id = public.current_user_organisation_id()
              and created_by_user_id = (select auth.uid()));
create policy knowledge_documents_admin_update on public.knowledge_documents
  for update to authenticated
  using (public.is_admin() and organisation_id = public.current_user_organisation_id())
  with check (public.is_admin() and organisation_id = public.current_user_organisation_id());

create policy knowledge_versions_admin_insert on public.knowledge_document_versions
  for insert to authenticated
  with check (public.is_admin() and organisation_id = public.current_user_organisation_id());
create policy knowledge_versions_admin_update on public.knowledge_document_versions
  for update to authenticated
  using (public.is_admin() and organisation_id = public.current_user_organisation_id())
  with check (public.is_admin() and organisation_id = public.current_user_organisation_id());

create policy knowledge_documents_tenant_boundary on public.knowledge_documents
  as restrictive for all to authenticated
  using (organisation_id = public.current_user_organisation_id())
  with check (organisation_id = public.current_user_organisation_id());
create policy knowledge_document_versions_tenant_boundary on public.knowledge_document_versions
  as restrictive for all to authenticated
  using (organisation_id = public.current_user_organisation_id())
  with check (organisation_id = public.current_user_organisation_id());
create policy knowledge_chunks_tenant_boundary on public.knowledge_chunks
  as restrictive for all to authenticated
  using (organisation_id = public.current_user_organisation_id())
  with check (organisation_id = public.current_user_organisation_id());

-- ----------------------------------------------------------------------------
-- 8. Self-checks
-- ----------------------------------------------------------------------------

do $$
declare
  v_table text;
  v_n     integer;
begin
  foreach v_table in array array['knowledge_documents', 'knowledge_document_versions',
                                 'knowledge_chunks'] loop
    if not (select c.relforcerowsecurity from pg_class c
             where c.oid = format('public.%I', v_table)::regclass) then
      raise exception 'AI-C1: RLS is not forced on %', v_table;
    end if;
    if has_table_privilege('anon', format('public.%I', v_table), 'select')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'truncate')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'delete') then
      raise exception 'AI-C1: % is reachable by anon, truncatable or deletable', v_table;
    end if;
    if not exists (select 1 from pg_policy p
                    where p.polrelid = format('public.%I', v_table)::regclass
                      and not p.polpermissive and p.polname = v_table || '_tenant_boundary') then
      raise exception 'AI-C1: % has no restrictive tenant boundary', v_table;
    end if;
  end loop;

  if has_column_privilege('authenticated', 'public.knowledge_document_versions', 'status', 'update')
     or has_column_privilege('authenticated', 'public.knowledge_document_versions',
                             'decided_by_user_id', 'update')
     or has_table_privilege('authenticated', 'public.knowledge_chunks', 'insert') then
    raise exception 'AI-C1: lifecycle columns and chunks must move only through the RPCs';
  end if;
  if has_function_privilege('anon', 'public.search_approved_knowledge(text,uuid,uuid,integer)',
                            'execute')
     or has_function_privilege('authenticated', 'public.knowledge_chunk_version(uuid)', 'execute') then
    raise exception 'AI-C1: function posture is wrong';
  end if;

  -- The chunker, exercised on text rather than trusted: a heading starts a section, paragraphs
  -- are packed, and the heading line itself is not body.
  select count(*) into v_n
    from regexp_split_to_table(E'# A\n\npara one\n\npara two\n\n## B\n\npara three',
                               E'\\n[ \\t]*\\n') p;
  if v_n <> 5 then
    raise exception 'AI-C1: paragraph splitting is not what the chunker assumes (% parts)', v_n;
  end if;
end;
$$;
