# Escalations — end of week 3

Three items that engineering cannot fix. Each needs a named person and a date.
Copy, fill the brackets, send today.

---

## 1. PV and privacy sign-off — five weeks to week 7

**This is the most likely cause of a missed date.** It has been open since week 1.

**To:** [name — pharmacovigilance] and [name — privacy/legal]
**Cc:** [client sponsor]
**Subject:** Written position needed by [date] — adverse-event handling in the MR app

---

We are building a mobile app for medical representatives. It records doctor visits,
with the doctor's consent, and transcribes them.

There is a conflict between two obligations, and we need a written position from both
of you before we build the adverse-event pipeline. Engineering starts that work in
**week 7**, which is [date].

**The conflict, in short:**

The Indian Pharmacopoeia Commission's *Pharmacovigilance Guidance for MAHs* (v2.0,
18 Jan 2024) §2.2.1.5 requires a marketing authorisation holder to *"regularly screen
relevant websites or digital media … under their management or responsibility"* for
adverse events. Our app is such a medium, and doctors discuss adverse events with
representatives. So we must screen it, and §2.8 gives us **15 calendar days from
receipt** for a serious event.

But §2.6 requires a valid case report to contain an **identifiable patient**.
Meanwhile India's DPDP Act 2023 s.6(1) caps collection at what is *necessary* for the
stated purpose — and a patient mentioned in a recording is a Data Principal we have no
consent from and no lawful basis to process.

**So one obligation says retain an identifiable patient; the other says do not.**

**What we need from you, in writing:**

1. Does "receipt" start at the moment the recording reaches our server, or when a
   human reviews it? This determines the SLA the system enforces.
2. What is the minimum patient information we may retain to file a valid case report,
   and what must be redacted before storage?
3. Who is the named PV officer who receives flagged events, and what is their
   response-time commitment?
4. Do you accept that our audit log shares the caller's transaction — meaning a
   rolled-back read leaves no audit row? Our position is that this is proportionate,
   because through the API a rollback returns an error and no data reaches the client.
   We would like that accepted or challenged now rather than in week 11.

Full detail is in `mr-app-plan.md` §0.4, with sources and confidence levels.

**We need a written answer by [date — suggest two weeks out].** Without it, week 7
slips, and everything after it slips with it.

---

## 2. Working hours per territory — needed before week 12

**To:** [client operations contact]
**Subject:** Field working hours per territory — data needed by [date]

The app records MR visits only within defined working hours, and refuses capture
outside them. That refusal is deliberate: it is what keeps location tracking
proportionate and defensible.

The system currently has **no working-hours data**, so in a real deployment every
capture would be refused. This is loud by design rather than silent, but it means we
cannot run a pilot without it.

**We need, per territory:** shift start time, shift end time, working days, and any
territory-specific exceptions.

The pilot is in **week 12**. Please send by [date — suggest week 6] so it is loaded
and tested rather than entered under pressure.

---

## 3. Contract I3 — transcript schema, one week overdue

**To:** [AI/ML developer]
**Cc:** [reviewer]

The transcript schema (contract I3) was due end of week 2 and is now a week late.
Backend has a provisional placeholder in `packages/core`, explicitly labelled as a
compile target for the mock — **not the contract**.

Backend builds the storage layer against it in week 8. Frontend needs it for the
coaching feed.

**One of two things by [date — suggest three working days]:**

1. **The schema published to `packages/core`** — segments, timestamps, speaker labels,
   per-word confidence where available, language tags. Provider-agnostic: swapping
   vendors later must not change the shape.
2. **A written statement that the bake-off failed** and the AI layer should be cut,
   with the measured word error rate.

**Option 2 is a completely acceptable answer.** `mr-work-split.md` §0.1 says so
explicitly: delivered in week 2 or 3, it is a good outcome. Delivered in week 9, it is
a project failure. Nobody will be criticised for the number being bad — only for it
arriving late.

If the blocker is access to real MR audio rather than the analysis, say so and it
becomes a client escalation, not an engineering one.

---

## Why these three, and why now

None of them can be fixed by writing code, and each has a lead time longer than the
notice we are giving it.

Item 1 has been open since week 1 and blocks a hard requirement. Item 2 looks trivial
until someone realises it needs a person at the client to collect it. Item 3 is one of
five interface contracts and it is the one flagged in the plan as *"the
highest-consequence contract in this project."*

**Each needs a named person and a date.** "The team will look at it" is how all three
arrived at week 3 unresolved.
