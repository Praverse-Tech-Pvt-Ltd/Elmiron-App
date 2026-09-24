-- Rollback for AI-C2 -- the knowledge search requires ALL terms of the question again.
--
-- What rolling back MEANS: naturally worded questions stop finding approved text worded
-- differently, and `product_qa` answers "not available" to most of them (the defect AI-C2 fixed).
-- Nothing is lost or exposed; the function body below is AI-C1's, verbatim.

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
