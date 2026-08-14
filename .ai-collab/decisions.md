# Decisions

> **The real decision log is `PROJECT-OVERVIEW.md`** — "Architecture decisions", the
> reviewer decisions, and one `###` section per week under "Phase log". It is tracked,
> append-only, and reviewed. **Do not duplicate it here**; a second copy drifts, and a
> drifted decision log is worse than none.
>
> This file holds only decisions **not yet written there**, and a short index of where
> the big ones live.

---

## BE-W7 — 16 August 2026 · Model: Claude Opus 5

All of these are written up in full in `PROJECT-OVERVIEW.md` → BE-W7. Kept here in
one-line form for scanning.

### Scheduled GitHub Actions, not `pg_cron`

- **Decision:** two scheduled workflows (worker + separate watchdog), plus a
  database-side backstop that refuses new audio when the purge stalls.
- **Alternatives:** `pg_cron` + `pg_net` calling an Edge Function (the reviewer's
  recommendation); `pg_cron` doing the whole job in SQL.
- **Why this won:** `pg_net` is asynchronous, so a SQL worker would have to confirm a
  destruction before knowing the delete succeeded — which destroys the one guarantee
  the design has. An Edge Function means a second implementation of a
  compliance-critical worker, and the local stack runs no edge runtime, so it could
  not be tested at all. Both extensions were verified available first, so this is a
  choice and not a limitation.
- **Cost accepted:** the schedule lives in the repo, not next to the data. Mitigated
  by the backstop, which cannot be switched off.

### The upload grant covers the whole object

- **Decision:** one grant per object, re-validated on every resume and chunk;
  single-use means consumed at **finalisation**, not at first byte. Two clocks — a
  15-minute slide under an immovable 24-hour ceiling.
- **Alternative:** a grant per chunk.
- **Why this won:** a grant is permission to write one object at one key, and the key
  is unique — per-chunk grants would re-issue the same key repeatedly, which makes
  "single-use" meaningless rather than stricter.

### Consent is checked *before* session state

- **Decision:** in `assert_upload_still_permitted`, consent first.
- **Why:** the withdrawal cascade sets the session to `revoked`, so a state-first
  ordering tells the MR "this grant is revoked" — true, useless, and it maps to
  `validation_failed`, whose sentence is *"the server refused the contents of this
  item"*. The MR would be told their recording was malformed when the doctor simply
  changed their mind.

### The reconciliation does not fabricate a withdrawal

- **Decision:** quarantine the visit; a named person clears it with a mandatory
  reason.
- **Alternative:** insert the withdrawal the absence implies.
- **Why this won:** the ledger's entire value is that every row is a real thing a real
  doctor really did. An inferred row would be indistinguishable from a genuine one
  forever afterwards. A blocked recording is recoverable; an un-withdrawn consent is
  not.

### Quarantine scope is the visit, not the doctor

- **Decision:** visit. The doctor id is recorded on the finding so widening it is one
  insert.
- **Why:** a missing object can be an ordinary storage fault, and blocking a doctor
  on that evidence turns a *possible* compliance question into a *certain* outage
  across their territory. Stated rather than hidden, because it is a genuine trade.

### `storage_ceiling_exceeded` was drafted and removed

- **Why:** the ceiling is checked in `begin_upload`, which the client calls
  interactively, so the refusal never travels through the queue. A rejection code no
  code path can produce is a vocabulary entry that looks like coverage and is not.

### `reported_text` kept on the adverse-event record

- **Decision:** keep it, and flag it hard.
- **Why:** a report with no description discharges no duty. It is also the one field
  that can carry patient information — the §2.6-vs-DPDP contradiction nobody has
  ruled on. Omitting it would have decided that question silently by making the
  feature useless. **This is the top item for the PV/privacy sign-off.**

### An adverse-event report survives a consent withdrawal

- **Decision:** it survives.
- **Why:** a pharmacovigilance duty is a separate legal basis from consent, and
  destroying a statutory record to satisfy a privacy request is not a trade a schema
  should make on its own. **This is a default, not a ruling** — flagged for the
  sign-off.

---

## 17 August 2026 · Model: Claude Opus 5

### The retention schedules stay live while the secrets are absent

- **Decision:** leave `retention.yml` and `retention-watchdog.yml` firing on their
  cron with no secrets set, so both fail daily until deployment. **Do not** comment
  out the `schedule:` blocks, and do not add a skip.
- **Alternative:** disable the two schedules, keep `workflow_dispatch`, and re-enable
  them as a deployment step.
- **Why this won:** the daily red *is* the reminder. Disabling it removes the only
  thing that would otherwise surface a forgotten deployment step, and the window is
  about five weeks to pilot rather than open-ended.
- **Cost accepted, explicitly:** roughly 70 failed runs before pilot, and the alert
  fatigue that comes with them. If people start filtering these mails, the decision
  has failed and disabling the schedules becomes the better option — that is the
  signal to revisit, not a fixed date.
- **Why the absence was safe when this was written:** the remote database held none
  of the 17 migrations, so there were no `recordings` rows, no `received_at` on
  anything, and the 90-day clock had not started. There was also no field app.
  **If any of those three become false, this decision expires.**
- **The backstop that makes forgetting survivable:** `begin_upload` refuses new audio
  once objects are past their purge date. A forgotten purge becomes "uploads stop",
  not "audio retained unlawfully".

> ### EXPIRED THE SAME DAY — 17 August, a few hours later
>
> **`supabase db push` was run. All 17 migrations are deployed.** The first of the
> three conditions above is now false, so the reasoning that justified leaving the
> secrets unset no longer holds.
>
> What has *not* changed: the schedules should still stay live and red. That part of
> the decision was about skip-versus-fail and is unaffected.
>
> What HAS changed: **setting the secrets is now the correct next action rather than
> a premature one.** The specific objection — that a worker pointed at an empty
> database dies on `function public.claim_expired_audio does not exist`, a red that
> reads as a code defect — is gone, because the function now exists on the remote.
>
> Still true and still a reason for care: there is no seeded data and no field app,
> so a purge run would claim nothing. It would be green and harmless, which is the
> right state to reach before there is anything to lose.

---

## Where the earlier ones live

| Decision | Where |
| --- | --- |
| `admin` has full visibility, never authorship | `PROJECT-OVERVIEW.md` → "Settled by the reviewer, 11 Aug" |
| Audit row stays in the caller's transaction; no `dblink` | same |
| Immutability is a trigger, not a policy | → "Added in BE-W2" |
| RLS decides which rows, never what values | → "Standing principle" |
| Three requirements dropped (roles, versioning, source search) | → "Closed by the reviewer, 12 Aug" |
| `app_thresholds` is append-only, not updatable | → BE-W6 |
| Team-size floor of 8 for the consent anomaly | → BE-W6 |
| Withdrawal cascade order, and why the object is not deleted inline | → BE-W6 |
