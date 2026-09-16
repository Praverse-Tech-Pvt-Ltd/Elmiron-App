# Blocked on you — 14 August 2026

> # 📅 TWO DATED DEADLINES, AND NEITHER WARNS YOU FIRST
>
> **Both break CI on a fixed date. Neither is an engineering task. Both are yours.**
>
> | Date | What breaks | Days left as of 16 Sep 2026 |
> | --- | --- | --- |
> | **30 September 2026, 23:59 IST** | `CONTRACT_I3_DEADLINE` — the `TranscriptV0` placeholder expires | **14** |
> | **6 November 2026** | `5.9` — the UCPMP sample cap decision (warns from 16 October) | 51 |
>
> ### The 30 September one has NO warning period, and that is the difference
>
> `5.9`'s mechanism (`check:decision-debt`) has **three states** — clear, warn, fail — and the
> reason is written into it: *"a red build arriving unannounced on the day is treated as an
> obstacle to get past, where a warning three weeks earlier is treated as a question."*
>
> **`CONTRACT_I3_DEADLINE` has two.** `packages/core/src/field/transcript-v0.expiry.test.ts`
> asserts `hasV1 || !expired`. It is green today and it turns red at **2026-09-30T18:29:59Z**
> with no notice of any kind. It runs in CI on every push (`ci.yml:83`).
>
> **This entry is the warning the mechanism does not give you.** Verified 16 September: no
> `TranscriptV1Schema` is exported anywhere in the repository, and the deadline has never been
> moved.
>
> ### The two honest resolutions, and a third that is not one
>
> 1. **A real `TranscriptV1`** — which needs the measured word error rate on real Hinglish
>    MR-doctor audio and the vendor decision that follows from it. Both are owned by AI/ML and
>    both are past due since week 2.
> 2. **Formally cut the AI layer**, and remove the test with the reason recorded in the commit.
>    That is a legitimate outcome and it is a decision, not a deletion.
>
> **Not a resolution: shipping a placeholder `TranscriptV1` to make CI green.** That is working
> around the guard the test exists to be — its own header says *"a placeholder that works is a
> placeholder that stays"*. And it would buy nothing: **the AI/ML chain cannot start anyway
> until the PV/DPDP signatory exists** (items 4.1 and 4.4, open since week 1).
>
> **Extending the date is the third path and it is honest if you own it.** The test says how:
> change one line and name the person who agreed the new date in the commit message. What is not
> honest is letting it go red and then extending it in a hurry to unblock a build.
>
> **What it costs to do nothing:** from 1 October, every push to `main` has a red `CI`. This
> repository already knows where that leads — red became routine on 22 August, the workflows
> were disabled on 23 August **with no reason recorded**, and production auto-paused unnoticed
> for two weeks. See `docs/gotchas.md`.


> # ⚠ ONE QUERY, AND NOBODY HAS RUN IT
>
> **If you have production credentials, run this before you read anything else on this page.
> It takes one second and it decides whether §6.1 is a scheduling item or an incident.**
>
> ```bash
> psql "<direct url>" -At -c "select 'territory_less=' || (select count(*) from public.user_profiles where territory_id is null) || '  organisations=' || (select count(*) from public.organisations) || '  consent_notices=' || (select count(*) from public.consent_text_versions);"
> ```
>
> **What the answer means:**
>
> | Result | What it tells you |
> | --- | --- |
> | all three are `0` | §6.1 is a **sequencing item**. Deploy the 37 pending migrations before any reference data is loaded, and the whole problem goes away. The deploy takes seconds |
> | `territory_less > 0` or `consent_notices > 0` | The two backfills in the pending batch will **execute** rather than no-op. They are fixed as of MR-35, but they have still never run anywhere. Read `docs/restore-runbook.md` → Phase 0 before pushing |
> | **anything is non-zero AND real customer data is present** | **§6.1 IS AN INCIDENT, NOT A SEQUENCING ITEM.** Production is 37 migrations behind, which means it has **no tenant boundary** — `BE-W76`. One organisation's admin can read another's data, and that is true right now, not at some future date |
>
> **Why this is at the top of the page.** Every judgement below about production rests on the
> claim that it holds no reference data — and `docs/COMPLETION-PLAN.md:217` records that claim
> as **unverifiable from the engineering machine**. `BE-W40` has since verified the migration
> COUNT over the pooler. **Nothing has ever looked at the rows.** No agent can run this: the
> credentials are deliberately not on the engineering machine, and `assertLocalhostOnly()` exists
> to keep them off it.
>
> It is the highest-value action available to anyone holding production credentials, it costs
> one `SELECT`, and until somebody runs it this project does not know which of two very
> different situations it is in.


Every open item that no agent can resolve, consolidated. Backend is stopped by decision. Frontend is at the limit of what can be built without you.

**For the first time on this project, there is no engineering work that can proceed.**

---

## 1. Today — unblocks FE-W1 completion

| # | Item | What it blocks | Notes |
|---|---|---|---|
| 1.1 | `gh auth login && gh auth setup-git`, then `git push origin main` | 5 commits unpushed. **CI has never run on any frontend code.** | `credential.helper=manager` serves a stale token and never consults `gh` — already in `docs/gotchas.md` |
| 1.2 | If the 403 persists after 1.1 → **org admin grants write access** to `Praverse-Tech-Pvt-Ltd/Elmiron-App` | Same | Two different causes. Re-authenticating cannot fix a permissions problem. Don't let anyone burn hours on token plumbing if it's this one. |
| 1.3 | `eas login` — an Expo account | **Any APK build at all** | Free tier: 15 Android builds/month, 90+ min queue at peak |
| 1.4 | Elevated PowerShell:<br>`New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force` | Metro and Gradle deep paths | `git config --global core.longpaths` is already set; this is the other half and needs admin |
| 1.5 | **A physical Android device** | **FE-G1** | Get a Xiaomi, Oppo, Vivo or Realme — not a Pixel. Those ROMs kill background processes aggressively, hold large Indian market share, and background location dying silently is the most likely field failure on this product. It will not reproduce on an emulator. |

---

## 2. Decisions — cheap now, permanent later

| # | Decision | Deadline | Why it can't wait |
|---|---|---|---|
| 2.1 | **Whose Play Console account ships this — yours or the client's?** | Before FE-W8 | Decides package ID, listing ownership, keystore custody, and what happens if the relationship ends |
| 2.2 | **The package ID.** Currently the placeholder `com.praversetech.elmironmr` | Before first Play upload | **Permanent.** A different ID is a different app — new listing, zero installs, zero reviews. Also: it embeds a pharmaceutical brand name you may not own. `com.praversetech.fieldforce` costs nothing now. |
| 2.3 | **Keystore custody** — EAS holds it, or enrol in Play App Signing | Before first Play upload | If access to the Expo account is ever lost, you cannot update an app already on the Play Store. No recovery path. *[Verify Play App Signing against current Play Console docs.]* |
| 2.4 | **Transistorsoft release licence** | Before FE-W8, but check now | Believed required for Android release builds, free for debug. Unverified — check transistorsoft.com. A purchase order takes longer than a sprint. |

---

## 3. Content — degrades everything downstream

| # | Item | Blocks |
|---|---|---|
| 3.1 | **Brand guideline and design plan into `docs/`** | Every colour in the app is a labelled placeholder. The WCAG validator and token structure are built and tested; only the values are missing. Swapping them in is one file. |

---

## 4. Long-open escalations

These predate the frontend entirely. Drafts are in `docs/escalations-week3.md`. All four still need a named recipient and a date.

| # | Item | Open since | What it blocks |
|---|---|---|---|
| 4.1 | **PV and privacy sign-off.** Two specific questions: may `adverse_event_reports.reported_text` contain patient information, and does an adverse-event report survive a consent withdrawal? | Sprint 1 | Both are currently answered by a **default, not a decision**, and both are now baked into a deployed production schema. A different answer is a migration against live tables. |
| 4.2 | **Contract I3 — STT vendor decision and measured Hinglish WER on real audio** | Sprint 2 | The entire AI layer. **CI goes red on 30 September** unless `TranscriptV1` exists. If the answer comes back bad, the pipeline is cut — so every week of delay is a week of risk that work gets built and deleted. |
| 4.3 | **Per-territory working hours from the client** | Sprint 3 | Capture refuses without them. The org-default window expires 60 days after being configured, then refuses again — by design. |
| 4.4 | **Supabase DPA question:** does a deleted storage object survive in S3 versioning, a soft-delete window, or a sub-processor's backup? | Sprint 7 | Decides whether the 90-day retention claim is literally true. Not answerable from the API. Needed before the pilot. |

---

## The honest summary

Engineering has run roughly seven times ahead of plan for eight sprints. Every one of the fourteen items above requires a human with credentials, admin rights, a purchase decision, a phone, or a conversation with the client.

Four of them have been open since the first three sprints.

Items 1.1 through 1.5 are an afternoon. Section 2 is four decisions. Section 4 is four emails that need names on them.

Nothing else moves until they do.

---

## Transcribed from the review conversation — 9 September 2026

**MR-13 §2.** These existed only in the review conversation. None is an engineering item,
and none is blocked on this codebase.

> **The engineering has been outrunning its estimates since August. What has not moved in
> six weeks is a phone, a $25 subscription, a licence decision and eight emails.**

| # | Item | Owner | Open | What it blocks |
| --- | --- | --- | --- | --- |
| **5.13 — THE MOST URGENT ITEM ON THIS LIST** | **The organisation's REGISTERED legal name, as it should appear on a consent notice**, and confirmation that MRs' display names may be shown to doctors | Client | — | **BE-W93. RAISED TO THE TOP BY MR-26 A3, and the reason is the cost curve, not the size of the fix.** The consent screen tells a doctor *"your rep's employer is the Data Fiduciary for this recording"* — the DPDP notice's identification of who holds their data, naming **nobody**. It is not a copy problem: the name is not in the system (no name on the JWT, no organisation name on `user_profiles`, no organisations endpoint). <br><br>**`consent_records` is APPEND-ONLY, so every consent captured before the name exists is PERMANENTLY DEFECTIVE AND CANNOT BE AMENDED BY DESIGN.** The same property that protects the ledger from tampering prevents repair. This is not a backlog item that costs the same whenever it is done — **the cost is not the fix, it is everything captured before the fix**, and it accrues every day the app is used. Every other item on this list waits; this one compounds. <br><br>Do not let engineering pick a name to clear it. The last placeholder read *"Your rep's company"* and looked on a real screen exactly like what it was |
| 5.1 | **A physical Android handset — Xiaomi, Oppo, Vivo or Realme. NOT a Pixel.** Those four are the OEM battery killers the app has to survive; a Pixel proves nothing because its ROM does not do the killing | Operator | **6 weeks** | **FE-G1 and FE-G2.** Both are DEVICE gates and cannot close on an emulator |
| 5.2 | **Supabase paid plan, ~$25/month** | Operator | — | The free tier **auto-paused production for two weeks in August**. Also the honest fix for `BE-W69`, which was declined as a workaround |
| 5.3 | **Transistorsoft licence, or a decision to ship foreground-only check-in** | Operator | — | Geofenced check-in, which is the **primary** check-in mechanism |
| 5.4 | **Play Store versus sideload** | Operator | — | A 100-MR pilot does not need the store. The background-location declaration takes days to weeks, so the answer changes the timeline either way |
| 5.5 | **O1 — the data controller model** | Client | **1 month** | The consent model and the controller fields on **every clinical table**. The patient app cannot start without it |
| 5.6 | **§3.6 recorded in `.ai-collab/decisions.md` with a NAMED human** | Operator | — | Coaching (C4). A decision with no name on it is not recorded |
| 5.7 | **Reference data and per-territory shift hours** | Client | Sprint 3 | Capture **refuses** without them. The org-default window expires 60 days after configuration and then refuses again, by design |
| 5.8 | **The named PV/DPDP signatory** | Client | — | **Audio, permanently**, until it exists (C3) — and with it Tier 1 automations 1, 4, 5 and 6 |
| 5.9 | **The UCPMP cap value and dimension — AND whether `input` counts against it** | Client | — | **A BUILD-FAILING DEADLINE OF 6 NOVEMBER is already wired**, warning from **16 October**. `check:decision-debt` fails CI on that date. Do not invent a value to clear it — set the real one, or file a migration moving the deadline with its reason. **MR-16 B4 adds a second half to the same question:** `enforce_ucpmp_sample_cap` sums `quantity` over `samples_and_inputs` filtered by `doctor_id`, `item_name` and the month **and does NOT filter on `kind`** — so a `sample` and an `input` count against the same ceiling. UCPMP treats them as different things, so this is probably wrong, and **no test can tell either way**: every fixture in the repository holds `kind = 'sample'`, so the accumulation predicate is unfalsifiable on that column. Deliberately NOT split into its own item — it is the same person's answer as the cap value, and splitting it is how one of the two gets answered and the other does not |
| 5.12 | **Which consent-notice LANGUAGE an MR is shown first** | Client | — | **MR-22 B2.** The consent screen defaults to the first offerable version's language, and `displayed_language` is derived SERVER-side from the version the client sends — so this default decides a field on a compliance record. With one language in every fixture it was deterministic by accident; MR-16 added `hi-IN` and it became a function of however the server sorted the rows. MR-22 made the order deterministic (by language code, newest live version first within a language) and **labelled that rule as arbitrary rather than dressing it up as a preference**. The engineering is settled; the product question is not: should the default follow the doctor's recorded preference, the territory, the MR's own setting, or a fixed company order? An MR can already change it on screen, so this is about the FIRST thing a doctor sees, not about what is possible |
| 5.10 | **`consent_max_sync_lag_hours` (72h) and `consent_future_tolerance_seconds` (120s)** | Client | — | Both **UNVERIFIED** — they are defaults nobody has confirmed. The second now also bounds how far a device clock may run ahead on a visit, so its name is wrong as well as its value unconfirmed |
| 5.11 | **The Supabase storage-deletion DPA question** | Operator | **Sprint 7** | Whether the 90-day retention claim is literally true. **Drafted since sprint seven and never sent.** Not answerable from the API |
| 5.14 | **Is a doctor's second answer on the same visit a WITHDRAWAL of the first, or a separate answer?** | Client | — | **BE-W95 / MR-24 B.** MR-24 found that a doctor's decline after a consent was **silently discarded** — the app said "accepted", and `consent_records` still held one row saying `consented`. That is fixed: the decline is now its own row. What is NOT decided is what it MEANS. `is_withdrawal` is false and `supersedes_consent_record_id` is null, because the client sends neither, so both rows stand and a reader must infer the current answer from `captured_at`. The columns and `cascade_consent_withdrawal()` already exist — the mechanism is built and nothing drives it. **The consequences differ:** a WITHDRAWAL reaches back to recordings already made under the first answer; a separate answer does not. Engineering cannot pick between those |
| 5.15 | **What does an MR see when they act on state the server has not yet confirmed — a pending marker, nothing, or a warning?** | Client | — | **FE-W39 / MR-26 A2. NARROWED — the previous version of this item asked you to resolve the whole offline problem, and most of that was ours.** MR-25 filed it as a product trade-off between working offline and never displaying unconfirmed state. That framing was wrong: the honesty rule is about **asserting facts**, not about gating actions on a live round trip, and the pulled store exists so the client can act on state it already holds. The mechanics are engineering and are being done. **What is genuinely yours is one sentence of copy:** once a queued check-in makes check-out reachable, what does the screen say? A pending marker cannot be read as a false claim; "nothing" is only admissible if no copy anywhere asserts confirmation. Engineering's default without an answer is the pending marker |

### The three that are actually urgent

1. **5.9** has a date attached and the date is in the build. It will turn CI red on
   6 November whatever else is happening.
2. **5.1** has been open six weeks and blocks two gates that nothing else can close.
3. **5.5** blocks a second product, not just this one.

---

## Status against this list — 11 September 2026, after MR-28

**Nothing on this list has been answered.** What follows is what changed around it, so the
next reader can see which items got *more* expensive rather than fewer.

| # | What moved | Where it now bites |
| --- | --- | --- |
| **5.13 / `BE-W93`** | **Nothing. Still the most urgent item here, and the only one whose cost grows every day the app is used.** `G-WRITE` closing makes it worse, not better: the consent path is now proved working end to end, which means real consents can be captured, which means defective-and-unamendable rows can start accruing for real | The consent screen still names **nobody** as Data Fiduciary |
| **5.9** | **Now demonstrably load-bearing, not theoretical.** MR-27 C2 and MR-28 B4 drove a real `45004` with a **test-only** cap of 1, reverted and verified back to null in the same session. The refusal now reaches the MR with *"cap 1, already given 0, this entry 2, period starting 2026-09-01"* and the doctor's NAME. **All of that is correct and all of it is unreachable while the cap is null.** Deadline unchanged: CI fails **6 November**, warning from **16 October** | Plus `FE-W41`: the samples screen's cap note says the app does not count against the cap. It becomes FALSE the day this is answered, and it sits three lines below a refusal quoting the cap |
| **5.1** | **Now the single blocker on both device gates from this side, with one engineering item beside it.** `FE-W38` is closed — an MR with no signal performs all five writes, they survive a restart and arrive exactly once. What remains is the handset **and** a dev-client build (JDK 17, CMake, prebuild) for the native modules Expo Go cannot load | `FE-G1`, `FE-G2`. Seven weeks open |
| **5.14 / `BE-W95`** | Unchanged, and the mechanism is fully built and driven by nothing. `is_withdrawal` and `supersedes_consent_record_id` are still null because the client sends neither | A reader must still infer the current answer from `captured_at` |
| **5.15 / `FE-W39`** | **Narrowed again, and mostly answered by MR-26 B2/B5 in engineering's default.** `STAGE_WORDS_PENDING` reads **"Checked in — waiting to send"** — different SENTENCES, not a badge, because a badge is easy to miss and the claim lives in the sentence | What is left is whether that wording is the one you want |
| **5.12** | Unchanged. MR-22 made the language order deterministic and labelled the rule **arbitrary** rather than dressing it as a preference | Still decides `displayed_language` on a compliance record |
| **5.10** | Unchanged and still **UNVERIFIED**. MR-27 C1 drove both `45007` and `45008` by moving these thresholds temporarily — which means both now have a proven MR-facing remedy built on numbers nobody has confirmed | |

### New, and it is ours rather than yours

**`FE-W40` — what an MR sees on a cold start with no signal.** Four options written for a
decision in `docs/decisions/FE-W40-cold-start-staleness.md`. **Engineering recommends option
D**, bounded at the territory day boundary. Option B (fall back to the device clock) is named
and refused so it is not proposed again as an obvious shortcut. Not implemented, and it is
one of the two things an 8-hour `FE-G2` run would hit.

### The three that are actually urgent — unchanged, and re-ordered by cost, not by age

1. **5.13.** It compounds. The other two do not.
2. **5.9.** It has a date and the date is in the build.
3. **5.1.** Seven weeks, two gates, nothing else can close them.

---

## Correction — 14 September 2026, after MR-29 and MR-30 A2

**Two items on this list were wrong about WHY they blocked, and correcting them shortens the
list.** MR-29 built the dev client and read the dependency manifest while doing it.

### `react-native-background-geolocation` is not a dependency of this app

It never has been. Location is **`expo-location` alone**; it has no config-plugin entry in
`apps/field/app.json`; there is no `expo-task-manager`; and the manifest generated by
`expo prebuild` contains **no `ACCESS_BACKGROUND_LOCATION` and no
`FOREGROUND_SERVICE_LOCATION`**.

So background location is **unwritten code, not untested code.** No build unblocks it, and no
device demonstrates it, because there is nothing there to demonstrate.

### What that does to items 2.4 and 5.3

| Item | Said | Correct |
| --- | --- | --- |
| **2.4** — Transistorsoft release licence, *"Before FE-W8, but check now"* | Implied it gates shipping code that exists | **It never blocked existing code.** It blocks a **build-versus-buy decision for work nobody has started**. Still a decision worth taking early, because a purchase order outlives a sprint — but it is not on the critical path and has not been |
| **5.3** — *"Transistorsoft licence, or a decision to ship foreground-only check-in"*, blocking *"geofenced check-in, which is the primary check-in mechanism"* | Implied geofenced check-in is blocked | **Geofenced check-in already works, foreground, with no licence.** MR-29 B4 drove one on the dev client: `check_ins` row `99e71095-fb51-4126-abb6-78130e6bdda3`, `latitude 18.5204`, `longitude 73.8567`, **`geofence_status inside`**, and `visits.status` moved `planned -> in_progress`. What the licence would buy is **passive, background** check-in and shift tracking — a different feature, unstarted |

### The consequence, which is the useful half

> ## `FE-G1` and `FE-G2` are now blocked by the handset ALONE.
>
> Neither gate needs background location. **`FE-G1`** (`FE-W20`) is a signed-in APK driven on a
> physical handset — its own verification asks only that `adb devices` shows a non-emulator
> serial. **`FE-G2`** (`FE-W19`) is a full offline day then sync, accepted: 8 hours, 20+ queued
> writes, no losses and no duplicates.
>
> The dev-client build that stood in front of both **exists and works** — a 79 MB Gradle-built
> APK, signed in, with a real write reaching Postgres and `expo-audio` proved by the Android
> audio HAL opening and releasing a record session for the app's own pid.
>
> **There is nothing else between this app and both device gates except a phone.** Item 1.5 —
> a Xiaomi, Oppo, Vivo or Realme, not a Pixel. **Seven weeks outstanding.**

**Item 1.5 is therefore upgraded**: it now blocks `FE-G1` **and** `FE-G2`, not FE-G1 alone, and
it is the only remaining blocker on either.

**Item 5.1 is likewise narrowed.** Its text reads *"What remains is the handset **and** a
dev-client build (JDK 17, CMake, prebuild)"*. The dev-client build is **done** (MR-29 B). What
remains is the handset.

**What the handset still cannot be replaced for**, so that buying one is not mistaken for
optional: the per-OEM battery behaviour. The AVD is a Pixel image on near-AOSP power
management; the pilot meets MIUI, ColorOS and Funtouch, each with its own process-killer and
its own autostart whitelist in its own place. The onboarding screen *"Stop Android putting this
app to sleep"* renders and its buttons work, and **whether the settings screens it names exist
or do what its copy claims is unknown until a real handset is in hand.**


---

## Escalations — 14 September 2026, MR-33

### 6.1 — SEQUENCING: THE DEPLOY MUST HAPPEN BEFORE THE DATA

**Rewritten 15 September 2026 (MR-34 A2). This was a backlog number. It is a sequencing
constraint, and it has a date.**

> **The constraint, in one line: production must be migrated to `main` BEFORE any reference
> data is loaded into it.**

**Why the ordering is the whole of it.** Production sits at **19 migrations, applied
14 August at `BE-W8`**. The 37 that follow include the tenant boundary. If reference data
arrives first, it lands on a schema with a **known, named, still-open cross-tenant admin
read** — `BE-W76`, whose closure is `20260908000900_organisation_scoping.sql` and
`20260908001300_tenant_boundary_restrictive.sql`, neither of which is on production. Loading
first and migrating second means real organisations' data is mutually readable for the
interval between, and nothing in the schema records that it was.

**And it has a date.** `docs/COMPLETION-PLAN.md:499` puts **`B11` reference data at ~22 Sep**,
with `B12` shift hours the same day. That is **seven days from today**. The deploy is not
"sometime"; it is before that.

**One premise in this item is NOT verifiable from this machine, and the record already says
so.** `COMPLETION-PLAN.md:217` states plainly that *"every production claim in the brief —
`ACTIVE_HEALTHY`, 19 migrations deployed, no reference data, the free-plan pause — is
unverifiable from here."* What `BE-W40` has since verified is the migration count, by reading
`schema_migrations` over the pooler. **Whether production holds reference data today has still
never been checked by anything.**

So the "exposure is zero today" half is an assumption, not a finding:

- **If it is right**, this is a free ordering win and costs nothing but doing it in sequence.
- **If it is wrong** — if anything was loaded during or after `BE-W8` — **the exposure is
  already live**, and this stops being a sequencing item and becomes an incident. Checking
  costs one query and nobody has run it.

### What is undeployed, by name

A number is a backlog item; a list is a decision. Each mapping below was taken from the
migration files themselves, not from the work-item table.

| Work item | What is not on production | Migrations |
| --- | --- | --- |
| **`BE-W76`** — an admin of one organisation reads another's data | the tenancy boundary itself | `20260908000800_user_profiles_organisation.sql`, `20260908000900_organisation_scoping.sql`, `20260908001200_consent_text_versions_tenant.sql`, `20260908001300_tenant_boundary_restrictive.sql` |
| **`BE-W77`** — nothing bounds a consent withdrawal's timestamp | withdrawal bounds | `20260908001000_withdrawal_timestamp_bounds.sql` |
| **`BE-W78`** — consent bounds live in a function callers can skip | the bounds moved into a trigger | `20260908001100_consent_capture_bounds_trigger.sql` |
| **`BE-W79`** — a tenant can break every other tenant's consent capture | consent-text tenancy and precedence | `20260908001200_consent_text_versions_tenant.sql`, `20260911000600_sync_pull_consent_text_versions.sql`, `20260911000700_consent_text_precedence.sql` |
| **`BE-W84`** — `visits` has a direct write grant and no validation trigger | the visits validation trigger | `20260908001400_visits_validation.sql` |
| **`FIX-02` / `FIX-12`** — the offline consent bounds | capture bounds, future tolerance, row identity, nested coordinates | `20260908000200_offline_consent_capture.sql`, `20260908000500_sync_consent_through_capture.sql`, `20260908000700_consent_future_tolerance.sql`, `20260911000200_apply_sync_item_nested_coordinates.sql`, `20260911000400_sync_row_identity_from_payload_id.sql` |
| **MR-28's `DETAIL` threading** | the reason a refusal can be explained to the MR | `20260911000800_sync_verdict_exception_detail.sql`, `20260911000900_ucpmp_cap_names_the_doctor.sql` |
| **MR-28 defect 12** | a check-in starts the visit | `20260911000300_check_in_starts_the_visit.sql` |
| **privilege revocations** | `execute` and sequence grants still open to `public` | `20260907000300_revoke_public_execute.sql`, `20260908000400_revoke_sequence_grants.sql` |
| **the UCPMP cap** | the cap machinery and its 6 November deadline | `20260907000700_ucpmp_sample_caps.sql`, `20260907000900_ucpmp_cap_decision_deadline.sql`, `20260907001000_ucpmp_cap_decision_warning.sql` |
| **the offline sync layer** | `sync_pull` / `sync_push`, phases 1 and 2 | `20260907001100_sync_pull_phase1.sql`, `20260908000300_sync_pull_phase2.sql`, and the nine `sync_*` migrations around them |

**Read the first row again.** The single largest thing not on production is the mechanism that
stops one customer reading another's data, and the deadline for putting customers' data there
is **seven days away**.

**Who does what.** `supabase db push` against production, which is an operator action. **No
engineering session on this machine has production credentials**, and `assertLocalhostOnly()`
exists to keep them off it. **The procedure has now been rehearsed** — MR-34 B applied these
37 to a scratch database standing at production's 19 and verified the result by querying it.
The operator's numbered procedure is `docs/restore-runbook.md` →
*"Applying 37 migrations to a database at 19 — the rehearsed procedure"*.

**Until it is done the drift workflow fails daily**, which is correct and is the point. Do not
silence it. That is deliberate and is **not** the same posture as the backup workflow, which
MR-34 D1 changed for a reason recorded there: this one names an action an operator can take
today, and that one named a decision nobody had made.

### 6.2 — The PITR decision has to be RE-MADE, because both of its premises are absent

**Re-opened as an operator item.** `.ai-collab/decisions.md` records:

> **Decision:** do not buy Point-in-Time Recovery. **Daily backups (included in the Pro
> plan) plus `docs/restore-runbook.md`** is the right posture.

The reasoning is sound and may still be right. **Both things it rests on are missing.**

| Premise | State |
| --- | --- |
| *"Daily backups (included in the Pro plan)"* | **The paid plan is item 5.2 on this list and is unresolved.** Whether any automatic backup exists on the current plan is **not knowable from this machine** — it is a dashboard fact. It has never been confirmed in the record |
| *"plus `docs/restore-runbook.md`"* | **MR-32 executed it.** Step 2 was the single word *"Restore."* with no mechanism behind it — no PITR, no dump script, no off-machine copy. Three of its four commands exited 0 while doing nothing |

**A decision whose justification turns out not to exist is not a decision that survives on its
date.** This is not an argument for buying PITR — it is that the alternative it was weighed
against was never built, so the comparison was never made.

**What is needed from you, and it is two questions rather than one:**

1. **Confirm what plan this project is on and what it actually backs up**, from the Supabase
   dashboard. That is 5.2, and this now depends on it.
2. **Then weigh PITR against the cost of building and maintaining the alternative** — which
   MR-33 B has now built a first version of, so that cost is no longer hypothetical. The
   ~$100/month PITR figure in `docs/backend-prompt-w8.md` is dated **11 August** and is
   flagged there as needing re-verification before anyone spends against it.

**The reasoning that remains true regardless:** a restore on this project is a compliance
event that can un-withdraw a consent, which is why the runbook and
`reconcile-after-restore.mjs` exist. Finer-grained restore points buy more of the thing the
design already defends against. That argument was never the problem; the missing alternative
was.


### 6.3 — `BE-W11`: the backup EXISTS and has nowhere lawful to go

**The mechanism is built and proven (MR-33 B).** `backup:database` produces a plain-SQL dump
of the whole database with a manifest; `backup:verify` restores it into a scratch database and
compares counts **by querying the restored copy**. Proven end to end: 56/56 migrations, 36/36
tables, 36/36 with RLS, 48/48 policies, 1,910/1,910 consent records, 5,447/5,447 auth
identities. Two failure controls ran beside it — a truncated artefact caught by the hash, and
an intact artefact with a wrong count caught only by the query.

**What is missing is a destination, and it is a decision you have to make, not work we can
do.**

`.github/workflows/backup.yml` is scheduled daily and **fails every day on purpose**: it
checks for a `BACKUP_DESTINATION` secret **before producing anything**, so a run with no
destination leaves no artefact anywhere. Keep it red. The daily failure is the only thing
saying the recovery posture does not exist.

**Why this is not an engineering choice.** A dump of this database is not a file, it is a
package of personal data:

| Contains | Why it matters |
| --- | --- |
| `doctors.full_name`, `user_profiles` | named individuals |
| every row of `auth.users` | 5,447 identities on the local stack alone |
| `transcripts_redacted` | redacted, not absent |
| `adverse_event_reports.reported_text` | **open question 4.1** — whether it may lawfully contain patient information has never been answered |
| `consent_records` | the ledger the whole product exists to keep honest |

Somewhere to put that is a **data-processing decision with a DPA dimension**, and the one
person who could sign it off is the same unnamed PV/DPDP signatory as items 4.1 and 4.4.

**The options, with what each costs:**

| Option | Cost | The catch |
| --- | --- | --- |
| **A GitHub Actions artifact** | free, works today, ~90-day retention | Puts the consent ledger and every identity into GitHub's artifact store. Probably acceptable; **nobody has decided**, and it is not ours to decide |
| **A private object store** (S3, GCS, Supabase Storage in another project) | a credential you provision, a few dollars a month | The honest answer. Needs a bucket, a scoped key, and a retention rule on the bucket itself |
| **Supabase's own backups** | included with the **paid plan — item 5.2, still open** | Also the thing the PITR decision assumed existed. **See 6.2**: it has never been confirmed that this project is on a plan that takes any backup at all |
| **Keep it local** | free | **This is what has been recorded as "not yet a backup" three times.** Two git bundles were cut to the same disk as the repository. A copy on the disk you are protecting against is not a copy |

**What we need from you:** name a destination, or confirm that a GitHub artifact is acceptable
for this data. Either answer unblocks it in one commit. Until then the mechanism exists, is
tested, and protects nothing.

**One thing that is already true and worth knowing:** the **repository** is off-machine — it
is on GitHub and `origin/main` is current. The schema is in 56 migration files there. What has
no off-machine copy is the **data**, and the data is the part that cannot be copied without
this decision.

## Escalations — 15 September 2026, MR-34

### 7.1 — RESOLVED 15 September 2026 (MR-35). Two migrations crashed, not one

> **Answered and done.** The edit was authorised, applied, and recorded as a named exception in
> `.ai-collab/constraints.md`. **Nothing is blocked on you here any more** — this entry is kept
> because the reasoning is the record.
>
> **The deciding question turned out to be mechanical:** does the migration ledger verify a
> HASH of each file, or only a NAME? **Only a name.** `schema_migrations` holds `version`,
> `name` and `statements` and **no checksum column**; `check-migration-drift.mjs` reads
> `version` only; `supabase migration list` pairs local and remote by version; and editing an
> applied migration's body then running `db push --dry-run` reports `"upToDate":true`, with a
> positive control (a new file IS reported) proving the check was live. So no database anywhere
> can observe the edit, and constraint 78's purpose is untouched.
>
> **The sweep that followed found a SECOND one.** `20260908001200_consent_text_versions_tenant`
> carries the identical `min(id)` on the identical uuid column, behind its own early return.
> Neither had ever executed anywhere. Both are fixed, both branches of each are now exercised
> by `services/api/tests/organisation-backfill.spec.ts`, and a repo-wide guard fails if the
> shape reappears in any migration.
>
> **What is still on you:** the Phase 0 query at the top of this page. The fix means the
> single-organisation branch now works; it does not tell anyone whether production will take
> that branch, the refusal branch, or neither.

### 7.1 (as originally written) — ASK: a migration in the pending 37 crashes, and the fix has to go in that file

**Found by rehearsing the deploy (MR-34 B), not by reading it.**

`20260908000800_user_profiles_organisation.sql` backfills every user profile's organisation.
For a profile with a territory the organisation is derived. For one without — an admin — the
migration runs this:

```sql
select count(*), min(id) into v_orgs, v_org from public.organisations;
```

**PostgreSQL has no `min` aggregate for `uuid`.** Measured on the local stack,
`server_version` 17.6: the catalogue holds **zero** `min` functions accepting `uuid`. The
branch raises `ERROR: function min(uuid) does not exist (SQLSTATE 42883)`.

| Production's data | The deploy |
| --- | --- |
| no territory-less profiles | clean — **and this is the only path CI has ever run** |
| territory-less profiles, **1** organisation | **crashes.** Not by design |
| territory-less profiles, **>1** organisations | refuses, by design (`MR-06 / BE-W76`) |

Both non-empty branches were executed against seeded databases with the precondition asserted
first. The crash is real, not inferred.

**The migration's own comment claims a test covers this** — *"the single-organisation branch is
exercised only by its test, not by CI's migration run."* **There is no such test.** A backfill
runs once, at migration time, so nothing can re-run it afterwards; the branch has never
executed anywhere.

**Why this is an ask and not a commit.** `.ai-collab/constraints.md:78` lists *"changing what a
migration that has already been applied does"* under **Ask before doing**. This one is applied
locally and in CI, and unapplied on production. The usual remedy — write a new migration —
**does not work here**: the broken migration aborts the deploy before any successor runs, so a
follow-up migration would never execute. The fix has to go in that file or nowhere.

**What we need from you: permission to edit `20260908000800` in place.** The change is one
expression — `min(id)` becomes `(select id from public.organisations order by id limit 1)`.
Databases that already ran it are unaffected, because a migration already recorded in
`schema_migrations` is never re-applied.

**The alternative is cheaper and worse:** run the Phase 0 pre-flight query, and if production
has no territory-less profiles the defect never fires and can be left alone. That is a bet on
a fact nobody has checked, on a schema nobody has looked at, seven days before reference data
is due.

### 7.2 — The storage gap, promoted from a caveat to an item

**The recovery posture covers the ledger and not the objects, and the 90-day promise is about
the objects.**

A database restore brings back **rows**, including every row of `storage.objects`. It does not
move a single audio file. A restored database therefore references audio that does not exist,
and the mismatch is silent: `storage.objects` is metadata, so nothing in the database can tell
you the bytes are gone.

**And then the purge walks those rows.** `purge-expired-audio.mjs` deletes audio whose
retention has expired. Against a restored database, every one of those deletes hits an object
that is already absent — which is the branch this project got wrong once already:

> `services/api/scripts/storage.mjs:12` — Supabase answers a missing object with
> `{"statusCode":"404", ...}` **in the body, over HTTP 400**. `purge-expired-audio.mjs:40`
> records that the check used to be `response.ok || response.status === 404`, so
> *"somebody already removed it"* was being treated as a failure.

It is fixed now (`isMissing()` reads the body). **But it was wrong for as long as it existed,
and nothing found it by running, because the case never arose.** A restore is the event that
sends every purge down that branch at once — the first real exercise of a code path that has
only ever been exercised by its own unit test.

**What is actually promised.** Item 5.11 and question 4.4 are about whether a deleted storage
object is really gone within 90 days. That promise is about the objects. **The mechanism this
project has built — MR-33's `BE-W11` — backs up the database.** There is no backup of the
audio at all, and a restore cannot produce one.

**Registering, not building.** The decision this waits on is 6.3, the backup destination: the
same answer governs whether the objects can be copied anywhere, and object storage is far
larger and far more sensitive than a SQL dump.

### 7.3 — QUESTION, with a recipient: the platform unknowns

**To: Supabase support, or whoever owns the Supabase account.** None of this is discoverable
from a scratch database, and all of it is discoverable by asking. It is one email.

Every one of these is currently written down as *"unobserved"* in `docs/restore-runbook.md`,
and each has a decision hanging off it:

1. **How long does a restore of this project actually take?** The runbook has a measured floor
   for the local path — MR-33 B5, 4 seconds to verify a 17.6 MB artefact — and nothing at all
   for the platform's own restore. An operator reading the runbook today cannot tell whether
   the recovery window is minutes or hours, which is the first thing anyone asks during an
   incident.
2. **Does a restore need a support ticket, or can it be self-served from the dashboard?** If it
   needs a ticket, the recovery time includes their response time and the runbook's step 2 is
   wrong about who performs it.
3. **What does a restore do to roles, extensions, and `supabase_admin`-owned settings?** The
   local drill restored a database this project's migrations created. A platform restore
   touches things migrations never owned. `ci.yml:135` already records a `db push` failing with
   *"permission denied to set parameter"*, so the privilege boundary here is known to be real
   and is not mapped.
4. **What plan is this project on and what does it back up?** This is item 5.2, and **6.2
   depends on it** — the PITR decision cannot be re-made until it is answered.
5. **Does deleting a storage object really remove it within 90 days** — no S3 versioning, no
   soft-delete window? That is question 4.4 and item 5.11, unanswered since week 1, and 7.2
   above turns on it.

**Why ask rather than test.** Every one of these is a property of the platform's
implementation and contract. A scratch database on this machine cannot observe any of them,
and an experiment against production would be the incident it is meant to prepare for.
