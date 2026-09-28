# W1-A — measured recon: the audit gap, the grant surface, maps, tracking, notifications, and the integration environment

**28 September 2026.** A snapshot. Every claim is marked `code`, `emulator`, `browser` or
`handset`; unmarked claims are `code`. **There is no `handset` result in this document and no
result of any kind against a hosted Supabase project.**

Populations are enumerated from the catalogue and from package manifests, not from recollection.
Where a claim rests on a command, the command is printed.

---

# PART B3 — THE AUDIT GAP: THE PREMISE IS FALSE

**The brief asked me to close a registered gap — *"no AI or LMS table carries `write_audit_row`"*
(`docs/ai-platform/INVENTORY.md`, §A1 §41 and §B-adjacent). I measured it before building, and
the gap does not exist.**

```bash
# the population: every table the five PR #2 migrations create
grep -h "^create table public\." services/api/supabase/migrations/2026092400*.sql \
  | sed 's/create table public\.//; s/ (.*//' | sort
# the coverage: every table given an audit trigger by those same migrations
grep -h "_audit after" services/api/supabase/migrations/2026092400*.sql \
  | sed 's/.*on public\.//' | sort
```

**16 tables. 15 carry `write_audit_row`.**

| Migration | Tables | Audited |
| --- | --- | --- |
| `20260924000400_catalogue.sql` | `markets`, `therapy_areas`, `products`, `product_markets` | **4 of 4** (`:197-204`) |
| `20260924000500_lms_core.sql` | `courses`, `course_versions`, `course_modules`, `lessons`, `course_assignments`, `course_enrolments`, `lesson_completions` | **7 of 7** (`:441-454`) |
| `20260924000600_knowledge.sql` | `knowledge_documents`, `knowledge_document_versions`, `knowledge_chunks` | **2 of 3** (`:334-337`) |
| `20260924000700_ai_control_plane.sql` | `ai_prompt_versions`, `ai_requests` | **2 of 2** (`:245, :285`) |

**So the honest answer to B3 is a correction, not a commit.** `INVENTORY.md` is five days old and
recorded a gap that its own subject had already closed. This is the third time in this repository
that a register has been found asserting a stale claim with more authority than the code —
`CLAUDE.md`'s own preamble is about the first, and the deleted knowledge graph was the second.
**`INVENTORY.md` should be corrected; I have not edited it, because it declares itself a snapshot
to be replaced rather than appended to.**

## The one table not audited, and why it should stay that way

**`knowledge_chunks`.** Covered deliberately, not overlooked:

- A chunk is **derived**, not authored. `submit_knowledge_version` cuts them from the version body
  at submit time, and that version's insert and every status change **is** audited.
- The table is **insert-only and immutable** — `knowledge_chunks_reject_mutation`
  (`20260924000600:321`) refuses every update and delete.
- Auditing it would write **one audit row per chunk per submission**. That is exactly the
  reasoning `C17` already settled for `upload_grants`: *"auditing all of it would put one row per
  chunk into `audit_log` and bury `issued -> revoked`."* A trail that cannot be read is the same
  failure as no trail, reached from the other side.

**Which tables I covered: none, because none needed it. Which I did not: `knowledge_chunks`,
deliberately, with the reasoning above.** No migration was written for B3.

**What I did add instead** — because the useful output of a false premise is a mechanism that
stops the question being re-asked from memory: nothing. A structural test over audit coverage
would need a named exception list, and a list of one whose reason is `C17` is better written here
than encoded. Registered as a judgement, not deferred work.

---

# PART B4 — THE 17 NEW `authenticated` GRANTS: ALL ARE NECESSARY, AND THE REASON IS STRUCTURAL

`INVENTORY.md` B4 finding 4: *"PR #2 expands the `authenticated`-callable SECURITY DEFINER
surface by 17 functions with no consumer. That is a security-relevant fact independent of whether
the features are wanted: 17 new doors, granted to every signed-in user, exercised only by
tests."*

**The finding is real as an observation. The implied remedy — revoke — is wrong, and revoking any
of the 17 would break the feature for its legitimate caller.**

## Why, in one paragraph

**This schema has three Postgres roles — `anon`, `authenticated`, `service_role` — and three
APPLICATION roles: `mr`, `field_manager`, `admin`. The three application roles all sign in as the
one Postgres role `authenticated`.** There is no `admin` Postgres role to grant to. So "granted to
`authenticated`" does not mean "callable by every user" in any meaningful sense — it means
"reachable by a signed-in session, which then has its application role checked in the function
body". Revoking `authenticated` from `approve_knowledge_version` does not restrict it to admins;
it makes it callable by **nobody**.

## The 17, each with its verdict

| Function | Intended caller | Grant necessary? |
| --- | --- | --- |
| `ai_begin_request` | the gateway, **as the signed-in user** | **Yes.** `providers.ts:69` — the gateway passes the caller's token through so every authorisation decision stays in Postgres. A `service_role` grant instead would move authorisation into the gateway, which is the one thing the design refuses |
| `ai_complete_request` | same | **Yes**, same reason |
| `search_approved_knowledge` | anyone in the organisation | **Yes.** It is the only door an AI feature uses |
| `submit_ai_prompt_version` | admin | **Yes** — body checks admin |
| `approve_ai_prompt_version` | admin, four eyes | **Yes** — body checks admin **and** four eyes |
| `reject_ai_prompt_version` | admin, four eyes | **Yes** |
| `retire_ai_prompt_version` | admin | **Yes** |
| `submit_knowledge_version` | admin | **Yes** |
| `approve_knowledge_version` | admin, four eyes | **Yes — and it now has a consumer**, the W1-A E3 console screen |
| `reject_knowledge_version` | admin, four eyes | **Yes — now has a consumer** |
| `retire_knowledge_version` | admin | **Yes** |
| `publish_course_version` | admin | **Yes** |
| `retire_course_version` | admin | **Yes** |
| `assign_course` | admin or field manager | **Yes** |
| `cancel_course_assignment` | admin or field manager | **Yes** |
| `start_course_version` | anyone, for themselves | **Yes** |
| `complete_lesson` | anyone, own enrolment | **Yes** |

**Revoked: none. With a test: see below — the test that matters already exists and is stronger
than one I would have written.**

## The risk that IS real, and what already guards it

The genuine exposure is not `authenticated`; it is `anon`. A function born `anon`-executable is
callable with no session at all, and Supabase's default privileges grant `anon` on every new
object while `postgres` cannot change that default.

**That is already a mechanism, not a state check.** `services/api/tests/privilege-posture.spec.ts`
fails the build when any object in `public` is reachable by `anon` or `PUBLIC` unless allowlisted,
and it carries **three positive controls** — it creates a table, a function and a sequence with
the defaults and asserts each **is** reachable, so a green result cannot mean a broken query. That
is the `FIX-07` rule applied properly, and adding a second, weaker assertion beside it would be
noise.

**Verified this session, with the database up:** `services/api / vitest` — **Test Files 69 passed
(69)** · **Tests 929 passed | 4 skipped (933)**, `privilege-posture.spec.ts` among them.

**What is still true and unfixed:** all 17 remain reached only by tests, except the two the E3
screen now calls. That is a §56 UNVERIFIED, and it is a consumer problem, not a grant problem.

---

# PART C1 — MAPS

## What the app does with location today

**Enumerated from `apps/field/package.json`: 21 dependencies. Exactly one touches location.**

```bash
python3 -c "import json;d=json.load(open('apps/field/package.json'));print(len(d['dependencies']))"
git grep -n "expo-location" -- apps packages
```

| Fact | Evidence |
| --- | --- |
| `expo-location ~57.0.14` is the only location dependency | `apps/field/package.json:33` |
| **There is no map dependency at all** — no `react-native-maps`, no `expo-maps`, nothing | the 21-line dependency list |
| One module uses it | `apps/field/src/capture/location.ts`, the only non-test importer |
| Two screens call it | `app/onboarding/location.tsx:5` and `app/visit/[id].tsx:20` |
| **Discrete fixes only. No watcher, no subscription, no task, no service** | `location.ts:4-11` — *"There is no watcher, no subscription, no task and no service here, and there is deliberately no function that starts one."* |
| Foreground permission only | `requestForegroundPermissionsAsync`, never the background call (`location.ts:16`) |
| **Nothing is cached** — a fix is used for the request that asked for it and forgotten | `location.ts:21-23` |
| `Accuracy.Balanced`, not `Highest` | `location.ts:24` |

**So today: a position is read when an MR presses check-in or check-out, sent with that write, and
never stored on the device.** The coordinates and the distance from the clinic are what the server
keeps.

## What a map screen would need

| Option | Dependencies it adds | Money | The catch |
| --- | --- | --- | --- |
| **(a) `react-native-maps` + Google Maps SDK** | one npm dependency, **plus a native module**, plus a Google Maps API key in the Android manifest | Google Maps Platform bills per 1,000 map loads. There is a monthly free allowance; **beyond it this is a metered bill on a named billing account** | A native module means **the Expo Go client can no longer run the app** — it needs a development build. That is a change to how every developer runs the project, not just a dependency |
| **(b) `expo-maps`** | one Expo dependency; still a native module, still a key | same Google billing | Newer and less proven in this Expo version than (a). Same development-build consequence |
| **(c) A static map image** — a rendered PNG from a tiles/static API | **no native module**, no npm dependency; an `<Image>` with a URL | metered per image request | **The URL contains the coordinates.** That sends a clinic's location to a third party on every render, and `constraints.md` requires opaque keys precisely because *"nothing about a doctor, clinic or patient goes in one"*. It also cannot be panned or zoomed |
| **(d) No map — a list and a distance** | **nothing** | **nothing** | This is what the app does now. It answers "am I at the clinic" without answering "where is the clinic" |

**I am not choosing.** Two things the operator should weigh that are not obvious from the table:

- **(a) and (b) both require a billing account somebody owns.** The approved AI budget is ~$10–40
  a month and is for AI; a Maps bill is separate, and map loads scale with reps × visits per day.
- **The development-build consequence of (a)/(b) is the larger cost, and it is one-time-per-person
  rather than per-month.** `C11`/`C9` already put `expo-file-system` through this project's
  "ask before adding a dependency" gate; a native map module is a heavier version of that.

**DECISION REQUIRED — C1.** *Do we build a map screen at all, and if so on which provider and
whose billing account?* **Owner: Praverse + client** (the technical half is ours; the billing
account and the per-month cost are not).

---

# PART C2 — LIVE TRACKING

## First, plainly: background geolocation is UNWRITTEN, and it is not a dependency of this app

```bash
python3 -c "import json;d=json.load(open('apps/field/package.json'));print([n for n in d['dependencies'] if 'background' in n or 'task' in n or 'geo' in n])"
# -> []
```

| Claim | Evidence |
| --- | --- |
| `react-native-background-geolocation` is **not** a dependency | absent from the 21; recorded independently at `docs/blocked-on-you.md:409` (MR-29/MR-30 A2 correction) |
| No `expo-task-manager`, no `expo-background-fetch` | absent from the 21 |
| No background location permission | `location.ts:17-20` — *"the manifest does not carry `ACCESS_BACKGROUND_LOCATION` either, so the background call would fail anyway — two locks on the same door"* |
| No code starts a watcher | `location.ts:4-11`, and `git grep watchPositionAsync` returns nothing outside comments |

**There is nothing to switch on. Live tracking is a feature to be built from nothing, not a
setting.**

## The conflict the operator must resolve, and it is not a technical one

**Three things are each true and they do not fit together.**

**1. The notice awaiting your approval promises the opposite of continuous tracking.**
The redrafted reps' notice — `blocked-on-you.md:831` and `:1080`, the version sitting on branch
`mr-46/fe-w52-notice-pending-approval` **awaiting your approval since 21 September** — reads:

> **Location** — *Where you are — only when you check in or check out.* Your position at the moment
> you press check-in and check-out, and how far that is from the clinic. **Nothing between visits,
> and nothing in the background.**

That wording was written *because* the previous row overstated in the other direction ("Start day
to End day"). **Approving that notice and then building continuous tracking would make the notice
false on the day it shipped** — and it is a compliance record every MR reads.

**2. Continuous tracking is a SEPARATE PURPOSE under DPDP and needs its own notice and its own
basis.** "Where you were when you checked in" and "where you were all day" are not the same
processing with a different frequency. The second is continuous location monitoring of an
employee. It needs its own stated purpose, its own notice, and its own lawful basis — which is the
same class of question as `C8` (the purpose of the audio) and is not answerable by engineering.

**3. OEM battery behaviour cannot be reproduced on an emulator.** Continuous location is precisely
the workload Xiaomi, Oppo, Vivo and Realme ROMs kill most aggressively, and `blocked-on-you.md:349`
already names those four as the required test devices for exactly this reason. **`FE-G1` and
`FE-G2` have been open seven weeks waiting for a handset nobody has bought.** A tracker that the
ROM silently kills produces *gaps*, and a gap in a tracking record is worse than no record — it
reads as "the rep was not working".

## What it would require, and which gates it reopens

| Requirement | Kind |
| --- | --- |
| A new native dependency and a foreground service notification Android requires | **dependency — ask first** (`constraints.md`) |
| `ACCESS_BACKGROUND_LOCATION` in the manifest, plus Android's separate "allow all the time" prompt | permission |
| A new consent/notice text, approved | **your decision** |
| A retention rule for the location trail, and a purge worker for it | build |
| Per-OEM battery survival, on four ROMs | **handset** |

**Gates it reopens:** **`FE-G1`** and **`FE-G2`** (both already blocked on a handset, and both
would need re-running *after* tracking exists, per `C12`: verified means a handset run after the
feature exists); **`G-PERF`**, whose end-to-end half has never been measured; and **`FE-W52`**,
the notice, which would need a fourth redraft.

**DECISION REQUIRED — C2.** *Do we track a rep's location continuously, accepting that it is
employee monitoring with its own DPDP notice and basis, and that it cannot be validated without
the four handsets?* **Owner: client + legal** (it is a purpose and basis question, not a
technical one).

---

# PART C3 — NOTIFICATIONS

## None exist

```bash
python3 -c "import json;d=json.load(open('apps/field/package.json'));print([n for n in d['dependencies'] if 'notif' in n or 'firebase' in n or 'push' in n])"
# -> []
```

| Claim | Evidence |
| --- | --- |
| No `expo-notifications`, no Firebase, no push dependency | absent from the 21 |
| **Master prompt §44 assumes a notification system exists** | *"§44 says integrate with the existing notification system — there isn't one"* (`INVENTORY.md` §A1) |
| One screen *talks about* notifications and requests nothing | `apps/field/src/onboarding/notifications.ts` — names four types and caps them, and its own header records that the four names are **derived from existing features, not from the design**, and the cap is **not sourced at all** |

**That onboarding screen is worth a sentence of its own.** It asks the MR about notifications the
app cannot send. It is honest in its source comments about being unsourced, but the MR reading it
is being told the app will send them four kinds of thing. **Whatever is decided below, that screen
is wrong today.**

## What push requires

| Requirement | Detail |
| --- | --- |
| **A Firebase project** | Android push goes through FCM. A project must be created, and **somebody must own the Google account it belongs to** |
| **A dependency** | `expo-notifications` — a native module, so the same development-build consequence as the map options |
| **A key / credential** | `google-services.json` in the app, and a server credential to send with. A server credential that can push to every rep's phone is a secret with a real blast radius |
| **An account owner** | A named human who owns the Firebase project and the billing relationship. FCM itself is free at this scale; the *account* is the thing that needs an owner |
| **A sender** | Something server-side that decides to send. Today the nearest thing is GitHub Actions (the retention pattern), which is fine for "a course is due" and **cannot** do anything interactive |

## The in-app-only alternative, and what it cannot do

**In-app notification: a row in a table, read by a badge and a list when the app is next opened.**

| It needs | It can do | **It cannot do** |
| --- | --- | --- |
| One table, one RPC, one screen. **No dependency, no Firebase, no key, no account owner** | "You have 3 courses due", "an upload was refused", "a finding needs your reply" — anything the rep will see next time they open the app | **Reach a rep who does not open the app.** Nothing time-critical: no "your shift window closes in 20 minutes", no escalation, no safety-case clock. An escalation that only arrives when the recipient happens to look is not an escalation |

**The honest framing for the operator: in-app covers everything in the LMS and the queue, and
covers nothing in the adverse-event path.** And the adverse-event path is blocked on `#18`
anyway (deferred by `C28`), so **in-app is sufficient for everything in scope this release** — and
choosing it now does not foreclose push later, because push would read the same table.

**DECISION REQUIRED — C3.** *Do we build push (which needs a Firebase project and a named account
owner), or in-app-only (which needs nothing and cannot reach a rep who does not open the app)?*
**Owner: Praverse + client.** Register `#10` / `D9`. **Our recommendation: in-app-only for this
release.**

---

# PART C4 — THE THREE DECISIONS, IN ONE PLACE

| # | The question, in one sentence | Owner |
| --- | --- | --- |
| **C1 — maps** | Do we build a map screen at all, and if so on which provider and whose billing account? | **Praverse + client** |
| **C2 — live tracking** | Do we track a rep's location continuously, accepting that it is employee monitoring needing its own DPDP notice and basis, and that it cannot be validated without the four OEM handsets? | **Client + legal** |
| **C3 — notifications** | Push (a Firebase project, a native dependency, a named account owner) or in-app-only (nothing, but cannot reach a rep who does not open the app)? | **Praverse + client** |

**Nothing was built for any of the three.** The brief said measure, not build.

---

# PART D — THE INTEGRATION ENVIRONMENT

`C27` targets 4 October and the frontend needs to test against a real backend as screens land.

## D1. How far behind production is — and the number in the brief is stale

**I cannot measure production, and neither can anything in this repository.**
`.ai-collab/constraints.md`: *"The remote Supabase project is not linked. Every measurement in
this repo comes from the local stack."* `INVENTORY.md` records that the Elmiron-App project is
absent from the Supabase account connected to this machine, `~/.elmiron-prod.env` does not exist
here, and there is no linked project-ref.

**The repo's last verified figure: 19 migrations, applied 14 August at `BE-W8`**, read from
`schema_migrations` over the pooler by `BE-W40` (`blocked-on-you.md:474`).

```bash
ls services/api/supabase/migrations/*.sql | wc -l     # 81 on this branch, after W1-A E1
```

**81 − 19 = 62 pending, not 45.** The brief's 45 was true against a smaller migration set and is
now stale by 17. *Recorded as a correction rather than repeated, because a number in prose is a
snapshot* (`constraints.md`, FIX-07).

**The command that would settle it, which nobody has run:**

```bash
node services/api/scripts/check-migration-drift.mjs   # needs the production connection string
```

## What the frontend CAN and CANNOT test against today

| Target | Can the frontend test against it? |
| --- | --- |
| **The local stack** (`127.0.0.1:54321`) | **Yes, fully. This is the answer for this week.** Verified this session: all 81 migrations applied, 52 public tables, and the full API suite green — **69 files, 929 passed, 4 skipped** |
| **`services/mock`** (`:4010`) | Yes, and six field surfaces still read it (coaching, analysis, reply, mileage, day-end, and the read half of the call report). **It returns the contract's own shape by construction, so it cannot find a response-shape drift** — `constraints.md` records that the first real call found snake_case keys and a nested/flat mismatch the mock had hidden for months |
| **Production** | **No, for anything added since 14 August.** That is the tenant boundary, organisation scoping, the audio path, the recording-permission read, the AI/LMS/knowledge layer, and W1-A E1. A screen tested against production today is tested against a schema without a tenant boundary in it |

**The consequence, stated plainly: until production is migrated, "tested against a real backend"
means the local stack, and a green result there is not evidence about production.**

## D2. The operator's ordered steps — ONE place, with what breaks if each is skipped

**The order is the whole of it. Each step's failure mode is what makes the order non-negotiable.**

### Step 0 — the pre-flight query. One query, and nobody has run it.

```sql
-- Against PRODUCTION. Does it already hold reference data?
select (select count(*) from public.territories)  as territories,
       (select count(*) from public.doctors)      as doctors,
       (select count(*) from public.user_profiles) as profiles,
       (select count(*) from supabase_migrations.schema_migrations) as applied;
```

**If `applied` is 19 and the three counts are 0**, everything below is a free ordering win.

**If any count is NOT 0, stop. This is an incident, not a deployment.** Production is at a schema
with a known, named, still-open cross-tenant admin read (`BE-W76`, closed by
`20260908000900_organisation_scoping.sql` and `20260908001300_tenant_boundary_restrictive.sql`,
**neither of which is on production**). Data loaded before those two means real organisations'
rows have been mutually readable, and **nothing in the schema records that they were.**

**If skipped:** you deploy without knowing whether an exposure is already live, and the deploy
closes the hole *and destroys the evidence of how long it was open*.

### Step 1 — shift hours, configured BEFORE the migration that needs them

`blocked-on-you.md:926` — *"Before deploying MR-47's migration: configure shift hours."*

**If skipped:** capture **refuses**. An MR cannot check in at all. The organisation-default window
also **expires 60 days after it is configured** and then refuses again — so this is not a one-time
step, it is a dated one. Register `#28`.

### Step 2 — the migration deploy, all 62

```bash
node services/api/scripts/check-migration-drift.mjs      # confirm the gap first
supabase --workdir services/api db push                  # then deploy
```

**If skipped, or done after step 3:** reference data lands on a schema with no tenant boundary.
This is the whole of escalation `6.1` and register `#31`.

**One thing to know before running it.** `20260908000800_user_profiles_organisation.sql` called
`min()` on a `uuid`, which PostgreSQL has no aggregate for, and **aborted the deploy** rather than
failing gracefully — no migration ordered after it would ever run. It was fixed in place under the
one named exception (`constraints.md`, MR-35 B3). **The deploy has been rehearsed against seeded
databases; it has never been run against production.**

### Step 3 — reference data, and only now

Territories, doctors, the product catalogue. **Register `#28`, open since sprint 3.**

**If done before step 2:** see step 2.

### Step 4 — the paid plan

**Register `#35`, about $25/month. The free tier auto-paused production for two weeks in August.**

**If skipped:** the database pauses itself, and every "the backend is down" report for the next
fortnight is this. It also makes `G-PILOT` unachievable by definition — that gate requires *"a
database that does not pause itself"*.

### The order, as one line

**pre-flight query → shift hours → migrate (62) → reference data → paid plan.**

## D3. What the frontend developer builds against until then

**Build against the local stack.** Concretely:

```bash
pnpm db:start        # supabase start + lock-logging instrumentation
pnpm db:reset        # applies all 81 migrations from scratch
```

Point `EXPO_PUBLIC_SUPABASE_URL` at `http://127.0.0.1:54321` — or the machine's LAN address on a
real device, since `localhost` on a handset is the handset (`apps/field/src/config.ts:38-40`).

| Screen work | Testable now? |
| --- | --- |
| Anything on the local stack — every screen, every write path, the AI/LMS/knowledge layer | **Yes** |
| **The knowledge approval screen** (W1-A E3) | **Yes**, on the local stack — and it needs **two admin accounts** or four eyes refuses every approval (`C25`, `E2`) |
| The six mock-reading surfaces, repointed to real | **Yes**, and `INVENTORY.md` §C3 warns that `/analyses/:id/response` is a **mock-only route** — PostgREST serves `/rpc/<name>` and would 404. That one cannot simply be repointed |
| Anything needing **real** reference data, real territories, real shift hours | **Only after D2 steps 1–3** |
| Anything needing a **live model** | **Not this week, and not after D2 either.** `#4` and `#5` |
| `FE-G1`, `FE-G2`, the end-to-end half of `G-PERF` | **Only on a handset.** Xiaomi/Oppo/Vivo/Realme, not a Pixel. **Open seven weeks** |

**The one sentence for the frontend developer: build and test entirely against the local stack
this week, keep the two-admin requirement in mind for the approval screen, and treat every green
result as evidence about the local stack and nothing else.**
