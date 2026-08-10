# Backend Prompt — BE-W6

**Issued after the BE-W5 review (commit `e2a0c08`).** This is the only backend prompt in flight. Nothing earlier is superseded.

---

## Reviewer decisions carried into this week

Four decisions were made on the BE-W5 report. They are repeated inside the prompt so the developer does not need this preamble.

| # | Decision | Reason |
|---|---|---|
| 1 | Exception thresholds move into a **config table**, not SQL constants. Consent anomaly gains a **team-size floor**. | You already said they are guesses. A guess in a migration costs a migration to change; a guess in a row costs an UPDATE. |
| 2 | **An org-level default shift window is now permitted — but every capture made under it is flagged and surfaced as an exception.** | Reversal of the earlier strict rule, stated as such. Strict was right at one week late. At three weeks it is blocking a gate. |
| 3 | **Backend publishes transcript schema `v0` itself**, marked placeholder, owned by AI/ML. | The schema and the vendor decision are two different things and only one of them blocks you. |
| 4 | **Bulk approve must report truncation** the same way `search_doctors` does. | A silent cap is the same failure as a silent skip. You fixed it in one place; fix it in both. |

---

# PROMPT BE-W6 — Consent, recording and retention

> Paste everything between the lines.

---

Read `PROJECT-OVERVIEW.md`, `docs/gotchas.md` and `mr-app-plan.md` §0 first. Follow the conventions established in BE-W1 through BE-W5. This is week 6 of 12.

## The thing that matters most this week

**Consent is the entire legal basis for the recording feature.** This week you make it structurally impossible to hold audio that consent does not cover.

Three properties. Each enforced in the database, not in application code, not in the client:

1. **No audio can exist for a visit without a `consented` record** referencing a valid `consent_text_versions` row.
2. **Withdrawal removes reach, not just permission.** A withdrawn recording is destroyed, not hidden.
3. **Nothing survives 90 days.**

If any of the three is enforceable only by a well-behaved client, it is not enforced.

## Part 1 — Housekeeping from the BE-W5 review

### 1.1 Exception thresholds become configuration

`team_exceptions` currently hardcodes three thresholds — 12 hours without sync, 20% rejection over ≥5 items, 40 points of consent deviation over ≥3 captures. You flagged these as chosen rather than derived. Correct, and they will need retuning against the first week of pilot data.

Move them to a config table: threshold key, value, unit, scope (global or territory), effective date, and who set it. Read at query time. Seed with today's values so behaviour does not change.

Do **not** build a UI for it. A seeded table and an UPDATE is the whole feature.

### 1.2 The consent anomaly needs a team-size floor

You are right that it is close to meaningless at three MRs — a median over three people is one person's number. A capture-count floor does not fix that, because the problem is the size of the comparison group, not the size of the sample.

Add a **minimum team size** below which the anomaly is not emitted at all. Emit nothing — not a low-confidence signal, not a nulled field. A number nobody can act on is worse than a blank, because someone will act on it anyway.

Put the floor in the same config table. Set it to a value you can defend in the overview.

### 1.3 Bulk approve truncation

`search_doctors` now returns `{ items, truncated, limit }`. Bulk approve caps at 200 and does not. Same treatment: if the caller submits more than the cap, decide the first N, return the count decided, the count not decided, and `truncated: true`. Never silently drop the tail.

### 1.4 Shift window — an org default is now permitted

This reverses the earlier rule that a missing shift window refuses every capture. The reason for the reversal: the client data is three weeks late and the strict rule is now blocking Gate 1's realism, not just production.

Build it as follows, and the flag is not optional:

- An **organisation-level default window** may be configured, in the same config table.
- A territory window always wins over it.
- Every `check_ins` row captured under the default carries `shift_window_source = 'org_default'` — a stored column, written server-side, not derived at read time.
- **Every such capture appears in `team_exceptions`** with its own reason code. Not a warning in a log. A visible exception a manager sees.
- The org default is **null by default**. If nobody configures it, behaviour is exactly as it is today: refuse.

The property I cared about in the strict version was *do not invent a business rule and let it pass as fact*. A loud flag preserves that. A quiet default destroys it. If you find yourself making the flag easy to ignore, you have rebuilt the thing I was trying to prevent.

### 1.5 Transcript schema v0

AI/ML owes contract I3. It is three weeks late and week 8 cannot be designed without a schema.

Publish `TranscriptV0` to `packages/core` yourself, from the specification that already exists in the AI/ML brief: segments, start and end timestamps, speaker label, text, per-word confidence where the provider returns it, language tag per segment.

Rules for it:

- Mark it **explicitly as a placeholder owned by AI/ML** in a comment at the top of the file, with the date and the reason it exists.
- **Provider-agnostic.** No vendor field names, no vendor enums. If you cannot express something without naming Sarvam or Deepgram, leave it out.
- Version it in the type name so `TranscriptV1` can arrive without editing consumers.

This unblocks your storage layer. It does **not** substitute for the vendor decision, and you should not treat it as closing I3.

## Part 2 — Build

### 2.1 Consent capture

The API that writes `consent_records`. It already exists as a table; this is the write path and its guards.

- All three outcomes — `consented`, `declined`, `not_asked` — are complete, successful captures. `declined` returns 200, carries no error shape, no penalty flag, no nullable-because-it-failed column.
- The consent text version and display language are recorded from the server's catalogue, not accepted from the client. A client that reports it displayed version 4 when version 5 is current is either stale or lying, and you cannot tell which.
- Immutable, as already built. Withdrawal is a new row.

**`declined` and `not_asked` must make the recording path absent, not disabled.** There is no upload endpoint that accepts a visit lacking a `consented` record and returns an error — there is no URL to call at all. A disabled feature is one config flag away from being enabled by accident.

### 2.2 Audio storage

- Private Supabase Storage bucket. No public URL, ever.
- **Server-issued signed upload URLs**, short TTL, one per visit. The consent check happens at URL issuance, and again at the storage RLS policy. Two checks, because the first one is a convenience and the second one is the control.
- **The object path must not encode doctor identity, doctor name, clinic name, or anything about a patient.** Opaque ids only. Object paths leak through logs, error messages and support tickets.
- Size and duration ceilings, enforced server-side. An unbounded upload endpoint is a denial-of-service surface and a cost surface.

### 2.3 The withdrawal cascade — read this twice

This is the hardest design decision of the week and I want your reasoning in the overview, not just the code.

When a withdrawal row lands for a visit that already has a recording:

- The audio object is destroyed.
- The raw transcript is destroyed.
- Any derived artifact — redacted transcript, analysis, summary, extracted findings — is destroyed.
- An audit row records **what was destroyed**: counts, ids, timestamps. Never content. The audit trail must not become the copy that survives the deletion.

Then the part people get wrong: **a manager may already have read the summary.** You cannot un-read it. The honest model is that the record shows the content existed and was withdrawn — not that it never existed, and not that it is still readable.

So: the manager-facing surface shows a withdrawn placeholder with the withdrawal date. It does not show the content, and it does not silently vanish as though the visit never happened. Silently vanishing is worse, because it makes the withdrawal invisible to the only person who might otherwise notice a pattern of them.

**Withdrawal will arrive offline, days late, after the analysis has already run.** Design for that as the normal case, not the edge case.

### 2.4 Retention purge — 90 days

- Counted from the **server-side received-at**, never the client-reported occurred-at. The client clock is not trusted and this is a compliance clock.
- **Idempotent and resumable.** It will fail partway through a batch. Running it twice must be safe; running it after a crash must finish the job.
- Purges the storage object **and** the database row. These are different systems and a row delete does not touch the object.

**The test must insert a row with a backdated received-at, run the actual purge job, and assert the storage object is gone as well as the row.** A test that only checks the row proves the half that was never in doubt. A test that only checks that a scheduled job is registered proves nothing at all.

### 2.5 The redaction gate at the storage layer

AI/ML builds the redaction engine. Your job is to make it impossible to route around.

- Raw transcripts and redacted transcripts live in **separate tables**.
- The database role the LLM gateway will run as has **no grant of any kind** on the raw table. Not a restrictive policy — no grant.
- **Prove it:** a test that assumes that role and queries the raw table, asserting `permission denied` — not an empty result. This is the case where the amendment's distinction genuinely bites: here the absence of a grant is the control, so an empty result would mean the control is missing and something else happened to filter the rows.

The gateway does not exist yet. Create the role and the grants now anyway. It is three lines this week and an argument in week 8.

### 2.6 Do not build this week

Named explicitly so it does not creep in:

- No adverse-event detection. That is week 7 and it has a legal design that is not yours.
- No LLM calls of any kind.
- No analysis, scoring, or summarisation.
- No transcription. You store transcripts; you do not produce them.
- No UI.

## Things that will bite

- **Storage objects are not rows.** RLS does not reach them. Every deletion path needs both, and every deletion test needs to assert both.
- **A failed purge is silent by default.** It needs an observable outcome — count purged, count failed, last successful run — or you will discover in month four that it stopped in week 7.
- **Consent withdrawal and the retention purge can race.** Both delete the same objects. Make them safe to interleave.
- **The audit row for a destruction must be written in the same transaction as the destruction**, or you get destructions with no record and records with no destruction. Say which you chose and why.

## Rules

No features beyond what is listed. No speculative abstraction. Every migration reversible and checked in. **No PHI in any test data committed to the repo** — synthetic audio and synthetic transcripts only. If a requirement is ambiguous, stop and ask rather than guessing.

If any test passes when it should fail, stop and report it. Do not work around it in application code.

## Required at the end

**Append a `### BE-W6 — Consent, recording and retention` section to `PROJECT-OVERVIEW.md`.** Never overwrite an earlier section.

Include:

- Every table, policy, grant and storage rule created
- **The withdrawal cascade decision and your reasoning**, including what happens to an already-read summary
- What the purge test actually asserts, and what it does not
- The team-size floor you chose and why that number
- Anything you were asked to build that you believe is wrong, and why

Then **update `docs/gotchas.md`** with anything this week cost you that would cost the next developer the same.

---

*Constraints trace to `mr-app-plan.md` §0. The consent immutability rules are from `backend-prompts-v2.md` §3. The redaction requirement is from `aiml-brief.md` §4.*
