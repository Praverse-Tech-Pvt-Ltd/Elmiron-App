# DRAFT — `ai_coach` instruction set and scoring rubric (W2-D B1, B2)

**Status: DRAFT. Not approved, not submitted, not in any database.** Pasted into **`/prompts`** by one
admin, approved by a different one (Q-14). The first line of the text says DRAFT on purpose.

| Field in `/prompts` | Value |
| --- | --- |
| Feature | `ai_coach` |
| Output schema name | `SimCoachOutputSchema` |
| Model config | the JSON below — PROPOSALS |

**What the code adds** (`packages/core/src/field/gateway/sim-doctor.ts`, `analyseSimSession`): "coaching a
rep on a PRACTICE conversation", cite a `turnIndex` for every finding, at least one strength and one
improvement, the seven dimension names, the module rule, "Reply with JSON only". The user message carries
the available modules, the scenario's objective and objection, and the stored turns numbered `[n]`.

**What the code does NOT add — and why this draft carries a JSON shape the other four do not.** The other
four flows name their JSON keys; the coach's contract never does (`overallScore`, `dimensionScores`,
`strengths`, `improvements`, `suggestedModules`, `summary` appear nowhere in what the model is sent). A real
model would invent its own names and every analysis would fail as `schema_invalid` — prediction **#14**
(`DAY-ONE.md`). The shape is spelled out below so this draft works either way; the durable fix is in code
(`BE-W163`), after which the approver may delete that block.

## B2 — the two dimensions the operator named, as criteria

**The finding first: `scientific_accuracy` cannot be scored as written by this system.** The coach is
given the transcript, the objective and the objection — **not the approved product material**. So "was the
rep accurate" can only be judged against the model's own general knowledge, which is exactly what
`BE-C37` forbids as a source of product truth, and it would score a rep who repeated the approved label
word for word lower whenever the model's training disagreed. **The operator must define it**, and choose
one of:

1. **Accept a narrower meaning** — *scientific discipline*: does the rep claim only what they can support,
   hedge correctly, and say "I'll check" rather than invent? That is scorable from the transcript alone;
   the draft below does exactly this and says so in its own text.
2. **Give the coach the scenario's approved material** (the scenario already names `product_id` and
   `market_id`; the coach could be sent that product's approved chunks, as `product_qa` is). A code change,
   and the only way "accuracy" means accuracy.
3. **Drop the dimension** from the seven. A contract change (`SIM_COACH_DIMENSIONS`).

**`response_relevance` is scorable from the transcript**, and is drafted as criteria below.

| Score | `scientific_accuracy` (meaning 1 — discipline) | `response_relevance` |
| --- | --- | --- |
| **40** | Made at least one specific claim — a number, a comparison, "safer", "works faster" — with nothing behind it, or answered a challenge by restating the claim louder; never once said where a fact comes from | Answered a question the doctor did not ask: the doctor raised cost and the rep talked about efficacy; the objection is still open at the end and the rep's turns would read the same whatever the doctor had said |
| **70** | Every specific claim is tied to a source the rep names ("the approved leaflet says…"); one claim is stated more strongly than it should be, or one challenge is met with a vague reassurance rather than "I'll come back to you with the data" | Each turn answers the doctor's last turn, and the objection is addressed directly at least once; one turn drifts into a prepared pitch, or a follow-up question from the doctor is half-answered |
| 90+ | No claim beyond what the rep can source; uncertainty admitted plainly; no off-label suggestion even when invited | Every turn responds to the doctor's previous one; the objection is answered with what the doctor actually asked about, and the rep checks it landed |

```text
DRAFT — NOT APPROVED. An approving admin deletes this line only after reading every line below.

You are coaching a pharmaceutical medical representative on a practice conversation with a simulated
doctor. Your feedback is for the representative's own learning. Be specific, fair and brief, and name
the turn every point is about.

Score each dimension 0-100 as a WHOLE NUMBER, using these anchors. A score you cannot justify from the
transcript is too high.

opening — 40: no introduction or purpose, launches into a pitch. 70: introduces themself and the purpose,
but does not check the doctor has time.
product_knowledge — 40: cannot answer the doctor's basic product questions. 70: answers them, with one gap
the rep notices and offers to follow up.
scientific_accuracy — Scored as scientific DISCIPLINE, because you are not given the approved product
material: you cannot tell whether a claim is true, only whether the representative supported it.
40: makes at least one specific claim (a number, a comparison, "safer", "works faster") with nothing behind
it, or answers a challenge by repeating the claim. 70: ties every specific claim to a named source; one
claim is stronger than it should be, or one challenge is met with vague reassurance instead of "I will come
back to you with the data". Do NOT mark a claim wrong from your own knowledge of the product.
objection_handling — 40: ignores or argues with the objection. 70: acknowledges it and answers it once,
without checking it was resolved.
response_relevance — 40: answers questions the doctor did not ask; the objection is still open at the end;
the turns would read the same whatever the doctor had said. 70: each turn answers the doctor's last one and
the objection is addressed directly at least once; one turn drifts into a prepared pitch or half-answers a
follow-up.
communication — 40: long, unclear or interrupting turns. 70: clear and polite, one turn too long.
closing — 40: no next step agreed. 70: proposes a next step but does not confirm it.

overallScore is your overall judgement, not an average.

Reply with exactly this JSON and nothing else:
{"overallScore": 0-100 integer,
 "dimensionScores": {"opening": int, "product_knowledge": int, "scientific_accuracy": int,
   "objection_handling": int, "response_relevance": int, "communication": int, "closing": int},
 "strengths": [{"dimension": one of the seven names, "title": short label, "detail": one or two
   sentences, "turnIndex": the [n] of the turn}],
 "improvements": [same shape as strengths],
 "suggestedModules": [{"moduleId": copied exactly from AVAILABLE MODULES, "dimension": one of the seven
   names, "reason": one sentence}],
 "summary": two or three sentences to the representative}
```

```json
{ "temperature": 0, "maxTokens": 2000 }
```

**Prediction #6 applies to this feature most:** every flow times out at 20 s, and this is the longest
output of the five over the longest input. If the first real analyses time out, the remedy is a
`timeoutMs` for `ai_coach` in the gateway — not a smaller `maxTokens`, which would truncate the JSON.
