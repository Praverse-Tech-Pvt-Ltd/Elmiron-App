# Blocked on you — 14 August 2026
> # ✅ RESOLVED — `BE-W101` IS CLOSED (MR-42, 17 September 2026)
>
> **Nothing is asked of you here any more. This section is kept for the record.**
>
> The cross-tenant admin escape is removed from all eight `SECURITY DEFINER` bodies by
> `20260917000100_close_the_admin_escape.sql`. Every site was re-measured after the fix with
> three controls — an admin of another tenant **BLOCKED**, the owning organisation's own admin
> still **SEES** (so tenant administration did not lose access), and a non-admin in the
> attacker's tenant **BLOCKED**.
>
> **It never needed a decision from you.** `.ai-collab/decisions.md` **C1**, transcribed
> 9 September 2026, had already settled that `admin` is a TENANT administrator and that
> platform access is a separate audited break-glass path, out of MR v1. Two sessions waited on
> an answer that was already in the repository — which is why the register row now carries the
> pointer.
>
> Regression is held in two places: a build-time assertion over the whole catalogue in
> `admin-escape.spec.ts`, and the migration's own postcondition guard at deploy time.
>
> ---
>
> **What follows is the finding as it stood, 16 September 2026 (MR-40 A3).**
>
> **What was proven.** An admin of organisation A, calling the ordinary console read paths, gets
> organisation B's consent records:
>
> | Probe | Result |
> | --- | --- |
> | `list_consent_records()` as admin of A, with a consent record belonging to B | **B's record is in the page** |
> | `read_consent_record(B's id)` as admin of A | **returns the row — all 14 columns** |
> | *Positive control:* the same record read by **B's own admin** | appears, as it should — so the target was reachable and the function does return data |
>
> The control matters: without it, an absence or a presence proves nothing. The rival record was
> created, it was readable by its owner, and it was **also** readable by a stranger.
>
> ### Why nothing caught this
>
> ```sql
> where (v_role = 'admin' or c.captured_by_mr_id in (select public.visible_user_ids()))
> ```
>
> The `or` **short-circuits before the scoped half is evaluated**. `BE-W76` scoped two things —
> `visible_user_ids()` itself, and the six `*_admin_all` RLS policies. **A function body that
> bypasses `visible_user_ids()` entirely is covered by neither.** And because these functions are
> `SECURITY DEFINER`, no policy runs behind them to catch it: `consent_records` is one of the nine
> tables with RLS **forced and no policy at all**, so the function body *is* the boundary.
>
> `FIX-04`'s matrix did test this function — **before `BE-W76`**, when an admin's emptiness came
> from territory scoping incidentally rather than from a tenant boundary deliberately. **A test
> that passed for a reason since removed is not a test that still passes.**
>
> ### What is and is not exposed today
>
> - **This is in the FIRST 19 migrations** (`20260811000300`, `20260811000400`), so **production
>   is running this code.**
> - **Production has no second tenant to cross into.** `user_profiles.organisation_id` arrives in
>   the pending 37, so there is exactly one organisation there and nothing to leak between.
> - **Therefore the defect becomes live at the moment reference data and a second tenant arrive —
>   which `§6.1` dates at ~22 September.** It is scheduled to start mattering on the same day the
>   sequencing item below is.
> - **A cross-tenant read IS recorded.** These reads succeed, and the function writes its audit
>   row *before* returning — so the trail names the admin, the time and the reason they gave.
>   That is the one mitigating fact and it is worth having: the exposure is a confidentiality
>   failure, not an invisible one.
>
> ### ALL EIGHT SITES ARE PROVEN OPEN — MR-41 A3, 17 September 2026
>
> MR-40 located eight bodies carrying the construct and proved two of them. **MR-41 measured the
> other six. Every one is open, including all three WRITES.**
>
> Located from the **catalogue** — `pg_get_functiondef` over `pg_proc where prosecdef` — rather
> than from grep, because grep locates and does not decide. That query returns exactly these
> eight, plus `visible_user_ids` and `visible_territory_ids`, where the same branch is the
> scoping itself and is tenant-bounded by `BE-W76`.
>
> | Function | Kind | Verdict | What was measured |
> | --- | --- | --- | --- |
> | `list_consent_records` | read | **PROVEN OPEN** | A's admin finds B's consent record in the page |
> | `read_consent_record` | read | **PROVEN OPEN** | returns B's row by id |
> | `read_analysis` | read | **PROVEN OPEN** | returns another organisation's analysis |
> | `list_analyses` | read | **PROVEN OPEN** | lists another organisation's MR's analyses |
> | `list_analysis_overrides` | read | **PROVEN OPEN** | returns another organisation's override |
> | `approve_call_report` | **WRITE** | **PROVEN OPEN** | **accepted** another organisation's call report |
> | `create_analysis_override` | **WRITE** | **PROVEN OPEN** | **accepted** against another organisation's analysis |
> | `reinstate_sync_item` | **WRITE** | **PROVEN OPEN** | **accepted** a dead-lettered item belonging to another organisation |
>
> **Every probe is two-sided, and that is what makes it a measurement.**
>
> - **Positive control** — the same target read by someone entitled to it (the owning admin, or
>   the analysis's own MR) appears. The row existed and the function does return data.
> - **Negative control** — the same call, same target, by a **non-admin in the attacker's own
>   tenant** is refused: *"only a field_manager or admin may decide a call report"*, and the
>   consent list comes back **without** the rival row. The probe can say *no*.
>
> So the boundary that fails is specifically the `v_role = 'admin'` branch. It is not the query,
> not the fixture and not the harness.
>
> **The three writes were measured inside transactions that were rolled back**, so nothing was
> persisted. An admin of one company can **approve another company's call report**, override its
> analysis, and reinstate its rejected sync item. A cross-tenant read is a confidentiality
> failure; these are integrity failures.
>
> ### What we need from you
>
> **This was not fixed in this session, deliberately.** It is a compliance-boundary change across
> eight functions, the three write paths are now measured (MR-41) and all three are open, and the
> right fix is a decision rather than a patch: **does an admin have any legitimate cross-tenant
> read at all?** If the answer is no — and `MR-06`'s ratified position is that an admin is a
> *tenant* administrator, with platform access a separate audited break-glass path that is out of
> v1 scope — then the `or v_role = 'admin'` escape should simply be deleted from all eight, and
> the console's screens re-tested against the boundary.
>
> **What is safe to say now:** nothing needs doing before ~22 September, and everything needs
> doing before it. Two tests in `services/api/tests/admin-escape.spec.ts` state the correct
> property and are marked as not currently holding, so **the moment somebody closes the escape
> they turn red and force a deliberate update** rather than passing silently.


> # ✅ RESOLVED 22 September 2026 — THE QUESTION THE 30 SEPTEMBER DATE WAS ASKING
>
> **Answered by the operator: the AI layer is KEPT (`C7`), and the audio's purpose is *"recordings
> and voice notes are kept so the AI layer can support proper review and monitor that SOPs are
> followed"* (`C8`).** Both in `.ai-collab/decisions.md`. What that purpose requires before any real
> recording — consent text, the reps' notice, the signatory — is listed under `C8`. The text below is
> kept as the record of the question.
>
> ## Does the MR app record audio at all, if there is no AI layer?
>
> **This is above the deadline below because it is the larger question, and the deadline is
> only what forces it.** The 30 September date is about a *schema*. This is about whether the
> single largest and most compliance-heavy subsystem in the product should exist.
>
> **Nobody has ever asked it.** It is not in `mr-app-plan.md`, it is not a work item, and it is
> not on this page until now.
>
> ### What is true today, verified rather than assumed
>
> **Nothing in MR v1 consumes a recording.** Not one thing. This is not an inference from the
> roadmap — the code says so, deliberately, in two places:
>
> - `apps/field/app/analysis/[id].tsx` — *"**No citation gets a play control.** … A play button
>   that did nothing would tell the MR a recording was ever made."*
> - `apps/field/src/coaching/content.ts` — *"Why no quote can be played, and it is not hidden …
>   **There is nothing to play here.**"*
>
> The console does not read audio either; its admin screen only *describes* retention. So the
> complete list of things that touch a recording is: **the code that uploads it, and the code
> that deletes it.** An MR cannot play back their own voice note. Nobody can.
>
> ### The three consequences, stated plainly
>
> **1. A voice note nobody can read is a file.** It is captured with consent, stored encrypted,
> counted against a storage ceiling, carried through a retention schedule, reconciled after a
> restore — and never once opened. Every one of those mechanisms is real engineering that
> exists to protect a payload no reader has.
>
> **2. The corpus justification is circular, and this is the part worth reading twice.** The
> recorded reason to collect this audio is that off-the-shelf ASR fails on Hinglish —
> `docs/mr-app-plan.md` measures it: *"Whisper large-v2 zero-shot … **52.0% Mixed Error Rate**"*
> on code-switched Hindi-English, dropping roughly half the words at exactly the moments that
> matter. The conclusion drawn was that a fine-tuned model is needed, which needs a corpus,
> which is why the app records.
>
> **But the model is the AI layer.** If the AI layer is cut, the corpus has no consumer — and
> the corpus was the reason to record. *We record in order to train the model that justifies
> recording.* Cut the model and the loop does not have an exit; it has a gap where the purpose
> used to be.
>
> **3. Under DPDP, the purpose is the weak part — not the consent, and not the security.** The
> consent flow is built, the ledger is append-only, the audio is encrypted, purged on schedule
> and the purge is itself logged. **None of that is the exposure.** DPDP asks what the personal
> data is *for*. Today the answer is "transcription and coaching". Cut that and the honest
> answer becomes "we are keeping it in case we build something that reads it" — which is a
> purpose a signatory has to affirmatively accept, in writing, knowing that is what they are
> accepting.
>
> ### What we need from you
>
> **Answer this before, or at the same time as, the 30 September decision — not after.** They
> are the same decision wearing two sizes, and answering the small one first means the large one
> gets made by default.
>
> - **If audio survives a cut**, say what for. That sentence becomes the DPDP purpose, and the
>   retention machinery, the storage ceiling and the 90-day promise all keep their reason to
>   exist.
> - **If it does not**, the removal is large and it is clean: `recordings`, `voice_notes`,
>   `upload_grants`, the resumable upload machinery, the retention worker and its watchdog, the
>   storage ceiling, and the restore runbook's entire step-3 reconciliation. `docs/COMPLETION-PLAN.md`
>   → *"what a cut AI layer costs"* lists it.
>
> **Engineering has no view on which answer is right, and cannot have one.** What it can say is
> that the question exists, that it has never been asked, and that a date two weeks away is
> about to answer it by accident.


> # 📅 TWO DATED DEADLINES — the 30 September one is RESOLVED (`C7`, MR-50 B); 6 November is still open
>
> **Both break CI on a fixed date. Neither is an engineering task. Both are yours.**
>
> | Date | What breaks | Days left as of 16 Sep 2026 |
> | --- | --- | --- |
> | ~~**30 September 2026, 23:59 IST**~~ | ~~`CONTRACT_I3_DEADLINE`~~ — **RESOLVED 22 Sep: AI layer kept (`C7`); the test now checks the real `TranscriptV1` contract, not a date (MR-50 B)** | — |
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
> | all three are `0` | §6.1 is a **sequencing item**. Deploy the 41 pending migrations before any reference data is loaded, and the whole problem goes away. The deploy takes seconds |
> | `territory_less > 0` or `consent_notices > 0` | The two backfills in the pending batch will **execute** rather than no-op. They are fixed as of MR-35, but they have still never run anywhere. Read `docs/restore-runbook.md` → Phase 0 before pushing |
> | **anything is non-zero AND real customer data is present** | **§6.1 IS AN INCIDENT, NOT A SEQUENCING ITEM.** Production is **41** migrations behind (19 of 60 applied, measured by the drift run on 17 September), which means it has **no tenant boundary** — `BE-W76`. One organisation's admin can read another's data, and that is true right now, not at some future date |
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
| ~~1.1~~ | **DONE — stale alarm, cleared MR-43 A6.** Pushing works and has worked every session; this page said *"5 commits unpushed, CI has never run on any frontend code"*. CI runs on every push and `@fieldforce/field` has 502 vitest + 131 jest tests green | — | Kept struck through rather than deleted: the gotchas entry about `credential.helper=manager` is still true and still useful |
| ~~1.2~~ | **DONE — stale alarm, cleared MR-43 A6.** Write access exists; every session since has pushed to `main` | — | The distinction it drew — re-authentication cannot fix a permissions problem — is still the right first question if a 403 ever returns |
| 1.3 | `eas login` — an Expo account | **Any APK build at all** | Free tier: 15 Android builds/month, 90+ min queue at peak |
| 1.4 | Elevated PowerShell:<br>`New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force` | Metro and Gradle deep paths | `git config --global core.longpaths` is already set; this is the other half and needs admin |
| ~~1.5~~ | **→ see 5.1.** Reconciled MR-44 A2; 5.1 names the four OEMs and why a Pixel proves nothing. *(was: A physical Android device)* | **FE-G1** | Get a Xiaomi, Oppo, Vivo or Realme — not a Pixel. Those ROMs kill background processes aggressively, hold large Indian market share, and background location dying silently is the most likely field failure on this product. It will not reproduce on an emulator. |
| 1.6 | **Add `com.praversetech.fieldforce://auth-callback` to the HOSTED project's redirect allow-list** — Authentication → URL Configuration → Redirect URLs | Deep-link sign-in on any build pointed at the hosted project | **Filed MR-43 A5.** It was hiding inside a decision entry: `O2`'s "Outstanding" line, which named a scheme (`praversefieldforce://`) that `FE-R1a` had already superseded, and claimed work that is in fact **done locally** — `config.toml` has the reverse-DNS entry. A dashboard action is not a backend code change, and a task does not belong inside a permanent decision record |

---

## 2. Decisions — cheap now, permanent later

| # | Decision | Deadline | Why it can't wait |
|---|---|---|---|
| 2.1 | **Whose Play Console account ships this — yours or the client's?** | Before FE-W8 | Decides package ID, listing ownership, keystore custody, and what happens if the relationship ends |
| ~~2.2~~ | **DECIDED AND EXECUTED — `O2`, 17 August 2026. Cleared MR-43 A3/A6.** This row said *"Currently the placeholder `com.praversetech.elmironmr`"*. It is not: `app.json` holds `com.praversetech.fieldforce`, the scheme is the reverse-DNS form, and the string `elmironmr` appears **nowhere** in code or config | — | **The decision was in `.ai-collab/decisions.md` the whole time** — *"O2 — the name in permanent identifiers: EXECUTED, commit `f34ceef`"*. That is the same `f34ceef` this repository's checkout guard has asserted as an ancestor in every session. The trademark reasoning (ELMIRON® is a third party's mark) is kept there in full |
| 2.3 | **Keystore custody** — EAS holds it, or enrol in Play App Signing | Before first Play upload | If access to the Expo account is ever lost, you cannot update an app already on the Play Store. No recovery path. *[Verify Play App Signing against current Play Console docs.]* |
| 2.5 | **RESOLVED 22 Sep 2026 — yes, a dev-only test renderer (`C10`, `.ai-collab/decisions.md`); built in MR-50 F.**  **Does `apps/console` get a RENDERER, and therefore a third test runner?** | **`FE-W12`**, and every console screen after it | **Filed MR-44 D2, and the ask is made BEFORE the work rather than mid-build.** The console's pages are React Server Components and `vitest.config.ts` says exercising them *"needs a browser or a Next test harness, and neither exists yet"*. `FE-W12`'s recorded check — *"a console test asserts a previously-saved override renders"* — cannot be met without one. **Playwright against `next dev`** is the only option that exercises what actually ships; it costs a dev dependency **plus browser binaries**, CI minutes, and a **third runner** beside vitest and jest. `react-dom/server` in vitest avoids the runner but only partly supports async server components, so it would assert a rendering path users do not get. **Engineering recommends neither: keep the presenter + source-check pattern `FE-W13` shipped with in MR-41, and REWRITE `FE-W12`'s check.** That is a decision rather than a workaround, because it changes what `FE-W12` promises — which is why it is on this page |
| 2.6 | **What should the MR's privacy notice say about check-ins and location?** | **`FE-W52`** — a compliance record: the transparency screen every MR reads | **Filed MR-45. The notice currently UNDERSTATES what the app records.** It tells MRs that check-in/check-out times and their location are *"Not yet — this app cannot do this today"*. Both ARE recorded: check-ins go to Supabase through `sync_push` with coordinates. **It is not a one-line flip**, because the location row promises tracking *"Start day to End day"* while the app records position only AT check-in — so "yes" would overstate in the other direction. Engineering can make each row derive from whether its write path is live, so it cannot drift again; **the sentence the MR reads is yours to approve.** Until then, every MR is being told something false about their own data |
| 2.7 | **Should configuration belong to an ORGANISATION, and may an MR call system-health functions?** | **`BE-W106`** | **Filed MR-45, with one half proven.** `app_thresholds` has only `global` and `territory` scope — **no organisation scope** — so every "org default" is one row shared by every tenant, and `threshold()` hands any caller the value for any territory they name. Measured: an MR of one company read another company's territory setting (`42`), with a positive control from the owning company and a negative control from the attacker's own territory. `audio_purge_health()` also returns every company's recording counts to any MR. **Configuration and counts, not personal data** — lower severity than `BE-W101` — but the same class of defect, and the fix depends on a model decision engineering should not make alone **MR-51 C1 adds (22 September 2026):** the table itself is readable over the API with no function call — `app_thresholds_select_authenticated` is `using (true)` — and a row carries `set_by_user_id`, the id of a user in the other company. An MR and an admin of one organisation both read the other's territory row. Left open by your choice (`C13`). **MR-52 D (23 September 2026): the direct read is now REVOKED** — the table is not readable by any signed-in user, so the cross-tenant read and the exposed user id are gone. **The model question below is all that remains, and it now expires on a date: `2026-10-31`, proposed for you to confirm**, matching the production drift acceptance; after it, `check:decision-debt` fails CI. Answering it is what clears it — organisation scoping on `app_thresholds`, as a column or a `scope` value |
| ~~2.4~~ | **→ see 5.3**, which is broader: it carries the alternative resolution, shipping foreground-only check-in. Reconciled MR-44 A2. *(was: Transistorsoft release licence)* | Before FE-W8, but check now | Believed required for Android release builds, free for debug. Unverified — check transistorsoft.com. A purchase order takes longer than a sprint. |

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
| 4.1 | **PV and privacy sign-off.** Two specific questions: may `adverse_event_reports.reported_text` contain patient information, and does an adverse-event report survive a consent withdrawal? | Sprint 1 | Both are currently answered by a **default, not a decision**, and both are now baked into a deployed production schema. A different answer is a migration against live tables. **MR-43 A3 — the pointer this row was missing.** Both questions already have recorded ENGINEERING answers in `.ai-collab/decisions.md` (BE-W7, 16 August 2026): *"`reported_text` kept on the adverse-event record — Decision: keep it, and flag it hard"*, and *"An adverse-event report survives a consent withdrawal — Decision: it survives"*, the second explicitly labelled **"This is a default, not a ruling"**. So **no engineering work is waiting on this** — the schema is built and documented. What is waiting is the sign-off that turns two defaults into rulings. |
| 4.2 | **PARTLY RESOLVED 22 Sep: ship-or-cut answered — KEEP (`C7`). Still open: the vendor choice and measured Hinglish error rate, which need labelled audio (MR-50 B4).**  **Contract I3 — STT vendor decision and measured Hinglish WER on real audio** | Sprint 2 | The entire AI layer. **CI goes red on 30 September** unless `TranscriptV1` exists. If the answer comes back bad, the pipeline is cut — so every week of delay is a week of risk that work gets built and deleted. |
| ~~4.3~~ | **→ see 5.7**, which is broader: it includes the reference data §6.1 is sequenced around. Reconciled MR-44 A2. *(was: Per-territory working hours from the client)* | Sprint 3 | Capture refuses without them. The org-default window expires 60 days after being configured, then refuses again — by design. |
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
| ~~5.11~~ | **→ see 4.4**, which states the actual question rather than the topic. Reconciled MR-44 A2 — the one pair where sections 1–4 hold the better row. *(was: The Supabase storage-deletion DPA question)* | Operator | **Sprint 7** | Whether the 90-day retention claim is literally true. **Drafted since sprint seven and never sent.** Not answerable from the API |
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

> **Superseded in part by `C12` (operator's D-9, recorded MR-51, 22 September 2026):** final testing
> happens on a physical handset **with the AI integration**. So a phone is no longer the only thing
> between the app and these gates — **both close only on a handset run made after the AI integration
> exists.** Emulator results are engineering evidence, never the gate.

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

---

## Reconciled 17 September 2026 (MR-44 A2) — one id per ask

**Section 5 transcribed the review conversation without reconciling it against sections 1–4.**
That is where the duplicates came from, and the human-facing count has been inflated by them for
weeks: **31 numbered items, 27 distinct asks.**

**The canonical id is whichever row states the ask most COMPLETELY — not whichever came first,
and not uniformly section 5.** Two of these four are not duplicates at all: they are a subset and
a superset, and collapsing them onto the smaller row would have lost half an ask.

| Canonical | Pointer | Why that one is canonical |
| --- | --- | --- |
| **5.1** | ~~1.5~~ → see 5.1 | Same ask. 5.1 names the four OEMs and says why a Pixel proves nothing; 1.5 says *"A physical Android device"* |
| **5.3** | ~~2.4~~ → see 5.3 | **Superset.** 5.3 is *"Transistorsoft licence, **or a decision to ship foreground-only check-in**"* — it carries an alternative resolution that 2.4 does not |
| **5.7** | ~~4.3~~ → see 5.7 | **Superset.** 5.7 is *"**Reference data** and per-territory shift hours"*; 4.3 is the shift hours alone |
| **4.4** | ~~5.11~~ → see 4.4 | **The other direction.** 4.4 states the actual question — *"does a deleted storage object survive in S3 versioning, a soft-delete window, or a sub-processor's backup?"* — where 5.11 only names the topic |

**The correction this makes to MR-43's own write-up:** it called all four *"the same ask under two
ids"*. Two of them were not. **Had the reconciliation followed that summary instead of re-reading
the rows, `5.3`'s foreground-only alternative and `5.7`'s reference-data half would have been
deleted as redundant** — and reference data is the thing `§6.1` is sequenced around.

**The count stands at 27 distinct asks**, and the four pointer rows are struck through in place
rather than deleted, so an old link still lands somewhere that explains itself.

## A3 — a decision record must not carry a to-do list

**`O2` was right for a month and its "Outstanding" line was wrong for most of it.** The line said
backend must add `praversefieldforce://auth-callback` to `additional_redirect_urls`. The scheme
had been superseded by `FE-R1a`; the reverse-DNS entry was already in `config.toml`. **Two
separate rots, in a sentence sitting inside the most authoritative artefact in the repository.**

**The rule: what was DECIDED is durable. What REMAINS is status, and status rots fastest exactly
where it is least questioned.** A decision record is read as settled — that is its whole function
— so a task note inside one inherits an authority it has not earned and is the last thing anybody
re-checks.

**Where each belongs:**

| Kind | Home |
| --- | --- |
| the ruling and its reasoning | `.ai-collab/decisions.md` — permanent, append-only in practice |
| a task for a human | `docs/blocked-on-you.md`, numbered |
| a task for engineering | `docs/COMPLETION-PLAN.md`, with a recorded check |

**This is the third instance of one shape, and naming it is the point:**

- **`blocked-on-you.md`** led with a red banner for a defect fixed in MR-42.
- **The drift workflow** was red on every commit for a state everybody already knew.
- **`O2`** carried a to-do that had been done and renamed.

**All three were correct when written, none was re-evaluated when the world moved, and each sat in
a place whose authority discouraged checking.** A stale alarm and a stale to-do are the same
defect as a permanent red in CI — only the last one had a workflow run to make it visible.

## MR-46 — 21 September 2026: 2.6 and 2.7, with what you need to decide them

### 2.6 — every MR who has used the app was shown a false privacy notice

**A fact for the operator and the signatory, not a finding to schedule.** Every MR who has opened
the transparency screen — it is the last step of first run, and reachable from Today at any time —
was told:

- *"Right now this app records nothing new about you."* It records check-ins and check-outs with
  coordinates, distance from the clinic and inside/outside the geofence; call reports; and samples.
- that where they are and when they checked in were *"Not yet — this app cannot do this today"*.
  Both have been recorded since MR-18.

**It is still live.** The corrected wording is ready and tested on branch
`mr-46/fe-w52-notice-pending-approval` and has **not** been merged, because the sentence the MR
reads is yours to approve. **Approve it (or edit it) and it ships in one merge.** Draft:

| Row | Draft wording | Why this and not something stronger |
| --- | --- | --- |
| Preamble | *This app records your work visits: when you check in and check out, where you were at those two moments, and what you report. It does not follow you between visits. Each item is below.* | |
| Location | *Where you are — only when you check in or check out.* Your position at the moment you press check-in and check-out, and how far that is from the clinic. Nothing between visits, and nothing in the background. | The old row promised "Start day to End day", which overstates the other way |
| Visits | *Which doctors you saw, and when.* Check-in and check-out times, and whether you were inside the clinic's area. | The geofence result is stored on every check-in and check-out row |
| Reports | *Your call reports.* What you write after a visit. Your manager can read them. | No retention period: nothing deletes reports |
| Samples | *Samples and inputs you give.* The item, the quantity, its value, the doctor and the time. | Not mentioned at all before |
| Voice notes | *Your voice notes.* Recorded and kept on this phone. Not sent to anyone in this build. | "Kept 90 days" held for server audio only; these never reach the server |
| Recordings | *Recordings — only if a doctor agrees.* Made only after the doctor's consent is recorded, and kept on this phone. Not sent to anyone in this build. If they say no, nothing happens to you. | |
| Never | *Your personal calls, messages, other apps or camera. Where you are between visits.* | "Anything at all once your shift ends" was false: reports and samples are accepted at any hour |

**Two things the wording cannot fix, for you to know before approving:** (1) nothing deletes
audio from the phone, including a recording the doctor declined — `FE-W53`; (2) whether a retention
period should be promised for reports is a policy choice, and the draft promises none.

### 2.7 — the settings, measured, as input to the model decision

**Engineering has not decided the model.** What MR-46 measured:

- **Nobody but the database owner can write a setting.** A tenant admin is refused INSERT, UPDATE
  and DELETE on `app_thresholds`, as is an MR (both `permission denied`; the admin CAN read the row,
  so the refusal is about writing; the owner's insert of the same row succeeds, so the row is
  valid). No function writes the table. **So there is no cross-tenant integrity breach**, and the
  question is only who should see and set what.
- **`audio_purge_health()` is fixed** (no decision needed): revoked from every signed-in role.

Every setting in the table. **"Kind" is engineering's reading, offered as input — it is the part
you are deciding.**

| Setting | Read by | Kind (proposed) | Written by, today |
| --- | --- | --- | --- |
| `consent_future_tolerance_seconds` | `capture_consent`, `validate_consent_capture`, `validate_consent_withdrawal`, `validate_visit` | product-wide integrity bound | owner (migration) only |
| `consent_max_sync_lag_hours` | `capture_consent`, `validate_consent_capture`, `validate_consent_withdrawal` | product-wide integrity bound | owner only |
| `ucpmp_sample_cap_quantity` | `enforce_ucpmp_sample_cap`, `sample_cap_status`, `ucpmp_cap_decision_status`; `check-decision-debt.mjs`; `packages/core` `entities.ts` | **statutory** (UCPMP) — the same for every company, if the code sets one | owner only |
| `ucpmp_sample_cap_decision_due` | `ucpmp_cap_decision_status`; `check-decision-debt.mjs` | product-wide (our own decision deadline) | owner only |
| `org_default_shift_window` | `is_within_shift`, `resolve_shift_window`, `org_default_shift_window_status`, `team_exceptions`, `validate_app_threshold`; `seed-reference-data.mjs` | **per-company choice** — its name says so, and today it is one global row, currently `null` | owner only |
| `consent_deviation` | `team_exceptions` | per-company choice (manager alert tuning) | owner only |
| `consent_min_captures` | `team_exceptions` | per-company choice | owner only |
| `consent_min_team_size` | `team_exceptions` | per-company choice | owner only |
| `rejection_min_items` | `team_exceptions` | per-company choice | owner only |
| `rejection_rate_threshold` | `team_exceptions` | per-company choice | owner only |
| `sync_stale_hours` | `team_exceptions` | per-company choice | owner only |
| `audio_storage_ceiling_bytes` | `begin_upload` | product-wide (capacity) — or per-company if storage is billed per company | owner only |
| `purge_batch_limit` | `audio_purge_is_stalled`; `purge-expired-audio.mjs` | product-wide (operations) | owner only |
| `purge_backlog_multiplier` | `audio_purge_is_stalled` | product-wide (operations) | owner only |
| `purge_max_silence_hours` | `audio_purge_is_stalled` | product-wide (operations) | owner only |

"Read by" is the functions whose definitions name the key, and the files that do; a key built at
runtime from parts would not appear. **Grep located these; it did not decide them.**

**The shape of the decision, as measured:** seven settings are plausibly per-company and all seven
are today one row shared by every company; the rest are the same for everyone by nature. Nobody can
currently change any of them without a migration.

## MR-47 — 21 September 2026: the audio on the phone, and the notice still waiting

### 2.6 — the false notice is STILL LIVE (21 September 2026)

No approved wording has been recorded. **Every MR who opens the transparency screen is still told
the app records nothing new about them.** The draft on `mr-46/fe-w52-notice-pending-approval` was
**corrected by MR-47** before approval — read this version, not MR-46's:

- **Recordings — only if a doctor agrees** is now `not-yet` ("this app cannot do this today"). MR-46
  had marked it active from code; on the Pixel 10 a consultation recording cannot be started at
  all, before or after the doctor agrees.
- **Your voice notes** now says *"Recorded and kept on this phone, including a note you start
  again."* Measured: a discarded note stays in the app's storage.

### The audio question — what is actually on the phone, and the two options

**Measured on the Pixel 10 (`FE-W53`, corrected):**

- **No consultation audio can exist.** The record control never appears — after a decline, and
  after a consent, both captured on the phone and both stored on the server.
- **Voice notes do exist**, in the app's private cache: `cache/Audio/recording-<uuid>.m4a`,
  about 55 KB for 4 seconds. The file is written while the MR records, **before** "Save".
- **Nothing deletes them.** "Start again" leaves the file. A force-stop and relaunch leaves it.
  **Signing out leaves it** — the next person to sign in on that phone inherits it. They go only
  when the app's data is cleared, the app is uninstalled, or Android clears the cache under storage
  pressure (the last is Android's decision, not the app's; its timing is not something this app
  controls or can promise).
- **"Save this note" does nothing from a real visit** (`FE-W54`) — the screen still reads the visit
  from the mock — so in practice every voice note is a kept-but-unsaved file.

**The options, as asked. Neither adds `expo-file-system` in this session.**

| | (a) Voice-note recording off, behind a flag | (b) Recording stays; discarded audio deleted |
| --- | --- | --- |
| What changes | A build flag hides "Record a voice note" and the route refuses to record. Consultation recording is already unreachable | Add `expo-file-system` (a native module — needs a new app binary, not an over-the-air update). Delete the file on "Start again", on leaving without saving, and sweep `cache/Audio` for orphans at launch. Fix `FE-W54` first, or every note is effectively discarded |
| Cost | ~0.5 half-day with tests and a device check. No dependency | Dependency approval, ~1.5–2 half-days, a rebuilt binary, and a device check of every path above |
| Files already on phones | **Stay.** Removing them needs a file API — which is option (b)'s dependency | Removed by the launch sweep |
| Saved notes | None can be made | Still kept indefinitely: there is no upload client, so a saved note has nowhere to go |
| **The notice** | Voice notes → `not-yet`. Recordings stay `not-yet`. **But** if any phone already holds notes, "not recorded" is false for it — the row needs a clause such as *"notes recorded before [date] may still be on this phone"* | Voice notes stay `active`: *"Kept on this phone until they can be sent; a note you start again is deleted. Not sent to anyone in this build."* No retention period can be promised for kept notes |

**Recommendation:** (a) now, because it removes a live privacy gap for the cost of a flag, and (b)
only when the upload client exists — deletion without upload still leaves every saved note on the
phone for ever.

### Before deploying MR-47's migration: configure shift hours

`coverage()` no longer hard-codes India time. For an MR whose territory has **no configured
hours**, the manager's report now counts days in **UTC** and labels them `fallback_utc` — the same
answer the MR's own screen already gives. **`org_default_shift_window` is null locally, and the record
(`territory-day.ts`, this file) says production has no hours configured — not measured by MR-47**,
so on deploy every MR's report would move visits finished between 00:00 and
05:30 IST to the previous day. **Setting `org_default_shift_window` (or per-territory hours) to
India time first makes the change invisible for Indian territories.** Production is still at 19 of
64 migrations, accepted until 31 October, so nothing reaches it until that deploy.

## MR-48 — 21 September 2026

### Voice notes — option (a) or (b) — ✅ RESOLVED 22 Sep 2026: option (b), kept (`C9`)

No approval of either option is recorded, so voice notes were **not** switched off. What MR-48
measured narrows the severity:

- **A different rep signing in on the same phone does NOT see the previous rep's voice notes.**
  On the Pixel 10, after sign-out and sign-in as a second rep, the queue read *"Everything is
  sent"* and the voice-note screen opened at 00:00. The two files were still in `cache/Audio`.
  **They are on disk, not shown.** Reaching them needs device-level access to the app's private
  storage — here, `run-as` on a debug build.
- **The previous rep's whole pulled list stays on the phone too** — visits, doctors, plans — under
  their own user key, likewise not shown to the next rep.

### FE-W55 — "say what the server says" needs a choice

The visit screen tells the MR to ask a doctor who has already answered, because the app holds no
consent records. The only way a rep can read the server's answer is `list_consent_records()`,
which writes an **audit row on every read**. MR-12 Q4 kept consent out of the pull for exactly that
audit volume. The options:

| | What the screen gets | Cost |
| --- | --- | --- |
| An audited read when a visit screen opens | The server's answer, always | One `audit_log` row per visit-screen open — the load Q4 avoided, smaller (per open, not per sync) |
| Reverse Q4: consent in the pull | The server's answer, offline too | The audit volume Q4 measured (~3,000 rows a day) |
| Neither: stop claiming | *"This phone does not have the doctor's answer"* instead of *"ask the doctor first"* | No audit load; the screen is honest but still cannot record |

Recording itself is unreachable in this build (`consents` is empty), so the last option loses
nothing that works today.

### FE-W61 — the offline queue survives sign-out (by reading code)

Queued writes are kept under one key for every user, and nothing clears them at sign-out. A
check-in queued offline by one rep would be sent by the next rep's app under the next rep's
sign-in. **Not reproduced on the device; what the server does with it is not measured.** Relevant
the moment phones are shared.

### E2 — has a real rep signed in anywhere?

**Nothing on this machine shows one, and production cannot be answered from here.**

- The local database's 7,162 users are all `@example.test`.
- The field app's local config points at `127.0.0.1`; there is no `eas.json`, so this repository
  holds no configuration for distributing a build.
- The register records the pilot gate **G-PILOT as not met** and the cutover (`BE-W46`) as not done.
- **But the repository-root `.env` points at the production project** — a build or a script run
  with it reaches production.
- Whether anyone has signed in to production is a question for production's `auth.users`, which
  MR-48 did not read.

## MR-49 — 21 September 2026

### BE-W108 — whose timezone is a UCPMP month? (a compliance count)

**Measured:** the UCPMP sample cap counts by when the sample was GIVEN (`occurred_at`), which is
right — but it bounds the month with `date_trunc('month', occurred_at)` in the database's session
timezone, **UTC**. A sample handed over between **00:00 and 05:30 IST on the 1st of a month counts
in the previous month's cap.** 19:00Z on 30 September (00:30 IST on 1 October) truncates to
September.

Not changed, because the answer is an enforcement rule:

| Option | Effect |
| --- | --- |
| India time, always | Matches a code written for India; simplest; wrong only if the product ever runs a territory elsewhere |
| The doctor's territory's zone | Correct everywhere hours are configured; **falls back to UTC where they are not** (MR-47's `day_zone_for`), which is today's defect again |
| The MR's territory's zone | Same fallback problem, and a cap belongs to the doctor, not the MR |

**Recommendation: India time, always, stated in the function** — the cap is a UCPMP (Indian) rule,
and a configuration gap must not move a compliance count.

### Voice notes — ✅ RESOLVED 22 Sep 2026: option (b), kept, `expo-file-system` approved (`C9`)

Option (a) or (b) (`blocked-on-you` → MR-47) is still unapproved, so MR-49 did not switch voice
notes off.

### FE-W65 — a second way into a visit in progress?

Today's next-visit card is the only way into a visit; a filter defect in MR-48 stranded a checked-in
MR. The Beat plan stop and the doctor profile could also open an in-progress visit. Registered, not
built: it is a navigation decision, and a doctor with two visits makes "which visit" a real question.

### Shared phones — what changed

A rep's unsent work now stays under their own account when they sign out, is sent the next time
**they** sign in, and is never shown to or sent by anyone else on that phone. Measured before the
fix on the Pixel 10: the next rep's app sent the previous rep's queued check-in and consent answer
under its own sign-in; the server refused both, so nothing false was recorded — but the previous
rep's work was lost.

## MR-50 — 22 September 2026

### Decisions recorded

`C7` keep the AI layer · `C8` the audio purpose · `C9` voice notes kept, `expo-file-system` approved ·
`C10` a dev-only console test renderer — all in `.ai-collab/decisions.md`. The items they settle are
marked resolved above, with pointers. **The MR-50 brief referred to a table of decisions that did not
reach the session; if it held others, they are not recorded yet.**

### The bake-off corpus — a proposal for you to approve (nothing has been recorded)

**Why it is needed.** Choosing an STT vendor (`BE-W32`, item 4.2) needs 5–10 hours of labelled
MR–doctor audio, measured against the Hinglish failure the plan documents (mr-app-plan §0.5: a
Whisper-class model at 52% mixed error rate on code-switched Hindi–English). Real consultations cannot
supply it: recording a real doctor waits on the §8.6 signatory (`C3`, `C8`).

**The proposal: the team records its own corpus — staged role-play between consenting employees, in
Hinglish.**

| | Proposed |
| --- | --- |
| **Volume** | 5–10 hours: roughly 30–40 conversations of 10–15 minutes |
| **Who** | Employees only, each signing a consent for this one purpose (vendor evaluation), with a deletion date. Different voices, genders and regional accents. **No real doctor, no real patient** |
| **What is said** | Semi-scripted: a scenario card per conversation (product detailing, an objection, a sample hand-over, a follow-up), improvised in the speakers' own words so the language is natural. Mix: mostly romanised Hinglish, some Hindi-heavy, some English-heavy — code-switching mid-sentence is the case that matters |
| **Planted test content** | Drug names from the product list, dosages and numbers; **fictional** adverse-event mentions (for detection) and **fictional** patient identifiers — a name, an age, a village — inside Hindi sentences (for the redaction suite, `BE-W33`). Nothing real |
| **Conditions** | Recorded on the phones reps will carry, the way the app records: in a room with a fan or AC running, phone on a desk and in a pocket, some crosstalk |
| **Labels** | Human transcription in the `TranscriptV1` shape — speaker labels, per-token language, the planted items marked — so the bake-off scores exactly what the pipeline will consume |

**What this does and does not remove.**

- **Removes:** the wait for real doctors and for the signatory, for the purpose of choosing a vendor.
- **Does NOT remove:** sending employees' voices to candidate vendors is still processing personal
  data by a third party. Each vendor's terms for evaluation audio (retention, training use) must be
  checked before upload — the vendor data agreement item (`B6`) applies in a lighter form.
- **Does not replace real audio** for final tuning: staged speech is cleaner than a clinic. The
  bake-off picks a vendor; real-audio measurement comes after the signatory.

**Cost, not measured:** I believe careful human transcription of code-switched speech takes several
hours of transcriber time per hour of audio — please get a quote rather than rely on that.

**What we need from you:** approval of the approach, someone to own recording it, and the consent
form wording for the employees taking part.

### 2.6 — the notice, REDRAFTED for `C8` and `C9` (MR-50 G) — this is the version to approve

**Still not approved, still not merged, and the false notice is still live on 22 September 2026.**
The draft on `mr-46/fe-w52-notice-pending-approval` (`7ec0c0f`, with `main` merged in so it is
checked against the current code) now reads:

| Row | Draft wording |
| --- | --- |
| Preamble | *This app records your work visits: when you check in and check out, where you were at those two moments, what you report and the samples you give. It does not follow you between visits. What it records is kept so your visits can be reviewed — by your manager, and by an AI system once that is built — to check that the company's procedures (SOPs) are followed. That is monitoring of your work, and each item it covers is below.* |
| Location | *Where you are — only when you check in or check out.* Your position at the moment you press check-in and check-out, and how far that is from the clinic. Nothing between visits, and nothing in the background. |
| Visits | *Which doctors you saw, and when.* Check-in and check-out times, and whether you were inside the clinic's area. |
| Reports | *Your call reports.* What you write after a visit. Your manager can read them. |
| Samples | *Samples and inputs you give.* The item, the quantity, its value, the doctor and the time. |
| Voice notes | *Your voice notes.* Kept on this phone when you save one; a note you start again or leave without saving is deleted. Not sent to anyone yet — sending is not built. Once it is, saved notes are reviewed for how procedures are followed. |
| Recordings (not yet) | *Recordings — only if a doctor agrees.* When recording is built, a consultation is recorded only after the doctor agrees, and is reviewed for how procedures are followed. If they say no, nothing happens to you. |
| Never | *Your personal calls, messages, other apps or camera. Where you are between visits.* |

**What changed from MR-47's draft, and why:** voice notes are now kept and discarded audio deleted
(`C9`, MR-50 D, on the emulator); and `C8` makes the audio's purpose SOP review — **monitoring of the
rep** — which the notice must say in plain words. Before approving, note that the doctor-facing
consent text must change too (`BE-W109`), and that neither text replaces the §8.6 signatory (5.8).

---

## MR-51 — three drafts for you. Nothing is shipped, and nothing has been recorded.

### E1 — consent for the bake-off corpus, for employees who take part

**What it is for.** `BE-W32` (the speech-vendor bake-off) needs 5–10 hours of labelled Hinglish
MR–doctor audio, and the project has none. The MR-50 proposal was that the team records it itself:
**staged role-play between consenting employees**, no real doctor and no real patient. This is the
consent those employees would sign. **It does not answer the vendor-terms question** — see below.

> **Taking part in the speech recording session — what you are agreeing to**
>
> We are recording short, acted sales conversations so we can test speech-to-text software on
> Indian English and Hindi mixed together. **Nothing in these recordings is real.** You will be
> given a made-up doctor, a made-up clinic and a made-up conversation to act out. Do not use a real
> doctor's name, a real patient's details, or anything about your actual work.
>
> **What we record.** Your voice, and a written copy of what you said. Your name is kept separately
> from the recording so that the recording itself is not labelled with who you are.
>
> **What it is used for.** One thing only: comparing speech-to-text vendors, and measuring how
> accurately each one writes down Hinglish. It is not used to assess you, it is never seen by your
> manager as part of your appraisal, and it does not go into the app's SOP review.
>
> **Who else receives it.** The speech-to-text vendors we are testing, listed by name before you
> agree, **on written terms that forbid them from training their models on this audio and require
> them to delete it when the test ends.** If a vendor will not agree to that, their test is run on
> nothing of yours.
>
> **How long it is kept.** Until the vendor comparison is finished, and no longer than **[operator
> to fix a date — a proposal: 12 months]**, after which the audio and the transcripts are deleted.
>
> **You can say no, and you can change your mind.** Taking part is voluntary. Saying no has no
> effect on your job, your targets or your appraisal. You can withdraw at any time up to deletion,
> by telling **[named person]**, and your recordings are then deleted.
>
> Name · Signature · Date

**What you must fill in before this is usable:** the vendor list, the retention date, the named
person for withdrawal, and whether legal wants a consent form at all versus a documented
work-instruction. **Still open beside it:** whether each vendor's standard terms actually permit
this (no-training, deletion) — a recording made before that is answered may have to be destroyed.

### E2 — `BE-W109`, the text a DOCTOR reads before a consultation is recorded

**Why it has to change.** `C8` makes the purpose explicit: recordings are reviewed, with AI
assistance, to check the company's procedures are followed. The live text (`consent_text_versions`,
loaded by `seed:reference`) says the team *"reviews how they presented"* — it names neither the AI
processing nor the SOP monitoring, so a doctor agreeing to it is not agreeing to what happens.

> **Before we record this conversation**
>
> With your permission, [Company] would like to record today's conversation with our
> representative.
>
> **Why.** We use it to check that our representative followed our own rules for these visits — for
> example, what they are allowed to tell you about a medicine. The recording is reviewed by our
> team, and by an automated system that helps them find the parts worth reviewing.
>
> **What is recorded.** The conversation between you and our representative. Before anyone reviews
> it, patient details are removed from the written copy.
>
> **How long we keep it.** [Operator: the retention period, matching what the system enforces.]
>
> **Your choice.** You can say no, and you can ask us to stop at any point during the visit. If you
> say no, the visit goes ahead exactly as it would have — nothing changes for you, and nothing
> happens to our representative.
>
> **Afterwards.** You can ask us for a copy, or ask us to delete it, at [contact].
>
> Do you agree to this conversation being recorded?   **Yes / No**

**Two things this draft does not settle, and engineering must not settle them:** the retention
period (it must match what the database enforces, not a number chosen here) and the contact point.

> **This text may not be shown to a real doctor until the §8.6 PV/DPDP signatory exists (5.8).**
> A recorded consultation creates the §2.4 adverse-event screening duty; `C3` is not reversed by
> `C7`. Approving the wording does not lift that.

### E3 — the reps' notice (2.6) must now say the note is SENT

**The MR-51 D upload changes what 2.6 claims.** The draft's voice-note row says *"Not sent to anyone
yet — sending is not built."* That is false as of `76de417`: a saved note uploads, and the phone's
copy is deleted once the server has it. **Corrected on the branch (`75dd570`, with `main` merged in
so it is checked against the code that now exists), and this is the row to approve:**

> *Your voice notes.* Saved on this phone when you press Save, then sent to the company — when you
> have no signal it waits and sends later. Once it has been sent, it is removed from this phone. A
> note you start again or leave without saving is deleted and never sent. Sent notes are reviewed
> for how procedures are followed.

Every other row of 2.6 is unchanged from the MR-50 table above. The notice is **still unapproved and
still unmerged**, and the false notice is still live on 23 September 2026.


## MR-54 — 23 September 2026: a withdrawal cannot stop a recording, and two rules contradict

### The measurement, first

On the emulator, with a recording in progress, a withdrawal was written to `consent_records`.
`standing_consent_for_visit` went to **null** while the phone was still capturing.

- **The recording did not stop.** It ran until the rep pressed stop.
- **518,740 bytes of audio of a doctor who had withdrawn were written to the phone, and are still
  there.**
- **Nothing reached the company.** `begin_upload` refused, no grant was minted, nothing was stored,
  and the rep was told in the server's own words.

So the server boundary held exactly as designed. The phone is the problem, and it is not a bug that
can be fixed by tightening a check — **there is no channel by which a withdrawal reaches a
recording device.** The phone holds no consent ledger (a deliberate MR-21 decision), it asks the
server once per screen (`FE-W69`), and **the app cannot capture a withdrawal at all** — that is
`BE-W95`, open since MR-28.

### The decision, which is yours and not engineering's

**Two recorded rules contradict each other and both cannot stand.**

| | Says |
| --- | --- |
| MR-53 B4, under test at `recording-upload.test.ts:149-152` | A refused recording is **KEPT** on the phone: *"a refusal is not proof the recording should be destroyed, and the MR is told. Destroying it here would also destroy the only copy of something a manager may need to know existed."* |
| MR-54's brief, A5 | After a withdrawal, **"nothing is left on the phone"** |

Engineering has not picked one, deliberately. The question is not a coding preference:

1. **When a doctor withdraws, must audio already captured on the rep's phone be destroyed?** If
   yes, the MR-53 rule is wrong for withdrawals specifically and the phone must delete on that one
   refusal reason while keeping on the others.
2. **If yes, how does the phone find out?** Today it cannot. Either the app gains a way to capture a
   withdrawal (`BE-W95`) and destroys locally on the spot, or the phone must poll the server during
   a recording — which is a new network behaviour during a consultation, and a decision in itself.
3. **What is the rep told**, given that a destroyed recording cannot be shown to anybody who later
   asks what was captured?

Until this is answered, the honest description of the current behaviour is: **a withdrawal stops the
audio reaching the company, and does not stop it being captured or stored on the phone.**

### Also recorded this session

**`BE-W112`** — `recordings`, `voice_notes` and `upload_grants` carry **no audit trigger**, while
`consent_records`, `visits` and fourteen other tables do. The system records that a doctor agreed
and does not record that audio of them was created. Measured from the live catalogue; zero audit
rows exist for the four recordings uploaded in this session.

### And one constraint on the hosted project (MR-54 D1)

> **Do not set `timebox` or `inactivity_timeout` under `[auth.sessions]` on the hosted Supabase
> project without re-testing the offline path.**

MR-53 E1 established that this repository sets neither: `[auth.sessions]` is commented out in
`services/api/supabase/config.toml:296-300`, so a refresh token has no expiry by the passage of
time, and a rep who is offline over a weekend stays signed in and their queued work survives.
`config.toml` configures the **local** stack only (it says so at `:180-182`), so the hosted
project's values are unknown to this repository and can be changed in the dashboard **with no code
change and no test failure anywhere.**

The commented examples in the file are `timebox = "24h"` and `inactivity_timeout = "8h"`. Either
one signs out every rep across a weekend, and `persisted-session.ts` correctly would NOT save them:
a session the server has ended is a non-retryable refusal, so auth-js removes the stored entry and
the rep lands on **Sign in** with their day's queued work unreachable until they have signal. That
is `FE-W67`'s failure mode, reintroduced from the dashboard.
