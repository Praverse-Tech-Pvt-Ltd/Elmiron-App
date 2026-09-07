-- FIX-05 Part C — a second control on every function in the schema.
--
-- FIX-04 audited seven `SECURITY DEFINER` functions that no client calls and found them
-- clean: each refused `anon` with `28000` from its own `auth.uid()` check. But that check
-- was the **only** control, because Postgres grants `EXECUTE` to `PUBLIC` on every new
-- function by default and nothing had revoked it. This repo's own rule is that a guard
-- which is not a trigger, a policy or a revoked grant is not a guard.
--
-- 65 of 86 functions in `public` were reachable by `anon`. The other 21 — the purge
-- worker's internals, the trigger functions, `custom_access_token_hook`,
-- `visible_territory_ids` — had already been revoked one at a time as they were written.
-- The practice existed; it was applied unevenly. This applies it to the rest.
--
-- **Nothing here changes who can do what.** Every function that `authenticated` could
-- call before, it can call after — the grant is now explicit rather than inherited from
-- `PUBLIC`. What changes is that `anon` is refused by the grant, before the function
-- body runs, in addition to being refused inside it.

do $$
declare
  r record;
begin
  -- Capture the explicit `authenticated` grants BEFORE the blanket revoke, so they can
  -- be put back exactly. Reading proacl is the only way to know which grants were
  -- deliberate rather than inherited from PUBLIC.
  create temporary table fix05_authenticated_grants on commit drop as
  select p.oid,
         quote_ident(n.nspname) || '.' || quote_ident(p.proname) ||
           '(' || pg_get_function_identity_arguments(p.oid) || ')' as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     and array_to_string(p.proacl, ',') like '%authenticated=X%';

  revoke execute on all functions in schema public from public;

  for r in select signature from fix05_authenticated_grants loop
    execute format('grant execute on function %s to authenticated', r.signature);
  end loop;
end
$$;

-- Future functions inherit the same posture rather than needing to remember. Without
-- this, the next migration reintroduces the PUBLIC grant for whatever it adds and the
-- audit has to be run again.
alter default privileges in schema public revoke execute on functions from public;
