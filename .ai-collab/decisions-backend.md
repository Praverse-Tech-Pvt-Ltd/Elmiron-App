# Decisions — backend track

> **The real decision log is `PROJECT-OVERVIEW.md`.** This file holds only decisions **not yet
> written there**, for the **backend** track, and it is append-only.
>
> Ids are minted **per track** (`BE-C<n>` / `FE-C<n>`, `CLAUDE.md`). `C1`–`C31` predate that
> rule, stay in `.ai-collab/decisions.md`, and keep their names.
>
> **Why the split — `BE-W120`:** two tracks appending to one file conflicted four times on
> 28 September, and a conflicting PR gets **no CI run at all**. It does **not** fix id collisions;
> per-track prefixes did that. Nothing already written moved.

---

## `BE-C4` — contract-request ids are minted per track · 29 September 2026

- **Decision:** the backend mints **`BE-CR<n>`**, the frontend **`FE-CR<n>`**, each from its own
  sequence starting at 1. `CR-1`–`CR-5` keep their names.
- **Why:** the frontend filed a voice-note item as `CR-5`, which was already the practice session
  API. Both tracks read the highest id in `docs/contract-requests.md`, which is only correct on one
  branch at a time — **the same mechanism as the `C20` collision**.
- **Why it recurred:** `BE-C3` applied per-track prefixes to **decisions** and stopped there.
  Contract requests are minted the same way from the same kind of file, and nobody extended the
  rule. **A rule that names one register does not cover the next one somebody invents.**
- **Recorded in `CLAUDE.md`**, beside `BE-C3`, because that is the only file both tracks load before
  reading any code.

## `BE-C5` — an off-site check-in is recorded and flagged, never refused · 29 September 2026

- **Decision:** (1) the rep **is told**, in one plain line, that the clinic could not be confirmed —
  and told nothing about consequences, because none are decided; (2) the visit **still starts**;
  (3) there is **no manager surface in v1**.
- **Why tell them:** it is a fact about their own check-in that someone may later read when deciding
  things about their job. The same omission is what makes today's privacy notice untrue.
- **Why not refuse:** the server already does not refuse, and refusing would strand a rep standing
  in front of a doctor because a clinic's stored coordinates are wrong. **A flagged check-in is
  strictly more useful than one that never happened.**
- **Why no manager surface:** nothing has ruled on what "outside" *means*, and the first conclusion
  drawn from such a screen will be about somebody's pay. The data is on every row from the start, so
  the screen can be built later against a complete history — **the asymmetry is the argument**.
