# Production deploy — the runbook (rehearsed 2 October 2026, W1-S)

**Written from a rehearsal, not from expectation.** Every command below was run on 2 October against a
local database rebuilt to production's exact migration state (the first 19 of 93), and the "proves it"
column is what it actually printed. **The rehearsal was on a copy; read "What the rehearsal could not
establish" before trusting any of it on the day.**

**Who runs it:** an engineer, watched by the operator. **When:** only after (1) PR #2 is merged to
`main`, (2) the operator says go (`BE-C58`), (3) the paid plan is active (`BE-C59`). Run it from a clean
checkout of `main`, from the repository root.

**The one secret it needs** is production's database URL — the same value as the `SUPABASE_DB_URL`
repository secret. Put it in your shell, never in a file or a chat:

```bash
read -rs PROD_DB_URL && export PROD_DB_URL     # paste, press Enter; nothing is echoed
```

## The order — and the one place it differs from the recorded order

The operator recorded **pre-flight → working-hour config → pending changes → reference data → smoke
test** (`BE-C58`). **The rehearsal says working hours cannot be fully set second:**

* At production's current state there are **0 territories** and **no per-company settings table** —
  the second arrives with a pending migration (`20260930000300`), the first with reference data.
* Only the **global fallback** can be set before the push. It survived the push in the rehearsal, so
  setting it early does no harm — but it is a fallback that **must expire within 60 days** by design
  (`20260816000200`), not the territory hours `BE-C50` asks for.

**So this runbook runs: pre-flight → pending changes → reference data → working hours → accounts → smoke
test.** "Never reference data before schema" (`BE-C58`) is kept exactly.

---

## Step 0 — pre-flight (read-only; about 10 minutes)

| # | Command | Proves it worked | If it did not |
| --- | --- | --- | --- |
| 0.1 | GitHub → Actions → **Database backup** → *Run workflow* on `main`; wait for green | A green run today; its artefact listed on the run | **Stop.** No deploy without a backup from today |
| 0.2 | GitHub → Actions → **Migration drift** → *Run workflow* on `main` | Notice: *"Production has applied the first 19 of 93 migrations, in order, with nothing applied that has no file here"* | Any other shape — an out-of-band version, a gap — **stop**: someone changed production by hand; read the job's own message |
| 0.3 | The three counts below, in the Supabase SQL editor (read-only) | You know which branch two migrations will take | See the table under it |
| 0.4 | `pnpm exec supabase --workdir services/api db push --db-url "$PROD_DB_URL" --dry-run` | *"Would push these migrations:"* followed by **74** names, first `20260907000100`, last `20261002000100`. Nothing changes | A different count — **stop**; production is not where 0.2 said |

**0.3 — the counts two pending migrations depend on:**

```sql
select (select count(*) from public.organisations)                              as organisations,
       (select count(*) from public.user_profiles where territory_id is null)   as users_without_territory,
       (select count(*) from public.consent_text_versions)                      as consent_notices;
```

| Result | Meaning |
| --- | --- |
| `users_without_territory = 0` and `consent_notices = 0` | Both backfills take their early return. Proceed |
| either is non-zero and `organisations = 1` | Both backfills attribute the rows to that one company, by themselves. Proceed |
| either is non-zero and `organisations > 1` | `20260908000800` / `20260908001200` will **stop with 23502** and a message naming the rows. **Before 1.1**, set `organisation_id` on each of those rows by hand — choosing it is choosing whose data they read, so the operator decides which company each belongs to |

## Step 1 — pending changes (the schema; seconds; then the function)

| # | Command | Proves it worked | If it did not |
| --- | --- | --- | --- |
| 1.1 | `pnpm exec supabase --workdir services/api db push --db-url "$PROD_DB_URL" --yes` | Ends *"Finished supabase db push."*, exit 0; **74** "Applying migration" lines. Rehearsal: **8 seconds** on an empty copy | It stops at ONE migration, exits 1 and names the file, statement and SQLSTATE. **Everything before that file stays applied; that file is rolled back whole** (rehearsed: nothing of it was left behind). **Fix the cause, then run 1.1 again — it resumes at that file** (rehearsed: 18 remaining applied). **Re-running without fixing the cause fails on the same file** |
| 1.2 | Actions → **Migration drift** → *Run workflow* on `main` | **Green with no notice**: *"No drift. 93 migration(s), all applied."* (rehearsed locally with `check:migration-drift`) | A shortfall means 1.1 did not finish — back to 1.1 |
| 1.3 | `pnpm --filter @fieldforce/core build` then `pnpm exec supabase --workdir services/api functions deploy ai-gateway --project-ref <production ref>` | The CLI lists `ai-gateway` as deployed | **Not rehearsed** — see the limits. Read the CLI's error; the most likely is a stale `packages/core/dist` |
| 1.4 | Pushing again: `…db push --db-url "$PROD_DB_URL" --yes` | *"Remote database is up to date"*, nothing applied (rehearsed: "up to date") | — this is the safe re-run check, not a step that changes anything |

## Step 2 — reference data (minutes; safe to re-run)

The operator fills `docs/operator/territory-template.xlsx` and exports its two sheets as CSV.

| # | Command | Proves it worked | If it did not |
| --- | --- | --- | --- |
| 2.1 | `node services/api/scripts/check-territory-sheet.mjs --territories Territories.csv --mrs MRs.csv --out reference.json` | *"OK: N company(ies), M territory row(s). Wrote reference.json."* | One line per problem, by sheet and row, with the reason; **nothing is written**. Rehearsed: the shipped template is refused (`example_row`, three lines) — **delete the example rows** |
| 2.2 | `pnpm --filter @fieldforce/api seed:reference -- --data reference.json` | *"DRY RUN: N organisation(s), M territory(ies) … would be attempted. Nothing was changed."* | Read the error; nothing was changed |
| 2.3 | `pnpm --filter @fieldforce/api seed:reference -- --data reference.json --apply --db-url "$PROD_DB_URL"` | *"APPLIED: N organisation(s), M territory(ies) … inserted"* | It runs in one transaction: a failure inserts nothing. Read it, fix the sheet, start at 2.1 |
| 2.4 | Run 2.3 again | *"APPLIED: 0 organisation(s), 0 territory(ies) …"* — rehearsed exactly | Non-zero means the sheet changed between runs: a **renamed key makes a NEW row**, it never renames |

**The loader carries no consent notice and no doctors** (`consentTextVersions: []`). See "Before the
first real MR day" below.

## Step 3 — working hours (minutes)

| # | Command (SQL editor) | Proves it worked | If it did not |
| --- | --- | --- | --- |
| 3.1 | Per territory, for every Area/Territory row: `insert into public.territory_shift_windows (territory_id, shift_start, shift_end) select id, '09:00', '18:00' from public.territories where code = '<CODE>';` | `select * from public.resolve_shift_window((select id from public.territories where code='<CODE>'))` → `source = territory` (rehearsed) | `23505` = that territory already has hours — **not a failure**, the row exists; change it with `update`. **09:00–18:00 is the TEST value** (`BE-C50`) — use the operator's approved hours (Q-8) |
| 3.2 | Optional global fallback: `insert into public.app_thresholds (key, value, note) values ('org_default_shift_window', '{"shiftStart":"09:00","shiftEnd":"18:00","timezone":"Asia/Kolkata","activeWeekdays":[1,2,3,4,5,6],"expiresAt":"<ISO, at most 60 days ahead>"}', '<who, why>');` | `resolve_shift_window(null)` → `source = org_default` | Without `expiresAt` it is **refused** (rehearsed): *"must carry an expiresAt; it is a temporary measure by construction"* |

## Step 4 — accounts, BY HAND (`BE-W137`)

**There is no tool that creates the MR sheet's accounts on production.** `seed:mr` refuses any
non-local target by design and creates its own company and territory; `check-territory-sheet`'s note
that accounts are "created with `seed:mr`" does not hold for production. Rehearsed by hand, two steps
per person:

| # | Action | Proves it worked |
| --- | --- | --- |
| 4.1 | Supabase Dashboard → Authentication → **Add user** (email, password, auto-confirm) | The user appears; copy its id |
| 4.2 | SQL: `insert into public.user_profiles (id, full_name, role, territory_id, organisation_id) select '<user id>', '<name>', 'mr', t.id, t.organisation_id from public.territories t where t.code = '<CODE>';` | `INSERT 0 1`. A field role without a territory is refused by `user_profiles_field_roles_require_territory` |

**The second admin (Q-14) is created the same way with `role = 'admin'` and no territory.**

## Step 5 — the smoke test (five minutes; commands with expected answers)

Set `API=https://<production ref>.supabase.co`, `ANON=<publishable key>`, and one MR's email and
password from step 4. **Every expected answer below is what the rehearsal printed**, except S7, where
production differs by design.

```bash
TOKEN=$(curl -s -X POST "$API/auth/v1/token?grant_type=password" -H "apikey: $ANON" \
  -H 'content-type: application/json' -d '{"email":"<mr email>","password":"<mr password>"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).access_token??''))")
```

| # | Command | Expected answer | If not |
| --- | --- | --- | --- |
| S1 | Migration drift workflow (as 1.2) | *"No drift. 93 migration(s), all applied."* | Schema incomplete — step 1 |
| S2 | `echo ${#TOKEN}` | A number in the hundreds (rehearsal: 907). **0 = sign-in failed** | Wrong password, or 4.1 not confirmed |
| S3 | `curl -s -X POST "$API/rest/v1/rpc/my_shift_window" -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{}'` | `{"source": "territory", "window": {"shiftStart": "09:00:00", "shiftEnd": "18:00:00", …}}` | `source: org_default` = step 3.1 missed this territory; nothing = no hours at all, **check-in will refuse** |
| S4 | `curl -s -X POST "$API/rest/v1/rpc/sync_pull" -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{}'` | JSON with keys `changes, hasMore, nextCursor, serverTime, completeness` | An error code here means the app cannot load the rep's day |
| S5 | `curl -s -w ' http=%{http_code}' "$API/rest/v1/territories?select=id" -H "apikey: $ANON"` | `"code":"42501"` … `http=401` — **anonymous is refused** | **Anything returned is a data leak — stop and roll back the deploy's exposure** |
| S6 | `curl -s -w ' http=%{http_code}' "$API/rest/v1/app_thresholds?select=key" -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN"` | `"code":"42501"` … `http=403` — an MR cannot read settings directly | Same as S5 |
| S7 | `curl -s -w ' http=%{http_code}' -X POST "$API/functions/v1/ai-gateway" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"feature":"product_qa","question":"storage?"}'` | **Production: `{"code":"no_provider",…} http=503`** — the function is deployed and, correctly, has no model until Q-1. (Locally the stub is allowed, so the rehearsal printed `45011` / 403 instead) | `404` = step 1.3 did not deploy. **A 200 with an answer in production would mean the stub is answering outside a local target — stop** |

## Before the first real MR day

* **Consent capture refuses until a consent notice exists for the company.** The loader carries none,
  and the notice waits on the registered legal name (**Q-11**, `BE-C61` — never invented). **Until then
  the MR's consent step fails in production**, whatever else is ready.
* **Doctors** load through the same `seed:reference` file (`doctors: []` from the sheet checker today) —
  Q-7. AI Doctor practice does not need them (`BE-C53`).

## What the rehearsal could NOT establish

1. **Production's data.** The copy was empty. Two pending migrations behave differently when rows exist
   — step 0.3 exists for exactly that, and it is the only defence. Any other row-dependent behaviour in
   the 74 is untested on real rows.
2. **Production's timing.** 8 seconds was an empty local database. On the hosted database over the
   pooler, expect longer; nothing in the 74 rewrites a large table, but this was not measured.
3. **Hosted-platform differences:** role ownership (`postgres` vs the platform's admin role),
   extension availability, the pooler's timeouts, auth settings (email confirmation), and what the paid
   plan changes. None of these exist locally.
4. **The function deploy (1.3).** A local stack serves functions; it does not deploy them. Not rehearsed.
5. **Whether production is still at 19 on the day.** Measured on 2 October (drift run `36975013243`).
   Step 0.2 re-measures it; trust that, not this page.
6. **Rollback of a deploy.** Every migration has a rollback file and CI applies them all in reverse
   (`verify-rollbacks.mjs`), **but rolling production back drops the data in the tables it removes.**
   A failed deploy is fixed forward (step 1.1's "fix, then re-run"), not rolled back, unless the
   operator decides otherwise with the backup from 0.1 in hand.
