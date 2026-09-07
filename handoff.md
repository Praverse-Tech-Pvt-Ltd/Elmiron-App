# Project Handoff — Backend

**Written:** 7 September 2026 · **Head:** `a60423a`, `main` level with `origin/main`
**Phase:** Backend stopped, by decision, at the end of BE-W8 (14 August). Frontend has
since done four sprints/phases of work on top of it. No backend code has moved except
one unblocking script. **This file was last written 17 August and had gone stale in
exactly the way `handover.md` warns about — it described BE-W8 as "not started" three
weeks after it finished.** Rewritten from the actual repo state, not from the previous
version of this file.

> `.ai-collab/` and this file are **tracked as of BE-W8** (14 Aug) — the original
> BE-W6 untracked-on-principle decision was explicitly reversed, on request, because a
> file nobody can find is worse than one that goes stale, provided it is kept current.
> It had not been touched by backend since. The durable, append-only records are
> `PROJECT-OVERVIEW.md` and `docs/gotchas.md` — if this file disagrees with those,
> they are right.

---

## 1. What week are we at

- **Backend: BE-W8 complete, nothing started since.** Last backend migration is
  `20260817000200_purge_backlog_stall_detection.sql` (19 total). No `### BE-W9`
  section exists in `PROJECT-OVERVIEW.md`.
- **Frontend has moved a long way in the meantime:** FE-W1 → FE-W3, plus a separate
  "Phase 1–4" design/build track reaching consent-gated audio capture and a manager
  console (`a60423a`, 7 September). None of it required backend schema changes beyond
  one script (§4).
- **The only backend-owned change since 14 August:** `cb075b1` (3 Sept, Dev Patel) —
  `seed-one-mr.mjs` was dead code (wrong import specifiers, would `ERR_MODULE_NOT_FOUND`
  the instant anyone ran it, and nothing ever had). Rewritten self-contained to match
  its five siblings and given a real test. Not a new feature; a repair of something
  that never worked.
- **The whole monorepo scope renamed** `@elmiron/*` → `@fieldforce/*` (`f34ceef`,
  Frontend, "remove a third party's trademark from the permanent identifiers" — Elmiron
  is a real branded drug name, and this app is not that drug). 53 files, all package
  names, imports and CI `--filter` arguments. It reached `main` as a fast-forward — no
  backend work was in flight to conflict with it, so nothing needed reconciling. Worth
  knowing the identifier changed everywhere including `services/api/package.json`.

## 2. Verified this session, not assumed

```
services/api  typecheck   clean
services/api  lint        clean
services/api  vitest run  344 passed, 14 files (Docker up)
verify:rollbacks           19/19 reversed, public schema empty, database restored
```

344, not the 312 from 17 August — the seed-one-mr repair added its own spec file. Full
monorepo `pnpm run build` was **not** waited on this session (frontend packages make it
slow); backend-scoped checks above ran directly and are what this handoff is based on.

## 3. Production — state as of 14 August, **not reconfirmed today**

Everything below was true and independently verified on the remote when BE-W8 closed.
**A live pooler connection attempted this session failed** —
`FATAL: tenant/user postgres.pgfdbzoapmleqtoezhoa not found` — which is a Supabase-side
error, not a DNS or local-network one. This could mean the project was paused
(inactivity is plausible: three weeks with the retention workflows disabled, §5), the
project reference changed, or the credentials in `.env` are stale. **Not diagnosed
further this session — flagged as the top open item, not glossed over.**

| Fact, as last verified (14 Aug) | |
| --- | --- |
| Migrations applied | 19 (includes both BE-W8 additions) |
| Tables | 34+ |
| RLS enabled and forced | on every table |
| Custom access token hook | enabled, proven by a real sign-in |
| `purge_max_silence_hours` / `purge_batch_limit` / `purge_backlog_multiplier` | 12h / 250 / 3 — the backlog-based stall fix (§5) |
| Seeded reference data | **none.** No orgs, territories, doctors, consent-text. Capture refuses, correctly. |
| GitHub Actions secrets | all three set (`SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) |

**First action for whoever picks this up: confirm the project is actually reachable**
(`supabase migration list --db-url <pooler>` or the dashboard) before trusting anything
else in this section.

## 4. What frontend has been waiting on backend for

Two concrete, cheap, still-open items — found in `docs/blocked-on-you.md` and
`docs/backend-request-scope-rename.md`, both addressed to backend and neither closed:

1. **Deep-link redirect URL, `services/api/supabase/config.toml`.** Never added:
   ```toml
   additional_redirect_urls = ["http://127.0.0.1:3000", "https://127.0.0.1:3000", "com.praversetech.fieldforce://auth-callback"]
   ```
   Not urgent — nothing exercises the redirect path yet, the app signs in with the
   password grant — but it matters the moment OTP, a magic link or OAuth is used, and
   it is a one-line miss that will read as a mystery bug later. Same config change
   needed on any hosted project, not just local.
2. **The package-scope rename (§1) landed cleanly** — the sequencing risk in
   `backend-request-scope-rename.md` never materialised because backend had nothing
   in flight to conflict with it. Nothing to do here now; noted so nobody re-reads
   that file and thinks it's still live.

## 5. What BE-W8 actually shipped (for anyone who only has this file)

Full detail is `PROJECT-OVERVIEW.md` → `### BE-W8` and its `§7` addendum, and
`.ai-collab/decisions.md`. Summary:

- **`verify:rollbacks` and `reconcile-after-restore --apply` refuse a non-local /
  implicit target.** The hazard `.ai-collab/handover.md` had documented three times as
  a rule for humans to remember is now enforced in code.
- **Retention schedule found under-provisioned ~16x at pilot scale** (daily cron,
  batch 100, against ~1,600 audio objects/day arrival) — moved to hourly, batch made
  configurable (`app_thresholds.purge_batch_limit`, default 250).
- **Stall detection redesigned from a single-object trip-wire to backlog-based.** The
  first version of this fix (3h, single object) would have refused the whole fleet on
  ordinary GitHub Actions scheduling jitter — caught before it reached production.
  Now: primary signal is backlog size (`purge_backlog_multiplier` × batch), secondary
  is a 12h hard ceiling for a worker that dies before any backlog accumulates.
- **A caught-and-corrected false claim, on the record rather than buried:** an early
  draft of that fix wrongly asserted `audio_purge_health()` had been broken since
  BE-W6. It hadn't — a later migration had already fixed it; the claim came from
  reading one `create or replace` and missing another. Caught by querying the live
  database before pushing, not after.
- **Idempotent reference-data seed script exists** (`seed-reference-data.mjs`) but has
  **never been run against production** — no real org/territory/doctor data exists to
  seed it with.
- **PITR decision: do not buy it.** Daily backups + `docs/restore-runbook.md` is the
  posture. Recorded in `.ai-collab/decisions.md` with reasoning.
- **Retention workflows are currently `disabled_manually`**, on explicit instruction,
  as of 23 August. Both had been running green on real hourly/15-min cron since the
  14 August re-enable — this was not a response to a failure, and no reason was given.
  **This is the reminder-mechanism gap flagged in `decisions.md`: a disabled workflow
  is silent, and three weeks have now passed with no automated signal from
  production at all.** Combined with §3's connectivity failure, this is the actual
  state of retention enforcement right now: **unknown, not "working."**

## 6. Explicitly deferred, not forgotten

Both named and accepted as real, cheap, and correctly not worth another backend week
ahead of frontend's progress:

- **The `.ai-collab/` split** — track the six durable files as-is (`constraints.md`,
  `bug-log.md`, `flow.md`, `test-checklist.md`, `rollback.md`, `architecture.md`);
  strip point-in-time claims out of `handover.md` and this file specifically into
  pointers at `PROJECT-OVERVIEW.md`. **This handoff is itself evidence for why:** it
  went stale in three weeks exactly as predicted.
- **Production-migration audit trail.** Two `supabase db push` calls were run by hand
  outside CI during BE-W8. No incident resulted, but there's no runbook step or
  workflow enforcing verification — named so a third one doesn't go wrong silently.

## 7. Open items with real dates, unchanged since BE-W7/W8, not touched by any of the above

From `docs/blocked-on-you.md` §4 and `PROJECT-OVERVIEW.md`'s open questions — none of
this moved while backend was stopped:

1. **Contract I3 (STT vendor + Hinglish WER) — CI goes red 30 September** unless
   `TranscriptV1` exists. Today is 7 September. **Three weeks.**
2. **PV/privacy sign-off** — two specific questions (does `reported_text` carry patient
   info; does an AE report survive a consent withdrawal), open since sprint 1, both
   currently answered by default rather than decision, both baked into a deployed
   schema.
3. **Supabase DPA question** — infrastructure-level retention of a deleted storage
   object. Draft exists (`docs/escalations-week8.md`), not yet sent. Decides whether
   the 90-day promise is literally true.
4. **Per-territory shift hours from the client** — capture refuses without them; the
   org-default window expires 60 days after being set.
5. **`sync_push` at real concurrency** (100 MRs at 6pm, one session pooler) — a
   connection-count question, explicitly unmeasured, explicitly out of BE-W8's scope.

## 8. Immediate next steps, in order

1. **Confirm production is actually reachable** (§3). This blocks trusting anything
   else about the deployed state.
2. **If reachable: re-enable `retention.yml` / `retention-watchdog.yml`**, or make a
   deliberate decision to leave them off and say why (currently no reason is on
   record — see §5).
3. **Decide on the `.ai-collab/` split and the migration-audit-trail gap** (§6), or
   consciously defer again with a reason.
4. **Send the two drafted-but-unsent escalations** (§7.2, §7.3) — both have been
   ready to send since sprint 1 and sprint 7 respectively.
5. **Add the deep-link redirect entry** (§4.1) — one line, no dependencies.
6. Only after the above: pick up wherever `PROJECT-OVERVIEW.md`'s next backend prompt
   points, or write one.
