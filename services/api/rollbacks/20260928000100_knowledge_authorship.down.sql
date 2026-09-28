-- Rollback for W1-A E1 -- knowledge versions stop saying who wrote them, and stop refusing.
--
-- **What rolling back MEANS, and it is not neutral.**
--
-- 1. **The authorship label is DROPPED, and the information in it is lost.** Any version marked
--    `ai_generated` becomes indistinguishable from a person's text. `C23`'s labelling half stops
--    existing. If any AI-drafted content has been loaded, roll back only if you are willing for
--    an approver to be unable to tell machine text from human text.
-- 2. **The insert path returns to COERCING.** An insert claiming `status = 'approved'` will once
--    again SUCCEED as a draft rather than failing, and an insert setting the review or approval
--    columns will be silently nulled instead of refused. Nothing becomes approved that was not
--    approved before -- the stored outcome stays correct either way -- but the caller stops being
--    told that what they asked for did not happen.
--
-- **The client does NOT need to be rolled back with this.** `packages/core`'s
-- `KnowledgeDocumentVersionSchema` would still declare `authorship` and `authoringModel`, and a
-- table read would return neither, so the schema parse fails. The console review screen
-- (`apps/console/src/app/knowledge/`) reads both. **So: roll the client back too, or the knowledge
-- review screen stops working.** This is the case `docs/gotchas.md` means by a rollback that must
-- state what else has to move with it.

-- Restores AI-C1's version byte-for-byte, from `20260924000600_knowledge.sql:199-237`.
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

alter table public.knowledge_document_versions
  drop constraint if exists knowledge_versions_authorship_names_its_model;

alter table public.knowledge_document_versions
  drop column if exists authoring_model,
  drop column if exists authorship;

-- Dropped after the column, not before: the type cannot go while a column still uses it.
drop type if exists public.knowledge_authorship;
