-- ============================================================================
-- MR-43 B1 -- audit_log.id HAS GAPS, and the reason belongs beside the table.
-- ============================================================================
--
-- WHAT HAPPENED
--
-- MR-42 measured a cross-tenant write probe inside transactions that were rolled back.
-- Zero rows were committed -- and `audit_log_id_seq` still advanced 29337 -> 29356.
-- Nineteen ids exist in no row and never will.
--
-- WHY IT WILL KEEP HAPPENING
--
-- Sequences are non-transactional, by design: `nextval()` does not roll back, because
-- two concurrent transactions must never be handed the same value and a rollback cannot
-- be allowed to take a number away from a peer that is still using it. So ANY rolled-back
-- transaction anywhere -- a failed write, a refused RPC, a test, a probe, a deadlock
-- victim -- consumes ids permanently.
--
-- WHY THE COMMENT IS HERE AND NOT ONLY IN A SESSION NARRATIVE
--
-- This table's entire value is that nothing can be removed from it: no UPDATE, no DELETE,
-- no TRUNCATE, by any role, enforced by a statement-level trigger. **A gap in the id
-- sequence of an append-only ledger looks exactly like a deleted row.** The person who
-- notices nineteen missing ids will be an auditor, or an engineer answering an auditor,
-- and they will be looking at the table -- not at a markdown file in a repository they
-- may not have.
--
-- So the answer is attached to the column. `\d+ public.audit_log` carries it, and so does
-- every schema browser.
--
-- WHAT THIS MEANS FOR INTEGRITY CHECKING
--
-- **Contiguity can never be an integrity check on this table.** `max(id) - min(id) + 1 =
-- count(*)` is false here in normal operation and says nothing about whether a row was
-- removed. The guarantees that DO hold are the trigger (nothing can be deleted), the
-- forced RLS with no policy, and the fact that every audited read writes its row BEFORE
-- returning data.
--
-- Nothing in this repository currently asserts contiguity -- checked at MR-43 B2, across
-- the migrations, the tests, the scripts and the client. `list_audit_log` paginates with
-- `l.id < p_before_id`, which is an ORDERING and is gap-safe. This comment exists so that
-- the next person to reach for a contiguity check finds the reason not to first.
-- ============================================================================

comment on column public.audit_log.id is
  'Monotonic, NOT contiguous. Sequences are non-transactional, so every rolled-back '
  'transaction anywhere in the system consumes ids permanently -- a failed write, a '
  'refused RPC, a test, a probe. MR-42 left a 19-id gap this way with zero rows '
  'committed. A GAP IS NOT A DELETED ROW: deletion is impossible here, enforced by the '
  'statement-level trigger on this table. Never use contiguity as an integrity check; '
  'use the trigger, the forced RLS, and the audit-before-return ordering. Ordering by id '
  'is safe and is what list_audit_log paginates on.';
