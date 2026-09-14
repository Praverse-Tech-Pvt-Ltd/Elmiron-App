# Restoring the database is a compliance event

**Not a routine operation.** On most projects a point-in-time restore is an
inconvenience with a bit of lost work. On this one it silently rewrites the record of
what a doctor agreed to, and it can leave audio in storage that nothing on earth has
a lawful basis to hold.

Read this before you restore, not after.

---

## Why a restore breaks this system specifically

Two facts from Supabase's own documentation, each unremarkable, hazardous together:

> "When you delete one or more objects from a bucket, **the files are permanently
> removed and not recoverable.**"
> — https://supabase.com/docs/guides/storage/management/delete-objects

> "**Database backups do not include objects you store via the Storage API**, as the
> database only includes metadata about these objects. Restoring an old backup does
> not restore objects you deleted after that backup."
> — https://supabase.com/docs/guides/platform/backups

So a restore rewinds **the database** and not **the objects**. The two halves of
every recording come apart, in both directions at once.

### Direction one — the database remembers audio that is gone

A restore to a point before a consent withdrawal:

- **Un-withdraws the consent.** The withdrawal row disappears. The ledger now says
  the doctor consented and never withdrew.
- Leaves the audio genuinely destroyed, because objects do not come back.
- Leaves `recordings` rows pointing at objects that no longer exist.

The first of those is the serious one. The consent ledger exists to prove what a
doctor agreed to, and a restore has just made it lie.

### Direction two — storage holds audio nothing knows about

The mirror case, and the one that is a live breach rather than a stale row.

An upload that completed **after** the restore point has its `recordings` row rewound
away while the object stays in the bucket. What is left is audio with:

- no consent record covering it,
- no retention clock governing it,
- and no way to acquire either after the fact, because the rows that would have said
  whose visit it was are gone.

It will sit there until somebody notices. Nothing will notice, because the only thing
that walks the bucket is the reconciliation below.

### Why `storage.objects` cannot tell you any of this

`storage.objects` is an ordinary table in the same database. A restore rewinds it
alongside `public.recordings`. Comparing the two afterwards compares two things that
travelled back together and finds nothing wrong.

The object store is the only witness that did not move. Every check here goes over
HTTP for that reason.

---

## The procedure

### 1. Before you restore

- Write down the restore target time. You will need it for the reconciliation note.
- Understand that **no audio uploaded after that time will survive as a usable
  recording**, whatever the restore does to the database.

### 2. Restore

**This step said only "Restore." until MR-32.** PITR was deliberately not purchased, so there
is no point-in-time restore to invoke. MR-33 built the mechanism; **what is still missing is a
place to put the artefact**, and that is a decision rather than a gap in the code.

### 2a. Produce an artefact, and prove it restores

```bash
# Produce. --container is for a machine where the Postgres client lives in the
# supabase_db container rather than on PATH, which is the case on the dev machine.
pnpm --filter @fieldforce/api backup:database \
  --container supabase_db_Elmiron-App --out ./backups

# Prove it. This is not optional and it is not the same step: producing an artefact and
# having a restorable one are different claims, and only this one is evidence.
pnpm --filter @fieldforce/api backup:verify \
  --artefact ./backups/elmiron-<stamp>.sql --container supabase_db_Elmiron-App
```

`backup:database` writes a plain-SQL dump of the **whole database** and a manifest beside it
carrying the sha256, the byte count, and counts taken from the source in the same run:
migrations, tables, tables with RLS, policies, and rows in `consent_records`, `visits`,
`doctors`, `app_thresholds` and `auth.users`.

`backup:verify` re-hashes the file, restores it into a scratch database it creates and drops,
and **compares those counts by querying the restored copy**. It refuses to restore over an
existing database — a verifier that can overwrite the thing it is verifying is a delete
command with a reassuring name.

> **Do not use `supabase db dump` for this.** The project depends on that CLI and it is the
> obvious choice, and it is scoped to `public`: measured against the local stack it produces a
> schema dump with **zero `auth.` and zero `storage.` tables** and a `--data-only` dump with
> **zero rows of `auth.users`**. A database restored from it holds the consent ledger and has
> **nobody who can sign in**, with `storage.objects` empty — which is the metadata the
> reconciliation in step 3 walks. It looks like a backup. It is not one.

### 2b. The artefact has to leave this machine, and that needs a decision

**`BE-W11` is not closed.** The producer and the verifier exist and are proven; the schedule
exists in `.github/workflows/backup.yml` and **fails every day on purpose**, because no
destination is configured.

That is deliberate. A dump of this database contains `doctors.full_name`, `user_profiles`,
`transcripts_redacted`, every row of `auth.users`, and `adverse_event_reports.reported_text` —
whose lawful contents are **open question 4.1**, the PV/DPDP escalation that has never been
answered. Where that file may land is a data-processing decision, not an engineering one, so
the workflow checks for a destination **before** it produces anything: a failing run leaves no
artefact anywhere.

See `docs/blocked-on-you.md` → the `BE-W11` destination item for the options and what each
costs.

### 2c. The platform's own restore, which is still untested

If the restore you are doing is a Supabase platform restore rather than one from an artefact
above, **none of this section describes it.** Whether it takes minutes or hours, whether it
needs a support ticket, and what it does to roles, extensions and `supabase_admin`-owned
settings is unverified — production credentials are not on the machine this was written on.
Steps 3 to 5 apply either way.

### What MR-32 proved about the data path

Drilled against a scratch target in the local cluster:

```bash
# Dump. On Windows + Git Bash, MSYS_NO_PATHCONV=1 is required or the container path
# /tmp/drill.sql is rewritten to a Windows path and pg_dump fails.
export MSYS_NO_PATHCONV=1
docker exec supabase_db_Elmiron-App pg_dump -U postgres -d postgres \
  --format=plain --no-owner --no-privileges -f /tmp/drill.sql

# Restore into a SCRATCH database, never over the live one.
docker exec supabase_db_Elmiron-App psql -U postgres -d postgres -c "create database restore_drill;"
docker exec supabase_db_Elmiron-App psql -U postgres -d restore_drill -f /tmp/drill.sql
```

**Verify by querying the restored database, never by an exit code** — see the drill log at the
end of this file for the checks and the numbers they returned.

### 3. Reconcile — immediately, before letting anyone back in

```bash
# Dry run first. Always. It changes nothing and prints exactly what it would do.
pnpm --filter @fieldforce/api reconcile:restore

# Then, once the dry run's numbers make sense. --db-url is MANDATORY for --apply and the
# script refuses without it; no `--` separator, because pnpm 11 forwards it literally.
pnpm --filter @fieldforce/api reconcile:restore --apply \
  --db-url "<the pooler url for the project you just restored>" \
  --note "Restored to 2026-08-14T09:00+05:30"
```

**Check the output, not the exit code.** `pnpm --filter` on a package name that does not
exist prints *"No projects matched the filters"* and **exits 0**. Every command in this
section did exactly that until MR-32, because the filter said `@elmiron/api` and this
workspace is `@fieldforce/api`. A dry run that reconciles nothing and a dry run that finds
nothing look identical if you only read the exit code.

What `--apply` does:

| Finding | What happens |
| --- | --- |
| A live row whose object is missing | Row marked destroyed with reason `restore_reconciled`; derived transcripts and analyses removed; a destruction-log row written. |
| …and it was a **recording** | The visit is additionally **quarantined**. |
| An object with no live row | The object is **deleted from storage** and a finding is recorded. |

`restore_reconciled` is deliberately not `retention` and not `withdrawal`. The cause
is genuinely unknown — absence cannot distinguish a ninety-day purge from a
withdrawal — and filing a guess in a compliance record is worse than filing the
truth that you do not know.

### 4. Deal with the quarantines

```sql
select q.visit_id, q.reason, f.doctor_id, f.created_at
  from public.visit_audio_quarantine q
  join public.restore_reconciliation_findings f on f.id = q.finding_id;
```

A quarantined visit issues no upload grant. That is the point: the system stops
behaving as though consent stands.

**The withdrawal is not re-created, and this is deliberate.** The consent ledger's
entire value is that every row in it is a real thing a real doctor really did. A row
this system invented because it inferred one would be worth less than no row at all,
and it would be indistinguishable from a genuine one forever afterwards. So the
system refuses to guess and puts a named human in front of the question instead.

Clearing one requires a person and a reason, and the clearance is append-only:

```sql
select public.clear_audio_quarantine(
  '<visit-id>',
  'Spoke to Dr <name> on 16 Aug; consent confirmed as standing. — <your name>'
);
```

**The quarantine is on the visit, not the doctor.** The doctor is the safer scope and
it is recorded on the finding for exactly that reason — widening it is one insert.
But a missing object can also be an ordinary storage fault, and blocking every future
recording for a doctor on that evidence turns a possible compliance question into a
certain outage across their whole territory. If the pattern of findings suggests the
doctor withdrew broadly, widen it by hand. That is a judgement, so a person makes it.

### 5. Check retention did not stall while you were busy

```bash
pnpm --filter @fieldforce/api check:purge-health
```

A restore rewinds `audio_purge_runs` too, so the worker's history may now show a gap
that never happened, or hide one that did.

---

## What the reconciliation cannot do

Stated plainly, because a runbook that implies completeness it does not have is worse
than no runbook.

- **It cannot recover a withdrawal.** The consent row, the destruction-log row and
  `withdrawn_at` all lived in the database and all went back together. The only
  surviving trace is the object's absence, and absence is not evidence of intent.
- **It cannot tell a restore artifact from an ordinary storage fault.** A missing
  object looks the same either way. Everything here errs toward denial for that
  reason.
- **It cannot see anything the object store has not yet made visible.** If the bucket
  listing is eventually consistent, a very recent object may be missed. Run it twice,
  an hour apart, if the restore was recent.
- **It says nothing about Supabase's own infrastructure.** Whether the platform keeps
  a copy of a "destroyed" object in S3 versioning, a soft-delete window or a
  sub-processor's backup is not in the public documentation. That is a **DPA
  question, not an engineering one**, and it is on the escalation list.


---

## Drill log — 14 September 2026 (MR-32)

**The first execution of this runbook since it was written.** Every previous first execution of
a written procedure in this project has found the procedure wrong, and this one did too: of the
four executable commands in it, **three were broken and all three exited 0.**

### What the runbook said, and what happened

| Step | Runbook said | What actually happened |
| --- | --- | --- |
| 2 | *"Restore."* | **No mechanism exists.** PITR was not purchased; there is no `db:dump`, no backup script, no off-machine copy (`BE-W11`). Step 2 is the gap |
| 3 dry run | `pnpm --filter @elmiron/api reconcile:restore` | *"No projects matched the filters"*, **exit 0**. The workspace is `@fieldforce/api`. An operator reads no error and no findings, and concludes there was nothing to reconcile |
| 3 apply | `… reconcile:restore -- --apply --note "…"` | Same silent exit 0. With the name corrected, **two further breaks**: `pnpm 11` forwards `--` literally, so the script received `"--" "--apply"`; and `--db-url` is missing, which `BE-W8` made mandatory — the guard fired, exit 1, correctly |
| 4 | the quarantine SQL | **Worked.** Returned four quarantined visits with their findings |
| 5 | `pnpm --filter @elmiron/api check:purge-health` | *"No projects matched the filters"*, **exit 0** |

**Three of four commands were a silent no-op**, and the one that would have refused correctly
(`--db-url`) could only be reached by first fixing the package name. During a compliance
incident, an operator following this document exactly would have believed the reconciliation
ran.

### The restore drill, and what it returned

Dump and restore of the whole local database into a scratch target, then **verified by
querying the restored copy**:

| Check | Source | Restored |
| --- | --- | --- |
| Migrations applied | 56 | **56** |
| Public tables | 37 | **37** |
| Tables with RLS enabled | 36 | **36** |
| Policies on `public` | 48 | **48** |
| `public.visits` | 2,603 | **2,603** |
| `public.doctors` | 1,926 | **1,926** |
| `public.app_thresholds` | 17 | **17** |
| `purge_batch_limit` / `purge_backlog_multiplier` / `purge_max_silence_hours` | 250 / 3 / 12 | **250 / 3 / 12** |
| A marker row seeded before the dump | 1 | **1, with its timestamp** |
| `auth.users` / `auth.identities` | 5,033 / 5,033 | **5,033 / 5,033** |
| `storage.objects` / `storage.buckets` | 128 / 1 | **128 / 1** |

**Why the queries and not the exit code.** The first attempt failed silently in exactly the way
this runbook now warns about: Git Bash rewrote the container path `/tmp/drill.sql` into a
Windows path, `pg_dump` wrote nothing, `create database` **succeeded**, the restore log
contained **zero `ERROR` lines**, and only *"migrations: source 56, restored 0"* revealed that
nothing had been restored at all.

### Duration

**Dump plus restore: 3 seconds**, for a 16.4 MB database — 56 migrations, 37 tables, 5,033
auth users, 2,603 visits. Whole drill including seeding, verification and teardown: **9
seconds**.

That number does not extrapolate. It is a local socket, no network transfer, no platform
snapshot to locate and no support ticket. **Its only honest use is as a floor.**

### What this drill does NOT prove

- **It was a scratch target in the local cluster.** Production credentials are not on this
  machine, and `assertLocalhostOnly()` exists precisely to keep them from being used from here.
- **Nothing about the platform's restore.** Whether a Supabase restore takes minutes or hours,
  whether it needs a support ticket, and what it does to roles, extensions and the
  `supabase_admin`-owned settings is **untested**, because there is nothing to test against.
- **Nothing about the object store, which is the whole reason this runbook exists.**
  `storage.objects` restored 128 rows — and those are *metadata*. The objects themselves never
  moved, because they are not in the database. A restored `storage.objects` asserts that 128
  objects exist; whether they do is unknowable from the database, which is the point made at
  the top of this file and is now demonstrated rather than argued.
- **The reconciliation itself was not run end to end**, because there was no real restore to
  reconcile. Its guards were exercised (`--db-url` refused correctly) and its SQL was exercised
  (step 4 returned rows). `--apply` against a real divergence remains unexecuted.
- **`check:purge-health` was never actually run** — the broken filter meant every invocation
  was a no-op, so its behaviour after a restore is still unverified.


---

## Applying a migration to production — `BE-W40`

**Not part of a restore.** It is here because this is the operational runbook and there was no
other one, and because the two things share a failure: a change reaching production with
nothing recording that it did.

### The situation, stated rather than implied

**CI does not deploy migrations.** Every job in `ci.yml` runs against
`127.0.0.1:54322`. The only route from a migration file to production is a person typing
`supabase db push`, and **two such pushes were run by hand during BE-W8 with no audit trail**.

**And no check can produce that audit trail.** `supabase_migrations.schema_migrations` has
three columns — `version`, `name`, `statements`. There is **no timestamp and no actor**. Who
applied a migration and when is not recorded anywhere, cannot be recovered, and no amount of
tooling written against that table can invent it.

### So: both halves, and the weaker one is named

**The check (`BE-W40`, built in MR-32 C1).** `.github/workflows/migration-drift.yml` runs
`check:migration-drift` daily and on every push that touches a migration, comparing the
versions production has applied against the files on `main`. It fails in both directions —
applied-with-no-file, and file-never-applied.

It is an **after-the-fact detector, not a preventer.** It cannot stop a hand-run push; it
makes one impossible to hide for longer than a day. Preventing one means taking production
credentials away from people, which is an access decision and not an engineering one.

> **Unverified against production.** The check was exercised only against the local stack —
> clean baseline, both failure directions, clean baseline again. Production credentials are
> not on this machine and `assertLocalhostOnly()` exists to keep them from being used from
> here, so the first production run will be the workflow's own. **If it fails on its first
> scheduled run, read the output before assuming drift**: an empty `SUPABASE_DB_URL` is
> reported as a configuration error, and a pooler URL the script cannot reach is not the same
> finding as a divergence.

### What would actually close this — MR-33 C1

The human note in step 4 below is the weak half, and naming what replaces it turns "we chose
the weaker option" into a dependency somebody can discharge.

**What closes it: `supabase db push` from CI being the ONLY path to production.** Then the
actor is the workflow run, the timestamp is the run's, and both are recorded by GitHub whether
anyone writes them down or not — which is exactly what `schema_migrations` cannot give.

**The obvious phrasing of the blocker is wrong, so here is the accurate one.** It is *not*
"this needs production credentials in CI". **CI already has one**: `secrets.SUPABASE_DB_URL`
is set, and MR-33 A1 watched the drift check authenticate to
`aws-0-ap-south-1.pooler.supabase.com` and read the applied versions. What is missing is three
other things:

1. **A deploy workflow.** Buildable today, and small.
2. **Whether that credential may APPLY migrations, which is untested.** It has been proven to
   `select` from `supabase_migrations.schema_migrations`. DDL is a different privilege, and
   `ci.yml:135` already records one case where a `db push` failed with *"permission denied to
   set parameter"*. Assuming read access implies write access is the kind of inference this
   project keeps getting wrong.
3. **The decision that CI is the only path** — which means human-held production credentials
   stop being used for this, and a merge to `main` deploys. That is an access decision and an
   operational one, not an engineering task, and it belongs with whoever owns the Supabase
   account.

Until all three, the detector plus the written note is the honest posture, and the note is
where the actor and the timestamp actually live.

### The step

1. **Before.** Record what you are about to apply:

   ```bash
   pnpm --filter @fieldforce/api check:migration-drift --db-url "<pooler url>"
   ```

   It must report **no drift** first. A push on top of an existing divergence makes two
   problems indistinguishable.

2. **Apply**, from `main`, with nothing uncommitted:

   ```bash
   git status --short        # must be empty
   git log --oneline -1      # record this SHA in the note below
   supabase db push --db-url "<direct url, not the pooler>"
   ```

3. **After**, verify from the database rather than from the command's exit code:

   ```bash
   pnpm --filter @fieldforce/api check:migration-drift --db-url "<pooler url>"
   ```

   No drift means production and `main` agree. It does **not** mean the migration did what it
   was meant to do — that is the migration's own verification.

4. **Write it down, because the database will not.** A row in `docs/decisions.md` or the
   session record naming: the SHA, the versions applied, the date, and who ran it. **This is
   the audit trail.** It is a human writing something down, it is weaker than a recorded row,
   and it is weaker for a reason that cannot be engineered away from here.
