# DRAFTS — the AI content no person has approved yet (W2-D B)

**Everything in this folder is DRAFT.** Nothing here is in any database, and nothing here is approved by
anyone. Each file says so in its own first lines, and **each instruction set's text begins with a line
reading `DRAFT — NOT APPROVED`**, so a copy pasted anywhere still says it.

| File | What | Goes into |
| --- | --- | --- |
| `product_qa.md` | instruction set | console `/prompts` |
| `mr_chat.md` | instruction set | console `/prompts` — **not offered there yet** (`BE-W164`) |
| `lms_tutor.md` | instruction set | console `/prompts` — **not offered there yet** (`BE-W164`) |
| `ai_doctor.md` | instruction set | console `/prompts` |
| `ai_coach.md` | instruction set **and the B2 scoring rubric** | console `/prompts` |
| `personas-and-scenarios.md` | five personas, six scenarios, the stance finding (`BE-C73`) | console `/practice` |

**Where an approving admin finds them (B4).** An approver works in the console, and the console can only
show a draft that an admin of THAT company has authored there — a version row carries its organisation
and its author (`ai_prompt_versions.created_by_user_id`). Nobody outside the company can put one there,
and the backend track must not. So the drafts live here, linked from the one page that leads to them
(`../DAY-ONE.md`, H5–H6), and **the local live suite approves these exact files** (`pnpm ai:live`), so
the words are tested against the real model before a person is asked to approve them.

**The DRAFT line is meant to be deleted by a person.** An approver who has not read the text closely
enough to remove its first line has not read it closely enough to approve it.

## B5 — what is left after the drafts

**Decisions only the operator can make:**

1. The wording of all five instruction sets, and the persona briefs.
2. The length caps (`maxTokens`) and temperatures — every number in the drafts is a proposal (#11).
3. What the coach's **`scientific_accuracy`** means: discipline (drafted), accuracy against approved material
   (a code change), or no such dimension (a contract change) — `ai_coach.md`, B2.
4. Whether practice should simulate a doctor reporting a reaction at all (scenario **S6**), and what
   handling it well means — a pharmacovigilance judgement (`D-15`).
5. Which product and market each scenario is about (product-neutral as drafted).
6. The company facts `mr_chat` may rely on — its draft has an empty section; it is given no company material.

**People:**

7. A second admin (Q-14) to approve five prompts, five personas and six scenarios — none exists.
8. The AWS account owner, for model access.
9. Content owners: approved product documents (Q-9) and courses — and a loader for each (none exists).

**Engineering:**

10. `BE-W164` — the console cannot author a prompt that runs, cannot author two of the five, and cannot set
    model config. **Blocks every production feature.**
11. `BE-W163` — the coach's contract names no keys (the draft works around it).
12. `BE-W146` — before production AI traffic (`BE-C71`).
13. The app's assistant and practice screens onto their live transports, and a build (W1-Z B5).
