-- FIX-07 B2 — a schema change made to meet the contract, stated as such.
--
-- `CreateVisitRequestSchema` declares `id`, `doctorId`, `beatPlanId`, `clinicAddressId`
-- and `scheduledFor`. It does **not** declare `mrId`. The insert policy requires
-- `mr_id = auth.uid()`, and the column has no default, so the request the contract
-- describes could never have satisfied the policy it has to pass. Nobody found that
-- because no client had ever posted a visit to a real server.
--
-- Two ways to close it: have the client send its own uid, or have the column default to
-- it. **The default is the stronger one.** A client that supplies `mr_id` can supply
-- somebody else's — the policy would refuse it, but the attempt would be shaped like an
-- ordinary request, and the identity would be travelling over the wire for no reason. A
-- default means the caller cannot express the wrong answer at all.
--
-- This does not weaken the policy, which still evaluates `mr_id = auth.uid()` after the
-- default is applied. It removes the case where the only correct value had to be sent by
-- the party least entitled to assert it.
--
-- `service_role` and the test fixtures still pass `mr_id` explicitly, and the default is
-- not reached for them. Under `service_role`, `auth.uid()` is null and the NOT NULL
-- constraint would reject an omitted value -- loudly, which is correct.

-- Plain `auth.uid()`, not `(select auth.uid())`. The subquery form is a policy
-- optimisation -- it lets the planner evaluate it once as an InitPlan -- and a DEFAULT
-- expression cannot contain a subquery at all: `cannot use subquery in DEFAULT
-- expression (0A000)`.
alter table public.visits
  alter column mr_id set default auth.uid();

comment on column public.visits.mr_id is
  'Defaults to auth.uid() so the client never has to assert its own identity. The '
  'visits_insert_own policy still enforces mr_id = auth.uid(). See FIX-07.';
