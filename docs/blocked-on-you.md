# Blocked on you — 14 August 2026

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
