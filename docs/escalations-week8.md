# Escalations — sprint 8

Two items. One is new and was not possible to write before the storage layer existed;
the other is `escalations-week3.md` §3, now five sprints overdue and re-drafted with
the sentence that should get a date attached to it.

The three from week 3 are still open and still need names. This file does not replace
that one.

Copy, fill the brackets, send today.

---

## 1. Supabase — infrastructure-level retention of deleted storage objects

**New. Opened sprint 7, when the retention worker was built. Needed before the pilot.**

**This is a DPA question, not a support question.** The answer has to be contractual,
because the 90-day retention promise is made on privacy grounds — under DPDP
minimisation, for audio of a consultation — and a promise like that is either
literally true or it is not. A forum reply does not settle it.

**Half of it is already answered publicly, so do not ask that half.** Supabase's own
documentation states:

> "When you delete one or more objects from a bucket, the files are permanently
> removed and not recoverable."
> — supabase.com/docs/guides/storage/management/delete-objects

> "Database backups do not include objects you store via the Storage API. Restoring
> an old backup does not restore objects you deleted after that backup."
> — supabase.com/docs/guides/platform/backups

Together those confirm the **API-level** behaviour, and our own test confirms the
object 404s after the purge runs. What is undocumented, and what this letter asks
about, is **infrastructure-level** retention underneath that API.

**To:** [name — Supabase account manager or privacy@supabase.io]
**Cc:** [client privacy contact], [client sponsor]
**Subject:** DPA question — infrastructure retention of deleted Storage objects, project [ref], ap-south-1

---

We operate Supabase project [ref] in `ap-south-1`. We are preparing a pilot that
processes audio recordings of medical consultations, and we make a contractual
commitment that this audio is destroyed 90 days after capture.

Your documentation confirms that deleting an object through the Storage API removes
it permanently and that database backups do not contain Storage objects. We have
verified the API behaviour ourselves: after our retention worker deletes an object,
a subsequent `GET` returns not-found.

**We need written confirmation of what happens beneath that API.** Specifically:

1. **Object versioning.** Is versioning enabled on the underlying S3 bucket for our
   project? If so, does a delete through the Storage API create a delete marker while
   retaining prior versions, and for how long?
2. **Soft-delete or recycle window.** Is there any period after an API delete during
   which the object remains physically recoverable by Supabase, by AWS, or by a
   sub-processor — whether for support, undelete, or operational reasons?
3. **Sub-processor backups.** Do any sub-processors listed in your DPA retain copies
   of Storage objects independently of the Postgres backups referenced above, and
   what is their retention period?
4. **Region confinement.** Do Storage objects for an `ap-south-1` project, including
   any replica or backup copy, remain within `ap-south-1` at all times?
5. **Written maximum.** Following an API-level delete, what is the maximum elapsed
   time after which no copy of the object exists in any system you or your
   sub-processors operate?

Question 5 is the one we need most. We are asserting a 90-day destruction guarantee
to a regulator-facing counterparty and we would like the number that makes it true,
or a statement that it cannot be given.

If any of this is already covered by a clause in the DPA, a pointer to the clause is
a sufficient answer.

We would like a written response by [date — allow two weeks before the pilot].

[name], [role]
[company]

---

**Why this needs an answer before the pilot, in our own terms:** if a deleted object
survives in versioning or a sub-processor backup for any period, our 90-day claim is
not literally true, and we would rather change the claim than make one we cannot
support. That is a decision the client has to be given the chance to make.

---

## 2. Contract I3 — restated, five sprints overdue

Supersedes `escalations-week3.md` §3, which was sent when this was one week late.

**To:** [AI/ML developer]
**Cc:** [client sponsor], [reviewer]
**Subject:** Measured Hinglish WER on real audio — needed by [date], hard CI deadline 30 September

---

We need the bake-off result. To be precise about the ask, because it has been
misread as larger than it is:

**What is needed is a measured number on real audio, and a vendor decision.** Not a
working pipeline, not an integration, not a demo. Word error rate on 5–10 hours of
labelled MR–doctor audio, overall and on brand names specifically, for the candidate
vendors, plus which one you recommend and the transcript schema that goes with it.

**"The number is bad, cut the AI layer" is a successful outcome.** It was designed to
be. The whole point of running this in week 2 was that a bad answer delivered early
costs two weeks of one person, and the same answer delivered late costs the project.
We are at sprint 8.

**And here is what makes this different from the other three items outstanding:**
every sprint this answer is late is a sprint in which somebody may build against an
assumption it invalidates. The other escalations delay work. This one can make
finished work worthless retroactively.

The frontend sprint order was deliberately arranged so that nothing built so far
depends on the answer — offline core, capture, consent and reporting all stand
whichever way it goes. That protection runs out around FE-W9, which is when the
coaching feed would be built.

Two hard dates:

- **[date]** — the measured WER and a vendor decision, in writing.
- **30 September 2026** — CI goes red unless `TranscriptV1` exists in
  `packages/core`. That deadline is already committed and is not moving.

If the audio cannot be collected, say that instead, and say what is blocking it. An
honest "we cannot get real recordings" is also an answer we can act on — it means the
layer gets cut on the grounds that its viability was never measurable.

[name], [role]
