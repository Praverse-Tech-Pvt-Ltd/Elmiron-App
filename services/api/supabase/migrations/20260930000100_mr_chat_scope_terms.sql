-- ---------------------------------------------------------------------------
-- W1-I Part B — `mr_chat_scope_terms()`: the catalogue half of what keeps the
-- general assistant out of product territory.
--
-- ## Why this exists at all
--
-- `mr_chat` is the general in-app assistant — how a process works, where a screen
-- is, what a policy says. `AI-SPEC.md` §2 A1 is explicit that it is **not** a
-- product-information tool: a product question must go through `product_qa`,
-- which is constrained to approved material and cites it.
--
-- That leaves the question W1-I Part B asks directly: **what stops a free-text
-- assistant inventing a product or medical claim?** The honest answer is that its
-- prompt does not, because a prompt is a request and not a control. So the control
-- is code, and it needs data: the names of the caller's own products.
--
-- **This function is that data, and where it comes from is the point.** It reads
-- `public.products` for the caller's organisation. The terms are that tenant's real
-- catalogue — not a keyword list somebody typed into a TypeScript file, which would
-- go stale the first time a product was renamed and would be wrong for every other
-- organisation from the moment it was written.
--
-- `packages/core/src/field/gateway/mr-chat.ts` then refuses on both sides: if the
-- rep's message names a term the model is never called, and if the model's ANSWER
-- names one the answer is discarded. The second is the half a prompt cannot do.
--
-- ## Why it returns only names, and nothing else
--
-- **No ids, no therapy area, no `is_active`, no counts.** The caller needs strings
-- to match against and nothing more, and every extra column would be operational
-- data leaving the database for a purpose nobody asked for — the same reason
-- `ai_requests` stores no question and no answer.
--
-- **Inactive products are INCLUDED, deliberately.** A discontinued brand is exactly
-- the kind of thing a rep might ask about and exactly the kind of answer that must
-- not be improvised. `is_active` governs whether something may be promoted, not
-- whether its name is a product name.
--
-- ## Tenancy
--
-- `security definer` with `search_path = ''`, resolving the organisation from
-- `lms_caller()` rather than from an argument — so there is no parameter through
-- which one tenant could ask for another's catalogue. The cross-tenant assertion is
-- in `services/api/tests/mr-chat.spec.ts`, two-sided with a positive control.
-- ---------------------------------------------------------------------------

create or replace function public.mr_chat_scope_terms()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller record;
  v_terms  text[];
begin
  select * into v_caller from public.lms_caller();

  -- Brand names and generic names, both. A rep asking about a molecule by its
  -- non-proprietary name is asking a product question just as much as one using the
  -- brand, and `generic_name` is nullable so the filter is explicit rather than
  -- relying on `array_agg` skipping nulls quietly.
  select coalesce(array_agg(distinct t.term), '{}')
    into v_terms
    from (
      select p.brand_name as term
        from public.products p
       where p.organisation_id = v_caller.organisation_id
      union
      select p.generic_name
        from public.products p
       where p.organisation_id = v_caller.organisation_id
         and p.generic_name is not null
    ) t
   where length(btrim(t.term)) > 0;

  return jsonb_build_object('terms', to_jsonb(v_terms));
end;
$$;

comment on function public.mr_chat_scope_terms() is
  'W1-I: the caller organisation''s product and generic names, for mr_chat''s out-of-scope check. '
  'Names only -- the caller needs strings to match, and anything more would be operational data '
  'leaving the database for no stated purpose.';

-- The same posture every control-plane function has: nobody by default, `authenticated` explicitly.
-- `anon` must never reach it — a product catalogue is a commercial fact about a tenant, and
-- `privilege-posture.spec.ts` asserts the absence rather than trusting this line.
revoke all on function public.mr_chat_scope_terms() from public, anon, authenticated;
grant execute on function public.mr_chat_scope_terms() to authenticated;
