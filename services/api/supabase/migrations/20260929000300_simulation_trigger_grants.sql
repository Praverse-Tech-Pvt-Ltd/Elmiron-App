-- W1-D fix -- the two simulation TRIGGER functions were left `anon`-executable.
--
-- **Caught by CI, not by me, and by a guard this repository already had.** Three tests went red on
-- the same root cause: `rls.spec.ts` ("fails the build if a new function is left anon-executable")
-- and `privilege-posture.spec.ts` B1 both named `sim_content_before_insert` and
-- `sim_content_before_update`.
--
-- **The rule they enforce, from `.ai-collab/constraints.md`:** *"Revoke before you grant."* Every
-- function in `public` is born executable by `PUBLIC`, so a function nobody revoked is a function
-- `anon` can call. `20260929000200` revoked the seven RPCs and **forgot these two**, because they
-- are attached to triggers and it is easy to think of a trigger function as not being callable --
-- it is, by name, by anyone.
--
-- **What the exposure actually was.** Neither function is dangerous to call directly: both read
-- `tg_table_name` and `new`/`old`, which are null outside a trigger, so a direct call errors. **That
-- is not the point.** The guard exists because the NEXT function left un-revoked might not be
-- harmless, and a posture that holds by luck is not a posture.
--
-- **Why this is a new migration rather than an edit to `20260929000200`.** That file has been
-- applied -- to this machine and to CI -- and `constraints.md` permits editing an applied migration
-- only under the single named MR-35 B3 exception, whose first condition is that no database has
-- applied it. This one has.

revoke all on function public.sim_content_before_insert() from public, anon, authenticated;
revoke all on function public.sim_content_before_update() from public, anon, authenticated;

-- A guard that fails the migration rather than leaving a quiet hole, in the style of
-- `20260923000400` and `20260929000200`.
do $$
begin
  if has_function_privilege('anon', 'public.sim_content_before_insert()', 'execute')
     or has_function_privilege('anon', 'public.sim_content_before_update()', 'execute') then
    raise exception 'W1-D: a simulation trigger function is still callable by anon';
  end if;
end;
$$;
