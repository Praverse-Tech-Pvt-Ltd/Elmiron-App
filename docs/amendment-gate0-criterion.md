# Amendment 1 — Gate 0 pass criterion

**Date:** 10 August 2026
**Amends:** `mr-work-split.md` §3 (Gate G0) · `backend-brief.md` §2.1 and §7
**Raised by:** BE-W1 review, empirically
**Decided by:** Reviewer

---

## The problem

The original criterion read: **"Permission denied, not an empty result."**

That is not satisfiable by row-level security, and it is not what the criterion was meant to test.

RLS filters rows through a `USING` clause. A `SELECT` that excludes rows returns **zero rows**, not an error. Writes are not uniform either:

| Operation | Outside the user's scope | Actual result |
|---|---|---|
| `SELECT` filtered by `USING` | | `200 []` |
| `INSERT` violating `WITH CHECK` | | `42501` → **403** |
| `UPDATE` where `USING` excludes the row | | **0 rows affected, no error** |
| `DELETE` where `USING` excludes the row | | **0 rows deleted, no error** |
| No `SELECT` grant on the table at all | | **permission denied** |

Only the last row matches the original wording. The criterion was a badly chosen proxy for the property that actually matters.

## What the criterion was protecting against

**Scope filtering living in application code**, where the next endpoint someone adds forgets it, a refactor drops it, or a debug route bypasses it.

That risk is real. It is just tested differently.

---

## The corrected criterion

Gate 0 passes when all four hold.

### 1. Direct-to-database test

Every scope test issues its query against **PostgREST or Postgres using the user's own JWT, with no application code in the path.**

- Row hidden there → RLS is the enforcement layer. Pass.
- Row visible there but not through the app → the filter is in application code. **Fail.**

### 2. The property is non-disclosure and non-mutation, not the status code

`403`, `200 []` and `0 rows affected` are **all acceptable outcomes.**

What must never happen:

- an out-of-scope row is **returned**, or
- an out-of-scope row is **changed**.

### 3. Permission-denied is still required where there is no grant

Schema-level `USAGE` revocations, and tables a role has no `SELECT` grant on, **must error**. They must not return empty. This is the case the original wording was right about, and it still applies.

### 4. No application-layer scope filtering may exist

Search for it. A route that hand-filters by user id "for safety" is a **finding**, not a mitigation — it masks RLS gaps rather than closing them, and it hides exactly the bug this gate exists to catch.

---

## Rejected option

**RPC-only reads** — hand-writing every read as a Postgres function to force a 403.

Rejected. Enormous ongoing cost for a different HTTP status code. RLS already prevents the disclosure; the status code is cosmetic.

---

## Carried into BE-W2 — tasks, not suggestions

| # | Task | Status | Why it must not wait |
|---|---|---|---|
| 1 | **Write-time trigger rejecting `territories` cycles.** Reject on insert/update rather than relying on the read-side guard. | **Open — BE-W2** | The `CYCLE` clause makes the read safe. It does not make a cycle unrepresentable. Only `service_role` can write territories today, so this is not reachable — but the admin write APIs land in week 11, and by then nobody will remember this. |
| 2 | **`statement_timeout` on `visible_territory_ids`.** | **Done in BE-W1** | An unbounded user-facing recursive query is a denial-of-service surface independent of the cycle bug. Set to `5s` on the function itself, not left to the caller. |
| 3 | **`reporting_manager_id` constraints.** Nothing requires the referenced user to be a `field_manager` or `admin`, and there is no cycle guard on the management chain. | **Open — BE-W2** | Same class of defect as the territory cycle, lower stakes. A management chain cycle would hang any future recursive query over it. |

---

## Note for the BE-W2 reviewer

Both defects found in the BE-W1 review were in the **test harness and the guard rails**, not in the feature code. The features were correct. That is the normal pattern: the code under active attention gets scrutiny, the scaffolding around it does not.

BE-W2's RLS suite **is** the deliverable. Point that instinct at the suite itself, not only at the policies it tests — a passing adversarial suite that cannot fail is worth less than no suite at all.

---

*The original criterion was the reviewer's own and it was wrong. Recorded here rather than quietly corrected, so the reasoning survives to week 2.*
