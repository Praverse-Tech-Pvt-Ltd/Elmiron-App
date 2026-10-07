# DRAFT — the six practice characters of `BE-C35`, as personas and scenarios (W2-D B3)

**Status: DRAFT. Not authored in any console, not submitted, not approved.** A persona or scenario becomes
content only when an admin authors it in the console's **`/practice`** screen, submits it, and a DIFFERENT
admin approves it (`BE-C7`; the table's `sim_personas_four_eyes` / `sim_scenarios_four_eyes` constraints).
Every brief below begins with **DRAFT** for the same reason the instruction sets do: an approver who has
not read it closely enough to delete that word has not read it closely enough to approve it.

## The enum finding — the four stances are enough; the six are not six stances

The operator's list (`BE-C35`, `.ai-collab/decisions-backend.md:420`): *busy, scientific, price-sensitive,
competitor-loyal, skeptical, and a difficult-objection scenario.* The code has four stances —
`receptive`, `sceptical`, `rushed`, `hostile` (`packages/core/src/field/simulation.ts:42`).

**Measured, not assumed — what a stance DOES in the code:** nothing on the server branches on it. It reaches
the model as one line, `Your stance: <word>` (`sim-doctor.ts:174`), and the rep sees it as a label on the
practice list (`apps/field/app/practice/index.tsx:45`). Everything else that makes a doctor this doctor is in
fields that are free text: `specialty`, `brief` (persona) and `objective`, `objection` (scenario).

**So the six split three ways, and none needs a new stance:**

| Operator's word | What it is | Stance | Where the difference lives |
| --- | --- | --- | --- |
| busy | a manner | `rushed` | the stance itself, and the brief |
| skeptical | a manner | `sceptical` | the stance itself, and the brief |
| scientific | a character | `sceptical` | the brief: wants trial data, design, endpoints |
| price-sensitive | a character | `receptive` | the brief and the objection: open, but cost decides |
| competitor-loyal | a character | `hostile` | the brief and the objection: content with what they use |
| difficult-objection | **a scenario, not a persona** | (any persona) | `sim_scenarios.objection` |

**The enum is not short.** Widening it would add a word to one prompt line and a label, and buy nothing
the brief does not already carry; it would also be a contract change on both tracks. **Not widened**, as
the brief instructs. **One cost to name honestly:** the rep's list shows the stance, so "price-sensitive"
shows as *Receptive* and "scientific" as *Sceptical* — the `display_name` should carry the character
(below) so the list still says what the rep is choosing.

**`receptive` is used by none of the operator's words except price-sensitive** — and no operator word maps
to an easy doctor. That is probably right for practice, but it is the operator's call.

## The personas

`display_name` is a LABEL, never a real doctor's name (the column comment, and the approver's rule).

| # | `display_name` | `specialty` | `stance` | `brief` |
| --- | --- | --- | --- | --- |
| P1 | Busy GP (practice) | General practice | `rushed` | DRAFT. A general practitioner with a full waiting room. Gives the representative two minutes at most and says so. Interrupts long answers. Will listen to one clear point that matters to their patients, and ends the visit if the first sentence does not get there. |
| P2 | Sceptical physician (practice) | Internal medicine | `sceptical` | DRAFT. An experienced physician who has heard many pitches and believes few. Polite but unconvinced. Asks "compared with what?" and "says who?". Is moved only by a straight answer, and notices when a question is dodged. |
| P3 | Evidence-first cardiologist (practice) | Cardiology | `sceptical` | DRAFT. A consultant who reads trials. Asks about study design, population, endpoints and absolute rather than relative benefit. Respects "I don't know, I'll send you the study" far more than a confident guess. Dismisses marketing language. |
| P4 | Cost-conscious GP (practice) | General practice | `receptive` | DRAFT. A practitioner in a town clinic whose patients mostly pay out of pocket. Interested and friendly, but every decision comes back to what the patient can afford for the whole course of treatment, and whether it is stocked at the local chemist. |
| P5 | Loyal-to-current-brand diabetologist (practice) | Diabetology | `hostile` | DRAFT. Has prescribed the same established treatment for years and is satisfied with it. Short with representatives, sees switching as risk without reason. Will engage only if given a specific reason their current choice is not serving a specific kind of patient. |

## The scenarios

Each scenario belongs to ONE persona (`persona_id`). **Left product-neutral on purpose**: a scenario that
names a product must name its market too (`sim_scenarios_product_names_market`), and which product, in
which market, is the operator's to choose. With a product, the objective and objection should name it.

| # | Persona | `title` | `objective` | `objection` |
| --- | --- | --- | --- | --- |
| S1 | P1 | The two-minute visit | Get agreement to one follow-up visit with a clear reason for it | "I have patients waiting. What is the one thing I need to know?" |
| S2 | P2 | "They all say that" | Have the doctor accept one specific claim as supported | "Every company tells me theirs is better. Why should I believe you?" |
| S3 | P3 | Show me the trial | Answer a question about the evidence honestly, including what is not known | "What was the comparator in the main study, and what was the absolute risk reduction?" |
| S4 | P4 | What will it cost my patient? | Address total cost and availability without overstating value | "My patients cannot afford a new branded medicine every month. What does a full course cost?" |
| S5 | P5 | Why would I switch? | Identify one patient group where the current choice may not suffice | "I have used the same treatment for ten years and my patients are fine. Why change?" |
| **S6** | **P2** (or any) | **The difficult objection** | Stay accurate and calm when told the product caused harm | "One of my patients had a bad reaction to your product last month. Why should I prescribe it again?" |

**S6 is the operator's sixth item, and it needs the operator.** A doctor reporting a reaction is a
**possible adverse event** in real life, and the rep's correct move is to take it seriously and report it —
`BE-C36` (the rep flags; does no medical assessment). This scenario would teach that; **but whether practice
should simulate an adverse-event report at all, and what "handled well" means, is a pharmacovigilance
judgement** — the signatory's (`D-15`), not the backend's.
