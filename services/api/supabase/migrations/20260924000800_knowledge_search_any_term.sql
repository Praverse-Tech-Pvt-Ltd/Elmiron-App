-- ============================================================================
-- AI-C2 -- knowledge search matches ANY term of the question, ranked, instead of ALL of them.
-- ============================================================================
--
-- **A defect in AI-C1 (`20260924000600`), found by the first end-to-end test of the feature that
-- uses it** (`services/api/tests/ai-product-qa.spec.ts`). `websearch_to_tsquery` ANDs every word:
-- "What is the storage temperature for Benchmarol tablets?" required `storag` AND `temperatur`
-- in the same chunk, and a label that says "Store Benchmarol tablets below 25 °C" has neither.
-- Every naturally worded question returned `not_available` against naturally worded approved
-- text. It failed SAFE -- nothing wrong was ever said -- and it would have made the feature useless.
-- `knowledge.spec.ts` did not catch it because its fixtures were written with the query's words.
--
-- **Why loosening retrieval is safe here.** The search still returns ONLY approved, in-date,
-- in-market, in-organisation text; scope is resolved before any text is compared, unchanged. What
-- decides whether an answer is given is not retrieval: the model must say whether the sources
-- answer the question, and every citation must be a chunk it was shown (`answerProductQuestion`).
-- Retrieval's job is recall inside the approved set; the model and the citation check do precision.
--
-- **What still returns `not_available` without asking a model:** nothing approved in scope, or no
-- shared content word at all.
--
-- **Written as a new migration, not an edit to AI-C1.** AI-C1 has never been applied outside this
-- branch, but `.ai-collab/constraints.md` asks for a new migration over an edit, and the one
-- exception it records has four conditions this case does not need to argue.
--
-- Only the query line differs from AI-C1; the rest of the body is copied verbatim, so
-- `create or replace` keeps the function's grants.

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

  -- AI-C2: ANY content word of the question, ranked -- not ALL of them. `plainto_tsquery` yields
  -- `'a' & 'b' & …`; the ampersands become OR. A question worded differently from the label
  -- ("storage temperature" vs "Store below 25 °C") still reaches the right chunk, ranked by how
  -- many terms it shares. A question of stop words only yields an empty query and matches nothing.
  v_query := replace(plainto_tsquery('english', p_query)::text, ' & ', ' | ')::tsquery;

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

do $$
declare
  v_def text := pg_get_functiondef('public.search_approved_knowledge(text,uuid,uuid,integer)'::regprocedure);
begin
  if position('websearch_to_tsquery' in v_def) > 0 or position(''' | ''' in v_def) = 0 then
    raise exception 'AI-C2: the search is not the any-term version';
  end if;
  if has_function_privilege('anon', 'public.search_approved_knowledge(text,uuid,uuid,integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.search_approved_knowledge(text,uuid,uuid,integer)', 'execute') then
    raise exception 'AI-C2: create or replace changed the grants';
  end if;
  -- The query transformation itself, on a question of the shape that failed.
  if replace(plainto_tsquery('english', 'What is the storage temperature for Benchmarol tablets?')::text, ' & ', ' | ')::tsquery
     @@ to_tsvector('english', 'Store Benchmarol tablets below 25 °C') is not true then
    raise exception 'AI-C2: a differently worded question still does not reach the label';
  end if;
end;
$$;
