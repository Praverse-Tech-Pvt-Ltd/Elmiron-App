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

## The order — the operator's, as fixed (item 8, 2 October): do not change it

**Pre-flight → working hours → database migrations → reference data → smoke test.** The operator's
words: *"Use the fixed deployment sequence … Do not change the order."*
(`docs/operator/2026-10-02-operator-direction.md`, item 8.)

**It executes as written — measured W1-U3, against a copy rebuilt to production's 19 migrations:**
before the migrations there are **0 companies, 0 territories and no per-company settings table**, so
hours cannot attach to a company or a territory yet. **What CAN be set at step 2 is item 9's temporary
value as the platform-wide fallback** — and that is exactly what item 9 says it is: *"a temporary
configurable value … not the final business policy."* Refused without an expiry; refused at 61 days;
**accepted at 59 days, resolved for every territory, and survived all the migrations** (94 applied).
Per-territory hours — the final policy, not yet decided — are set after reference data, inside the
operator's step 4, if and when they are decided.

**Row ids are kept from the 2 October rehearsal** (they are cited in other documents); the sections are
in the operator's order, and this maps them:

| Operator's step | Runbook rows |
| --- | --- |
| 1. Pre-flight | 0.1–0.4 |
| 2. Working hours | 3.2 — item 9's value as the expiring fallback |
| 3. Database migrations | 1.1–1.4 |
| 4. Reference data | 2.1–2.4, then accounts 4.1–4.3, then 3.1 (per-territory hours, when decided) |
| 5. Smoke test | S1–S7 |

> **History:** the 2 October version of this page reordered the steps on the rehearsal's evidence
> (W1-S). Item 8 then fixed the order, and W1-U3 measured that the operator's order can run. The W1-S
> reordering was mine and is withdrawn.

---

## Operator step 1 — pre-flight (read-only; about 10 minutes)

| # | Command | Proves it worked | If it did not |
| --- | --- | --- | --- |
| 0.1 | **Q-19 = Supabase-managed backups** (answered 10 October, `BE-C80`). **The GitHub *Database backup* workflow and its artefact are NOT part of this step and not required for the pilot deployment.** (a) Supabase Dashboard → Organization → **Billing**: the project's organisation is on a **paid plan, status active**. (b) Dashboard → Project → **Database → Backups → Scheduled backups** — or `pnpm exec supabase backups list --project-ref <ref>` after `supabase login` — and read the newest entry | (a) the paid plan is shown active — **read it, do not infer it from the approval**; (b) a backup **dated today (UTC)** with status completed. Write both down, with the backup's timestamp, in the deploy record | **Stop.** No deploy without a completed backup from today. If today's scheduled backup has not run yet, wait for it — do not accept yesterday's. A free plan has no scheduled backups at all: that is a stop, not a warning |
| 0.2 | GitHub → Actions → **Migration drift** → *Run workflow* on `main` | Notice: *"Production has applied the first 19 of 96 migrations, in order, with nothing applied that has no file here"* | Any other shape — an out-of-band version, a gap — **stop**: someone changed production by hand; read the job's own message |
| 0.3 | The three counts below, in the Supabase SQL editor (read-only) | You know which branch two migrations will take | See the table under it |
| 0.4 | `pnpm exec supabase --workdir services/api db push --db-url "$PROD_DB_URL" --dry-run` | *"Would push these migrations:"* followed by **77** names, first `20260907000100`, last `20261002000400` (W1-W, 5 October: `main` now holds 96; was 74 / `20261002000100`). Nothing changes | A different count — **stop**; production is not where 0.2 said |

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

## Operator step 2 — working hours: item 9's TEMPORARY value (minutes; before the migrations)

**Item 9, verbatim:** *"For UAT/demo use: Monday-Saturday 09:00-18:00 Local territory time. This remains
a temporary configurable value and is not the final business policy."*

| # | Command (SQL editor) | Proves it worked | If it did not |
| --- | --- | --- | --- |
| 3.2 | `insert into public.app_thresholds (key, value, note) values ('org_default_shift_window', '{"shiftStart":"09:00","shiftEnd":"18:00","timezone":"Asia/Kolkata","activeWeekdays":[1,2,3,4,5,6],"expiresAt":"<ISO, at most 60 days ahead>"}', 'TEMPORARY (operator item 9, UAT/demo): Mon-Sat 09:00-18:00 local territory time. Configurable; NOT business policy. Set by <who>, <date>.');` | `select * from public.resolve_shift_window(null)` → `09:00 18:00 Asia/Kolkata {1,2,3,4,5,6} org_default` (measured W1-U3) | Without `expiresAt`: **refused** — *"must carry an expiresAt; it is a temporary measure by construction"*. More than 60 days ahead: **refused** — *"A fallback that can be configured for a year is not a fallback."* Both measured |

**What this costs, said before it bites:** the value is **platform-wide**, not per company (item 15), and
it **lapses on its expiry date** — after which **check-in refuses** for any territory without hours of its
own. Renewing is one more row like 3.2; replacing it is 3.1 below. "Local territory time" is honoured as
`Asia/Kolkata` here; a territory in another timezone needs its own 3.1 row.

## Operator step 3 — database migrations (seconds; then the function)

| # | Command | Proves it worked | If it did not |
| --- | --- | --- | --- |
| 1.1 | `pnpm exec supabase --workdir services/api db push --db-url "$PROD_DB_URL" --yes` | Ends *"Finished supabase db push."*, exit 0; **77** "Applying migration" lines (W1-W; was 74). Rehearsal: **8 seconds** on an empty copy | It stops at ONE migration, exits 1 and names the file, statement and SQLSTATE. **Everything before that file stays applied; that file is rolled back whole** (rehearsed: nothing of it was left behind). **Fix the cause, then run 1.1 again — it resumes at that file** (rehearsed: 18 remaining applied). **Re-running without fixing the cause fails on the same file** |
| 1.2 | Actions → **Migration drift** → *Run workflow* on `main` | **Green with no notice**: *"No drift. 96 migration(s), all applied."* (rehearsed locally with `check:migration-drift`) | A shortfall means 1.1 did not finish — back to 1.1 |
| 1.3 | `pnpm --filter @fieldforce/core build` then `pnpm exec supabase --workdir services/api functions deploy ai-gateway --project-ref <production ref>` | The CLI lists `ai-gateway` as deployed | **Not rehearsed** — see the limits. Read the CLI's error; the most likely is a stale `packages/core/dist` |
| 1.4 | Pushing again: `…db push --db-url "$PROD_DB_URL" --yes` | *"Remote database is up to date"*, nothing applied (rehearsed: "up to date") | — this is the safe re-run check, not a step that changes anything |

## Operator step 4 — reference data (minutes; safe to re-run)

The operator fills `docs/operator/territory-template.xlsx` and exports its two sheets as CSV.

| # | Command | Proves it worked | If it did not |
| --- | --- | --- | --- |
| 2.1 | `node services/api/scripts/check-territory-sheet.mjs --territories Territories.csv --mrs MRs.csv --out reference.json` | *"OK: N company(ies), M territory row(s). Wrote reference.json."* | One line per problem, by sheet and row, with the reason; **nothing is written**. Rehearsed: the shipped template is refused (`example_row`, three lines) — **delete the example rows** |
| 2.1a | **Doctors and clinics (Q-7), when the sheet exists:** `node services/api/scripts/check-doctor-sheet.mjs --reference reference.json --doctors doctors-clinics.csv --out reference-full.json` — the template is `docs/operator/doctors-clinics-template.csv`. **Then use `reference-full.json` in place of `reference.json` in 2.2–2.4** | *"OK: N doctor(s), M clinic(s). Wrote reference-full.json."* | One line per problem, by row, with the reason; **nothing is written**. The shipped template is refused (`example_row`) — delete the example rows. Coordinates are never invented: a clinic without them loads without them |
| 2.2 | `pnpm --filter @fieldforce/api seed:reference -- --data reference.json` | *"DRY RUN: N organisation(s), M territory(ies) … would be attempted. Nothing was changed."* | Read the error; nothing was changed |
| 2.3 | `pnpm --filter @fieldforce/api seed:reference -- --data reference.json --apply --db-url "$PROD_DB_URL"` | *"APPLIED: N organisation(s), M territory(ies) … inserted"* | It runs in one transaction: a failure inserts nothing. Read it, fix the sheet, start at 2.1 |
| 2.4 | Run 2.3 again | *"APPLIED: 0 organisation(s), 0 territory(ies) …"* — rehearsed exactly | Non-zero means the sheet changed between runs: a **renamed key makes a NEW row**, it never renames |

**The loader carries no consent notice** (`consentTextVersions: []`), **and doctors only through 2.1a** (`BE-W179`). A reload with a CHANGED doctor or clinic under an existing key **fails, naming it, and loads nothing** — `seed:reference` never updates a loaded row. See "Before the
first real MR day" below.

### Operator step 4, continued — accounts, BY HAND (`BE-W137`) — users are a master (item 11)

**There is no tool that creates the MR sheet's accounts on production.** `seed:mr` refuses any
non-local target by design and creates its own company and territory; `check-territory-sheet`'s note
that accounts are "created with `seed:mr`" does not hold for production. Rehearsed by hand, two steps
per person:

| # | Action | Proves it worked |
| --- | --- | --- |
| 4.1 | Supabase Dashboard → Authentication → **Add user** (email, password, auto-confirm) | The user appears; copy its id |
| 4.2 | SQL: `insert into public.user_profiles (id, full_name, role, territory_id, organisation_id) select '<user id>', '<name>', 'mr', t.id, t.organisation_id from public.territories t where t.code = '<CODE>';` | `INSERT 0 1`. A field role without a territory is refused by `user_profiles_field_roles_require_territory` |

**The second admin (Q-14) — guarded, tested against the local database on 10 October.** An admin
has no territory, so its company cannot be derived and 4.2's insert does not fit it. Instead:

| # | Action | Proves it worked |
| --- | --- | --- |
| 4.A1 | Dashboard → Authentication → **Add user**: the second person's own email, **Auto-confirm ticked**. Copy the user id | The user appears |
| 4.A2 | SQL editor: the block below, with the three values filled. **Pre-checks, insert and post-checks are ONE statement:** any failed check raises an error and nothing is inserted | `Success. No rows returned`. Any `PRE-CHECK:` / `POST-CHECK:` error names the problem; nothing was written |
| 4.A3 | Read back: `select u.email, p.full_name, p.role, p.territory_id, p.is_active from public.user_profiles p join auth.users u on u.id = p.id where p.role = 'admin' order by u.email;` | Two rows, two different people, `territory_id` empty, `is_active` true |
| 4.A4 | The second admin signs in to the console **after** 4.A2 — the role claim is added at sign-in | The admin screens open |
| 4.A5 | Admin 1 submits a draft; **admin 2** approves it | Q-14 / `BE-C57` closes on that first approval |

```sql
-- Second production admin (Q-14, BE-C57) -- pre-check, insert and post-check in ONE statement.
-- Fill the three values. Any failed check raises an error and the insert does not happen.
do $$
declare
  p_user_id constant uuid := '<AUTH USER ID>';
  p_name    constant text := '<FULL NAME>';
  p_company constant text := '<COMPANY NAME, exactly as loaded>';
  v_org     uuid;
  v_orgs    integer;
  v_before  integer;
  v_after   integer;
begin
  -- PRE-CHECKS
  select count(*) into v_orgs from public.organisations where name = p_company;
  if v_orgs <> 1 then
    raise exception 'PRE-CHECK: % organisation(s) named "%" -- expected exactly 1', v_orgs, p_company;
  end if;
  select id into v_org from public.organisations where name = p_company;

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'PRE-CHECK: no auth user % -- create it first (Authentication -> Add user)', p_user_id;
  end if;
  if not exists (select 1 from auth.users where id = p_user_id and email_confirmed_at is not null) then
    raise exception 'PRE-CHECK: auth user % is not confirmed -- recreate it with Auto-confirm ticked', p_user_id;
  end if;
  if exists (select 1 from public.user_profiles where id = p_user_id) then
    raise exception 'PRE-CHECK: user % already has a profile -- nothing to do, or a wrong id', p_user_id;
  end if;
  select count(*) into v_before
    from public.user_profiles where role = 'admin' and organisation_id = v_org and is_active;
  if v_before < 1 then
    raise exception 'PRE-CHECK: "%" has no active admin yet -- this procedure adds the SECOND', p_company;
  end if;

  -- INSERT
  insert into public.user_profiles (id, full_name, role, organisation_id)
  values (p_user_id, p_name, 'admin', v_org);

  -- POST-CHECKS (an exception here undoes the insert above)
  select count(*) into v_after
    from public.user_profiles where role = 'admin' and organisation_id = v_org and is_active;
  if v_after <> v_before + 1 then
    raise exception 'POST-CHECK: % active admin(s), expected %', v_after, v_before + 1;
  end if;
  if not exists (
    select 1 from public.user_profiles
     where id = p_user_id and role = 'admin' and territory_id is null
       and organisation_id = v_org and is_active
  ) then
    raise exception 'POST-CHECK: the new profile is not an active, territory-less admin of "%"', p_company;
  end if;
end
$$;
```

**Rollback — DEACTIVATE, never delete.** A `user_profiles` row cannot be deleted: the delete cascades
into append-only `app_thresholds` and is refused (measured 10 October). Deleting the auth user fails
the same way. To undo a wrong admin:
`update public.user_profiles set is_active = false where id = '<AUTH USER ID>' and role = 'admin' and is_active;`
— `UPDATE 1`; every policy authorises through `effective_role()`, which is null for an inactive
profile (measured), so the account can sign in but reads and approves nothing. Also send it a
password reset from Dashboard → Authentication, so its old password stops working. The same rule holds for an MR made wrongly in 4.2.

### Why by hand, and what by hand gets wrong (W1-T D)

**By hand, deliberately, for the first deployment** — the pilot gate is 1 territory and 2 MRs
(`G-PILOT`), about six accounts with the admins, a manager and the PV officer. A tool that creates
production identities needs the service-role key on a laptop, and one bug in it makes many wrong
accounts at once; by hand, a mistake is one person's. **Revisit at the 100-MR pilot** (`spend-approval.md`).

The schema refuses three mistakes: a profile for a user that does not exist (`user_profiles_id_fkey`),
a field role with no territory, a rep as their own manager. **It accepts five, silently** — so 4.3:

| Mistake | What happens |
| --- | --- |
| `role = 'admin'` typed for a rep | The rep reads **the whole company's data** |
| a valid but WRONG territory code | The rep sees another territory's doctors |
| a MISTYPED territory code | `INSERT 0 0` — no profile, no error; the rep cannot use the app |
| no `reporting_manager_id` | The manager never sees the rep's work |
| "Auto-confirm" left unticked in 4.1 | The rep cannot sign in |

| # | Action | Proves it worked |
| --- | --- | --- |
| 4.3 | **After the last account, read every profile back** (SQL editor, read-only) and compare it line by line with the checked MR sheet, with a second person reading the sheet aloud | `select u.email, p.full_name, p.role, t.code as territory, m.full_name as manager, u.email_confirmed_at is not null as confirmed from public.user_profiles p join auth.users u on u.id = p.id left join public.territories t on t.id = p.territory_id left join public.user_profiles m on m.id = p.reporting_manager_id order by p.role, t.code, u.email;` — **one row per person on the sheet, `role` `mr` for every rep, the sheet's territory, a manager for every rep, `confirmed` true** |

### Operator step 4, continued — per-territory hours, ONLY when the final policy is decided

| # | Command (SQL editor) | Proves it worked | If it did not |
| --- | --- | --- | --- |
| 3.1 | Per territory: `insert into public.territory_shift_windows (territory_id, shift_start, shift_end) select id, '<start>', '<end>' from public.territories where code = '<CODE>';` | `resolve_shift_window(<territory id>)` → `source = territory` (rehearsed) | `23505` = that territory already has hours — change it with `update`. **Not item 9's value**: these are the final hours, which the operator has not yet given |

## Operator step 5 — the smoke test (five minutes; commands with expected answers)

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
| S1 | Migration drift workflow (as 1.2) | *"No drift. 96 migration(s), all applied."* | Schema incomplete — step 1 |
| S2 | `echo ${#TOKEN}` | A number in the hundreds (rehearsal: 907). **0 = sign-in failed** | Wrong password, or 4.1 not confirmed |
| S3 | `curl -s -X POST "$API/rest/v1/rpc/my_shift_window" -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{}'` | With item 9's value (row 3.2): `{"source": "org_default", "window": {"shiftStart": "09:00:00", "shiftEnd": "18:00:00", "activeWeekdays": [1, 2, 3, 4, 5, 6], …}}`. Once per-territory hours exist (row 3.1): `"source": "territory"` | Nothing = no hours at all — the fallback is missing or has **expired**, and **check-in will refuse**; back to row 3.2 |
| S4 | `curl -s -X POST "$API/rest/v1/rpc/sync_pull" -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{}'` | JSON with keys `changes, hasMore, nextCursor, serverTime, completeness` | An error code here means the app cannot load the rep's day |
| S5 | `curl -s -w ' http=%{http_code}' "$API/rest/v1/territories?select=id" -H "apikey: $ANON"` | `"code":"42501"` … `http=401` — **anonymous is refused** | **Anything returned is a data leak — stop and roll back the deploy's exposure** |
| S6 | `curl -s -w ' http=%{http_code}' "$API/rest/v1/app_thresholds?select=key" -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN"` | `"code":"42501"` … `http=403` — an MR cannot read settings directly | Same as S5 |
| S7 | `curl -s -w ' http=%{http_code}' -X POST "$API/functions/v1/ai-gateway" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"feature":"product_qa","question":"storage?"}'` | **Production: `{"code":"no_provider",…} http=503`** — the function is deployed and, correctly, has no model until Q-1. (Locally the stub is allowed, so the rehearsal printed `45011` / 403 instead) | `404` = step 1.3 did not deploy. **A 200 with an answer in production would mean the stub is answering outside a local target — stop** |

## Before the first real MR day — what a rep CANNOT do, and the one input each waits on

**Measured W1-T C from the schema and the code, not from the register** — every refusal in the
catalogue that fires for want of a value, then the app's own path through a day. Nothing invented,
no placeholder built.

| # | On day one in production a rep cannot… | Because (measured) | Waits on |
| --- | --- | --- | --- |
| 1 | **sign in** | No tool creates the sheet's accounts on production (`BE-W137`) | **Q-5** — the territory and MR sheet; then step 4 by hand |
| 2 | **see a single visit** | **Updated 9 October (`BE-W171`, `BE-W176`).** A field manager now plans a rep's day in the console (`/planning`, `plan_mr_day`), which creates the planned visits; a rep can also add an unplanned visit on the phone. Before that, nothing in production created a visit (`BE-W139`). What still has to exist: a field manager account above the rep's territory, and doctors in it (**Q-7**) | **Q-7** — doctors; and a manager account (step 4) |
| 3 | **check in** | `is_within_shift` refuses: *"no shift window configured for territory % or any ancestor, and no organisation default"* | **Q-8** — the approved hours (or the operator's test value, `BE-C50`, set as an expiring fallback: step 3.2) |
| 4 | **record a doctor's consent** | `capture_consent` refuses: *"no active consent text for language % at %"*; the app blocks with "there is no consent notice for this language yet" | **Q-11** — the registered legal name the notice must carry |
| 5 | **record a voice note** | `begin_upload` refuses: *"visit % has no standing consent; there is no upload path"* | **Q-11** — via 4 |
| 6 | **write a call report** | It belongs to a visit | Via 2 |
| 7 | **use any AI feature** | `ai_begin_request`: *"has no approved prompt"*; `start_sim_session` likewise | **Q-1** (the key), then **Q-14** to approve a prompt |
| 8 | **take a training course** | `assign_course`: *"course % has no published version to take"* | Content authored, then **Q-14** to approve it |

**What a rep CAN do with nothing more supplied:** record samples — with no cap set they are
accepted and uncounted, and the screen says so (until **Q-10**; CI fails on 6 November while unset).

**The finding the register could not show:** row 2. Every listed input could arrive and a rep would
still open Today to nothing.

## The Android release build — checklist (everything that does not need a credential is done)

**In the repository, tested** (`apps/field/plugins/android-release.cjs`, `src/android-release.test.ts`,
`plugins/release-signing.cjs`, `scripts/verify-release-apk.mjs`):

| # | Item | State |
| --- | --- | --- |
| A1 | Application id `com.praversetech.fieldforce` (`app.json`) | Done |
| A2 | **versionCode** from `FIELD_ANDROID_VERSION_CODE`, a whole number 1–2,100,000,000; a malformed value stops the build; unset is 1 (development and demo only). **Every APK given to reps needs a higher number than the last** — use the CI run number or increment by hand | Done; the release owner supplies the number |
| A3 | **Blocked permissions** in every build: background location, external storage read/write, drawing over other apps (libraries merged them in; none is used) | Done — re-check the merged manifest after each prebuild (A8) |
| A4 | A release build is signed with the company key or Gradle refuses it; `verify-release-apk.mjs <apk> --expect-sha256 <fingerprint>` refuses the debug key or a second signer | Done — waits on the **release key** |
| A5 | No secret in the app: only `EXPO_PUBLIC_SUPABASE_URL` and the PUBLISHABLE key; the service-role key lives only in the Edge Function (`_shared/practice-writer.ts`, CI-checked) | Done |
| A6 | No localhost in a release: `src/api-target.ts` refuses an empty address in a release; `127.0.0.1` fallbacks are development-only; plain http only for a demo build's listed hosts | Done — `BE-W150` closed 9 October: the unused `EXPO_PUBLIC_API_BASE_URL` gate is removed; the Supabase URL and publishable key are still required (`src/config-required.test.ts`) |
| A7a | **The production build command**: `apps/field/scripts/build-release-apk.ps1 -ExpectSha256 <fingerprint>` wraps prebuild + Gradle `assembleRelease` and refuses, before Gradle, a dirty tree, an `apps/field/.env*` file, a non-https/local Supabase URL, a secret key, a missing/malformed version code, a missing signing value or keystore, the debug key, demo/recording/coaching switches; after the build it runs `verify-release-apk.mjs`. `-CheckOnly` runs the refusals alone (`BE-W177`) | Done — waits on the **release key** |
| A7 | Every AI feature, Learning and the tutor are separate `EXPO_PUBLIC_*` switches, OFF unless set | Done |

**Not possible without the operator** — each is one input:

| # | Item | Waits on |
| --- | --- | --- |
| A8 | Prebuild and audit the merged manifest (`android/app/src/main/AndroidManifest.xml`): only INTERNET, location (fine/coarse), RECORD_AUDIO, MODIFY_AUDIO_SETTINGS, VIBRATE, POST_NOTIFICATIONS and expo-audio's FOREGROUND_SERVICE pair. The pair is left unblocked on purpose: expo-audio declares a service that uses it, and removing it is only safe once proved on a device | A build machine run (no credential), then a handset |
| A9 | The production address (`EXPO_PUBLIC_SUPABASE_URL`, publishable key, `EXPO_PUBLIC_APP_*`) in the build shell's environment — not in `apps/field/.env`, which the build script refuses | **Q-19** |
| A10 | Physical-device pass: install over the previous build (versionCode higher), sign in, permission prompts in order (location while using, microphone only at recording, notifications), a full offline day, check-in/out, report, Pending sync, reconnect | A **handset** |
| A11 | The release keystore, its four Gradle properties, and its SHA-256 fingerprint | The **release key** |

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

## Deploy attempt — 5 October 2026 (W1-W): STOPPED AT 0.1. Resume from here

**State, as somebody else could pick it up.** Nothing in production was changed.

| Step | Done? | What was read | Run |
| --- | --- | --- | --- |
| PR #2 merged | **Yes** | merge commit `bf68c9c`; CI green on it (database: 80 files, 1102 passed / 2 skipped / 4 todo) | CI `37263392812` |
| 0.1 backup | **Ran — FAILED its prediction** | The run is **green, but it has 0 artefacts**: every step after *"Is there a destination for this artefact?"* was skipped, and the job's own notice reads *"BE-W11 deliberately disabled … Deferred until 2026-10-15"*. **A green backup run is not a backup** — the second half of 0.1's proof ("its artefact listed on the run") is the half that fails | `37264597473` |
| 0.2 drift | Not run (stopped at 0.1) | Read-only, already produced by the merge push: **19 of 96 applied, a clean prefix, nothing applied without a file** — the shape 0.2 predicts | `37263392693` |
| 0.3 – 0.4, 1.x onward | **Not started** | — | — |
| Paid plan | **Not checked** — not reached; confirm it is ACTIVE before 1.1, do not infer it from the approval | — | — |

**What resumes it — one operator answer, THEN engineering.**

1. **Q-19 answered 10 October: Supabase-managed backups (`BE-C80`).** If the answer is GitHub or a bucket instead, 0.1 reverts to the workflow
   route and `BE-W143` (a step that stores the copy) must be built first.
2. **Done for "Supabase" (10 October):** 0.1 above now reads "the paid plan is active, and a completed
   Supabase backup dated today exists". The *Database backup* workflow is no longer part of 0.1.
3. The operator confirms both halves of 0.1, then continue at 0.2, in order.

**Updated on 5 October because `main` moved:** 0.2, 0.4, 1.1, 1.2 and S1 now expect **96** migrations
(77 pending: first `20260907000100`, last `20261002000400`). **Three of the 77 were never part of the
W1-S rehearsal** on a production-shaped copy — `20261002000200` (the `model_refused` flag),
`20261002000300` (UCPMP sees company caps), `20261002000400` (rejection log append-only). Each is a
`create or replace function`, a trigger, or a check-constraint change; each applies in order from an
empty database in every CI run, and none rewrites a table.
