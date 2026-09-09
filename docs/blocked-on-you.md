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
| 5.1 | **A physical Android handset — Xiaomi, Oppo, Vivo or Realme. NOT a Pixel.** Those four are the OEM battery killers the app has to survive; a Pixel proves nothing because its ROM does not do the killing | Operator | **6 weeks** | **FE-G1 and FE-G2.** Both are DEVICE gates and cannot close on an emulator |
| 5.2 | **Supabase paid plan, ~$25/month** | Operator | — | The free tier **auto-paused production for two weeks in August**. Also the honest fix for `BE-W69`, which was declined as a workaround |
| 5.3 | **Transistorsoft licence, or a decision to ship foreground-only check-in** | Operator | — | Geofenced check-in, which is the **primary** check-in mechanism |
| 5.4 | **Play Store versus sideload** | Operator | — | A 100-MR pilot does not need the store. The background-location declaration takes days to weeks, so the answer changes the timeline either way |
| 5.5 | **O1 — the data controller model** | Client | **1 month** | The consent model and the controller fields on **every clinical table**. The patient app cannot start without it |
| 5.6 | **§3.6 recorded in `.ai-collab/decisions.md` with a NAMED human** | Operator | — | Coaching (C4). A decision with no name on it is not recorded |
| 5.7 | **Reference data and per-territory shift hours** | Client | Sprint 3 | Capture **refuses** without them. The org-default window expires 60 days after configuration and then refuses again, by design |
| 5.8 | **The named PV/DPDP signatory** | Client | — | **Audio, permanently**, until it exists (C3) — and with it Tier 1 automations 1, 4, 5 and 6 |
| 5.9 | **The UCPMP cap value and dimension** | Client | — | **A BUILD-FAILING DEADLINE OF 6 NOVEMBER is already wired**, warning from **16 October**. `check:decision-debt` fails CI on that date. Do not invent a value to clear it — set the real one, or file a migration moving the deadline with its reason |
| 5.10 | **`consent_max_sync_lag_hours` (72h) and `consent_future_tolerance_seconds` (120s)** | Client | — | Both **UNVERIFIED** — they are defaults nobody has confirmed. The second now also bounds how far a device clock may run ahead on a visit, so its name is wrong as well as its value unconfirmed |
| 5.11 | **The Supabase storage-deletion DPA question** | Operator | **Sprint 7** | Whether the 90-day retention claim is literally true. **Drafted since sprint seven and never sent.** Not answerable from the API |

### The three that are actually urgent

1. **5.9** has a date attached and the date is in the build. It will turn CI red on
   6 November whatever else is happening.
2. **5.1** has been open six weeks and blocks two gates that nothing else can close.
3. **5.5** blocks a second product, not just this one.
