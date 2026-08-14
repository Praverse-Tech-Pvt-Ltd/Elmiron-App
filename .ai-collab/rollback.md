# Rollback

> **Pointer file.** This project has a rollback system that is **actually executed**,
> which beats a markdown description of one:
>
> - `services/api/rollbacks/*.down.sql` — one per migration, no exceptions.
> - `pnpm --filter @elmiron/api verify:rollbacks` — applies **every** rollback in
>   reverse order and asserts the `public` schema comes back empty. Runs in CI, last,
>   because it is destructive.
> - `docs/restore-runbook.md` — what to do after a database restore, which is a
>   different and much more dangerous operation.
>
> BE-W1 shipped rollback SQL that nothing ever ran. A file that has never been
> executed is a claim, not a rollback. That is why the verifier exists.

---

## Ordinary code change

`git revert`. Nothing here needs a plan.

## A migration

1. `psql "$SUPABASE_DB_URL" -f services/api/rollbacks/<migration>.down.sql`
2. Remove the migration file, or it will re-apply.
3. `pnpm --filter @elmiron/api verify:rollbacks && pnpm db:reset`

**Things that do not roll back cleanly, and are documented in the files themselves:**

- **Enum values.** Postgres has no `ALTER TYPE ... DROP VALUE`. The parent types are
  dropped further down the reverse order, so a *full* rollback is clean; a partial one
  leaves unused labels. Accepted deliberately.
- **Narrowing a CHECK on an append-only table.** `ADD CONSTRAINT` validates existing
  rows, and you may not delete the rows that violate it. Use `NOT VALID`.
- **Storage objects.** A row delete does not delete an object. **Empty the `audio`
  bucket through the storage API before rolling back anything that owns objects**, or
  the files outlive the schema.

## Two rollbacks that are compliance events, not engineering ones

Both files say so at the top, in place, so nobody meets the warning only here.

- **`20260816000400_restore_reconciliation.down.sql`** releases every quarantined
  visit at once. A quarantined visit is one whose consent state could not be trusted
  after a restore, so this is a decision to resume recording those doctors without the
  question having been answered. **Read `restore_reconciliation_findings` first — the
  rollback drops it.**
- **`20260816000500_adverse_events.down.sql`** drops `adverse_event_reports`, which
  holds statutory records with a 15-day reporting deadline. **Export it first:**
  `\copy (select * from public.adverse_event_reports) to 'ae-reports.csv' csv header`

## The scheduled workflows

Deleting `.github/workflows/retention.yml` stops the purge. Nothing in the database
will say so, but `begin_upload` starts refusing new audio once objects go 48 hours
past their purge date — so the symptom is MRs being unable to record, not silence.
That is the intended failure mode.
