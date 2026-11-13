# The console: a guide for managers and admins

**For field managers and company admins.** The console is a web app. Sign in with the email and
password your admin gave you. The left-hand menu shows only the pages your role can use; on a phone it
sits behind the **Menu** button at the top.

**Two rules hold everywhere.** The database decides what you can see, so a page never shows another
company's data, and a manager sees only their own team. Anything that changes what the AI says, or what
reps learn from, needs **two different admins**: one writes or submits, the other approves.

---

## For managers

### Plan a rep's day
Choose the rep and the day, add doctors in visit order, and **Save plan**. The rep sees the plan on
Today. You plan for the reps in your territory; planning outside it needs an admin's grant (see
"Planning access").

### Unplanned visits
A rep can add a visit that was not planned, with a reason. It needs no approval in advance. You see it
afterwards on the same page, marked **Unplanned**.

### Call reports
Reports waiting for your review, newest first: the rep, the doctor, the visit date, what happened and
the next step. Open one to read it in full, then approve it. Several can be approved together.

### The team's day
Who started and ended their working day, when, and with what note. If a rep ended a day by mistake,
**reopen** it with a reason; the rep's app tells them.

### Team exceptions and visit coverage
Exceptions list what needs a look, in plain words: missed visits, a phone that has not synced, a high
rate of refused items, an unusual consent pattern. A consent pattern is a data-quality signal, never a
judgement of the rep. **Visit coverage** shows planned against attended visits per rep. Neither page
ranks reps.

### Live location (if your company uses it)
Each rep's newest position during working hours, and today's list. The map view appears when your
company has added a Google Maps key.

### Course assignments
Assign a published course to a rep, with an optional due date, and see who has started and finished.

### Coaching queue
Exception-first coaching items. It stays empty while visit recording is switched off.

---

## For admins

### Users & roles
**Add a user**: full name, email (typed twice), role (Rep, Field manager or Admin), territory and who
they report to. The person receives their sign-in details. From the same list you can change a role,
move someone, **reset a password**, or deactivate an account. Every change asks for a reason and goes
into the audit log.

### Territories
Your company's territory tree, with each territory's **working hours** and time zone. Check-ins
outside working hours are flagged, and live location runs only inside them. **Add beneath** creates a
child territory.

### Planning access
Grant a manager the right to plan for reps outside their own territory, from a start date to an end
date, and revoke it. You cannot grant it to yourself.

### Consent versions and the live location notice
The consent notice doctors see, and the privacy notice reps accept before live location starts. A new
version applies from when it is published; earlier records keep the version they were made under.

### Content (two admins)
- **AI prompts**: what each AI feature is told to do. One admin writes a **New prompt**; a different
  admin reads it and approves it with an attestation, or rejects it with a reason. A feature with no
  approved prompt refuses every request.
- **Knowledge**: the approved product material Product questions answers from. An operator loads the
  file; an admin approves it here.
- **Practice doctors and scenarios**: who the AI doctor plays and what the rep practises.
- **Practice feedback**: the AI coach's feedback on practice sessions.
- **Courses**: publish a loaded course so it can be assigned, or retire one. Managers can read this
  page; only admins change it.

### Side-effect flags
Possible side effects reps have flagged, newest first, with the statutory deadline for each. The list
never shows the reported text. Open a flag to read it, giving a reason; every read is recorded in the
audit log. Until your company names a pharmacovigilance contact (Q-13), the admins are where these
flags arrive. Check this page every working day.

### Audit log and retention
- **Audit log**: who read or changed what, and when, with filters. It cannot be edited.
- **Retention & purge**: how many recordings and voice notes exist, when each is due to be deleted
  (90 days), and whether the deletion job is keeping up.

---

## Done by an operator, not in the console

These are run from the operator's computer with the documented commands (`docs/HANDOVER.md`):

| Task | How |
| --- | --- |
| Load territories and reps | `docs/operator/territory-template.xlsx` and its loader |
| Load doctors and clinics | `docs/operator/doctors-clinics-template.csv` and its loader |
| Load the product catalogue | `docs/operator/catalogue-template.md`, `load-catalogue.mjs` |
| Load a course (text and videos) | `docs/operator/course-template.md`, `load-course.mjs`; then publish it in **Courses** |
| Load approved product material | `docs/operator/knowledge-template.md`, `load-knowledge.mjs`; then approve it in **Knowledge** |
| Translations (Hindi, Marathi) | `docs/operator/translations.md`: export a file, your translators fill it, import it |
| Switch AI features on or off | `ai-switches.mjs` (`docs/ai-platform/DAY-ONE.md`) |
