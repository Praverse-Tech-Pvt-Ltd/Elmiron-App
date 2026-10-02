-- Rollback for the W1-D trigger-grant fix.
--
-- **What rolling back MEANS: `anon` regains EXECUTE on the two simulation trigger functions**, and
-- `rls.spec.ts` plus `privilege-posture.spec.ts` will go red again naming them. Neither function is
-- useful to call directly -- both read trigger-only variables and error outside a trigger -- but the
-- posture check is a population rule, not a judgement about individual functions, and it will fail.
--
-- There is no data to restore; this file exists because every migration has one.

grant execute on function public.sim_content_before_insert() to public;
grant execute on function public.sim_content_before_update() to public;
