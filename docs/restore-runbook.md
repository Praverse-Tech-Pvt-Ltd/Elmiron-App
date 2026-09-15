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

## Applying 37 migrations to a database at 19 — the rehearsed procedure

**Rehearsed 15 September 2026 (MR-34 B) against a local database reconstructed at production's
exact state.** Everything below was executed, including both failure paths. The section above
it — *"Applying a migration to production"* — is the general case; this is the specific one an
operator is about to do, and it has a landmine in it.

> ### Read this before you start
>
> **The deploy will stop at migration 18 of 37 if production has any user with no territory.**
> `20260908000800_user_profiles_organisation.sql` backfills every profile's organisation. For a
> profile with a territory the answer is derived. For one without — an admin — it either
> resolves to the single organisation or it refuses to guess.
>
> **Both of its non-empty branches currently stop the deploy**, one by design and one by
> defect. See *"The landmine"* below. **Run the pre-flight query first.** It costs one SELECT
> and it tells you which of three futures you are in.

### Phase 0 — pre-flight, and this is the one nobody has run

```bash
psql "<direct url>" -At -c "select 'territory_less=' || (select count(*) from public.user_profiles where territory_id is null) || ' organisations=' || (select count(*) from public.organisations);"
```

| Result | What happens when you deploy |
| --- | --- |
| `territory_less=0` | **The backfill is a no-op and the deploy runs clean.** This is the only path CI has ever exercised |
| `territory_less>0` and `organisations=1` | **The deploy CRASHES** — `ERROR: function min(uuid) does not exist (SQLSTATE 42883)`. Not by design. See the landmine |
| `territory_less>0` and `organisations>1` | **The deploy REFUSES**, by design, with `MR-06 / BE-W76`. Assign `user_profiles.organisation_id` by hand first |

**Do not skip this.** It is the difference between a six-second deploy and a half-applied
schema with no tenant boundary in it.

### Phase 1 — confirm the starting point

```bash
git status --short
git log --oneline -1
pnpm --filter @fieldforce/api check:migration-drift --db-url "<pooler url>"
```

`git status` must be empty; record the SHA.

**Expected:** `IN THIS REPOSITORY BUT NOT APPLIED` listing exactly 37 versions, all dated
`20260907` or later, and **nothing** in the applied-with-no-file direction. Anything else and
you are not in the state this procedure was rehearsed for — stop.

**The exit code is not the check. Read the list.** `check:migration-drift` exits 1 here and
that is correct. And if you pipe it to `tail`, `$?` is `tail`'s exit code, not the script's —
that happened during this rehearsal and printed `exit=0` for a command that had failed.

### Phase 2 — dry run

```bash
supabase db push --db-url "<direct url, not the pooler>" --dry-run
```

**Expected:** exactly 37 filenames and `"dryRun":true`. Count them. The dry run reaches the
database and computes the difference there, so 37 here is independent confirmation of Phase 1.

### Phase 3 — apply

```bash
supabase db push --db-url "<direct url, not the pooler>"
```

**It prompts `[Y/n]`.** The general procedure above omits that. There is a `--yes` flag for a
non-interactive shell and you should **not** use it here — the prompt is the last point at
which a human sees the list.

**Duration: 6.4 seconds** for all 37 against a local socket. See *"How long"* for why that is a
floor and not an estimate.

### Phase 4 — verify from the database, not from the exit code

```bash
pnpm --filter @fieldforce/api check:migration-drift --db-url "<pooler url>"
psql "<direct url>" -At -c "select 'migrations=' || (select count(*) from supabase_migrations.schema_migrations) || ' tables=' || (select count(*) from pg_tables where schemaname='public') || ' policies=' || (select count(*) from pg_policies where schemaname='public') || ' orgcol=' || (select count(*) from information_schema.columns where table_schema='public' and table_name='user_profiles' and column_name='organisation_id');"
```

**Expected, measured in the rehearsal:** `migrations=56 tables=36 policies=48 orgcol=1`.

### How to tell a PARTIAL application from a FAILED one — and why you must

**`supabase db push` is not transactional across migrations.** When it stopped at migration 18
during the rehearsal it left the first 17 applied and committed. The state it left:

| | Partial — stopped at 18 of 37 | Complete |
| --- | --- | --- |
| `migrations` | **36** | 56 |
| **`tables`** | **36** | **36** |
| `policies` | 42 | 48 |
| `rls_forced` | **36** | **36** |
| **`orgcol`** | **0** | **1** |

**Read the `tables` row twice.** A half-applied deploy has *exactly the same table count as a
complete one*, and so does `rls_forced`. **A structural count cannot tell you which state you
are in.** Anyone eyeballing "36 tables, looks right" concludes success on a database that has
no tenant boundary in it.

**Only two things discriminate:**

1. **`check:migration-drift`** — it named all 20 missing versions correctly in the rehearsal.
   This is the check to trust.
2. **`orgcol`** — `0` means `20260908000800` did not complete, and that is the exact migration
   that stops.

**A partial application is not a failed one.** Nothing is rolled back, and nothing warns you on
the next connection. The 17 that applied are real and permanent.

### If a phase fails

| Phase | What to do |
| --- | --- |
| **0** | Not a failure — it is the decision. Resolve the profiles by hand, or fix the landmine, before Phase 3 |
| **1** | Drift in the *other* direction means something was applied off-`main`. Do not push on top of it; that makes two problems indistinguishable |
| **2** | A dry run listing other than 37 means the repo and the database disagree about the starting point. Go back to Phase 1 |
| **3** | **Read the error, then run Phase 4 immediately.** You need to know how far it got before you decide anything. Re-running `db push` after a fix resumes from where it stopped — it re-computes the difference, it does not start over |
| **4** | `migrations=56` while the drift check still lists versions means you are reading a different database than you pushed to. Check pooler versus direct |

### The landmine — `min(uuid)` does not exist

```sql
select count(*), min(id) into v_orgs, v_org from public.organisations;
```

**PostgreSQL has no `min` aggregate for `uuid`.** Verified on the local stack, `server_version`
**17.6**: `select count(*) from pg_proc where proname='min' and proargtypes::text like '%2950%'`
returns **0**. So the single-organisation branch — the one written to let the deploy proceed —
raises `42883` the moment it is reached.

| Precondition | What happens | Intended? |
| --- | --- | --- |
| no territory-less profiles | returns early, no-op | yes — **and this is the only path CI runs** |
| territory-less profiles, 1 organisation | **`ERROR: function min(uuid) does not exist`** | **no** |
| territory-less profiles, >1 organisation | raises `MR-06 / BE-W76`, deploy stops | yes |

Both non-empty branches were executed in the rehearsal, each against a database seeded to meet
its precondition, with the precondition asserted before the push.

The migration's own comment says the single-organisation branch *"is exercised only by its
test, not by CI's migration run."* **No such test exists** — searching `services/api/tests` for
that branch returns nothing, and it could not be re-run after the fact anyway, because a
backfill executes once at migration time.

**This is not fixed here.** `.ai-collab/constraints.md:78` puts *"changing what a migration that
has already been applied does"* under **Ask before doing**, and this migration is applied
locally and in CI while being unapplied on production. A later migration cannot help: the
broken one aborts the deploy before any successor runs, so the fix has to land in that file or
not at all. **That is a decision to be asked for, not taken** — registered in
`docs/blocked-on-you.md`.

### Rolling back — and it is theoretical, not supported

`pnpm --filter @fieldforce/api verify:rollbacks` passes **56 of 56**, in reverse order, ending
with *"public schema is empty"*. Every migration has a paired rollback file and the pairing is
exact in both directions. That is a real, run, green check.

**It is not an operational rollback, for three reasons.**

1. **It is all-or-nothing to empty.** It reverses *every* migration. There is no mechanism to
   reverse 37 and stop at 19, which is the only rollback an operator would ever want here.
2. **It refuses to run anywhere but localhost.** `assertLocalhostOnly()` has no override, by
   design. Pointing it at production is not a supported operation; it is a thing you would have
   to write by hand.
3. **It leaves the migration ledger lying.** Measured immediately after a full rollback:

   ```
   public tables = 0    schema_migrations rows = 56
   ```

   **The database is empty and still claims all 56 are applied**, because the rollback scripts
   do not touch `supabase_migrations.schema_migrations`. `check:migration-drift` reports **no
   drift** against a database with nothing in it.

**That is the exact inverse of the partial-deploy trap, and it defeats the same check.** Drift
is the reliable discriminator for a half-finished *forward* deploy and is blind to a completed
*backward* one. On a database in this state, the drift check and the table count disagree, and
the table count is the one telling the truth.

**So: forward recovery only.** If a push stops half way, fix the cause and push again — it
resumes. Do not reach for the rollbacks to get back to 19; nothing has ever done that and the
ledger would not survive it.

### How long — 6.4 seconds, as a floor

Measured with the 19 asserted as applied beforehand and 37 `Applying migration` lines counted
afterwards. It is a **floor**, not an estimate:

- a local Unix socket — no network round trip per statement;
- **no rows.** Every `alter table` rewrite, index build and constraint validation ran against
  empty tables. Production's cost is proportional to its data and this number contains none of
  it;
- no concurrent traffic, so nothing waited on a lock. `20260908000800` takes an `ACCESS
  EXCLUSIVE` lock on `user_profiles`, which on a live database queues behind every open
  transaction and blocks every one arriving after it;
- no platform layer — no pooler, no connection limit, no statement timeout.

**Plan a two-minute window. Six seconds is not the number to plan with.**

### What this rehearsal does NOT prove

- **It was not run against production.** Production credentials are not on this machine and
  `assertLocalhostOnly()` exists to keep them off it. Everything above is a local
  reconstruction that matched production's *migration versions*, not its data.
- **The platform's own behaviour is unobserved** — the pooler, statement timeouts, whether the
  CI credential may execute DDL at all (`ci.yml:135` records a `db push` failing with
  *"permission denied to set parameter"*), and what Supabase does to roles and extensions
  during a push.
- **A scratch database has no concurrent traffic.** Nothing held a lock, nothing retried,
  nothing timed out. The lock behaviour of `20260908000800` is the largest untested difference
  between this rehearsal and the real thing.
- **Production's data shape is unknown.** Phase 0 exists precisely because the one fact that
  decides whether this deploy succeeds has never been looked at.
