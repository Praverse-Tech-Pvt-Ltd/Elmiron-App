# Restoring the database is a compliance event

**Not a routine operation.** On most projects a point-in-time restore is an
inconvenience with a bit of lost work. On this one it silently rewrites the record of
what a doctor agreed to, and it can leave audio in storage that nothing on earth has
a lawful basis to hold.

Read this before you restore, not after.

---

## Why a restore breaks this system specifically

Two facts from Supabase's own documentation, each unremarkable, hazardous together:

> "When you delete one or more objects from a bucket, **the files are permanently
> removed and not recoverable.**"
> — https://supabase.com/docs/guides/storage/management/delete-objects

> "**Database backups do not include objects you store via the Storage API**, as the
> database only includes metadata about these objects. Restoring an old backup does
> not restore objects you deleted after that backup."
> — https://supabase.com/docs/guides/platform/backups

So a restore rewinds **the database** and not **the objects**. The two halves of
every recording come apart, in both directions at once.

### Direction one — the database remembers audio that is gone

A restore to a point before a consent withdrawal:

- **Un-withdraws the consent.** The withdrawal row disappears. The ledger now says
  the doctor consented and never withdrew.
- Leaves the audio genuinely destroyed, because objects do not come back.
- Leaves `recordings` rows pointing at objects that no longer exist.

The first of those is the serious one. The consent ledger exists to prove what a
doctor agreed to, and a restore has just made it lie.

### Direction two — storage holds audio nothing knows about

The mirror case, and the one that is a live breach rather than a stale row.

An upload that completed **after** the restore point has its `recordings` row rewound
away while the object stays in the bucket. What is left is audio with:

- no consent record covering it,
- no retention clock governing it,
- and no way to acquire either after the fact, because the rows that would have said
  whose visit it was are gone.

It will sit there until somebody notices. Nothing will notice, because the only thing
that walks the bucket is the reconciliation below.

### Why `storage.objects` cannot tell you any of this

`storage.objects` is an ordinary table in the same database. A restore rewinds it
alongside `public.recordings`. Comparing the two afterwards compares two things that
travelled back together and finds nothing wrong.

The object store is the only witness that did not move. Every check here goes over
HTTP for that reason.

---

## The procedure

### 1. Before you restore

- Write down the restore target time. You will need it for the reconciliation note.
- Understand that **no audio uploaded after that time will survive as a usable
  recording**, whatever the restore does to the database.

### 2. Restore.

### 3. Reconcile — immediately, before letting anyone back in

```bash
# Dry run first. Always. It changes nothing and prints exactly what it would do.
pnpm --filter @elmiron/api reconcile:restore

# Then, once the dry run's numbers make sense:
pnpm --filter @elmiron/api reconcile:restore -- --apply --note "PITR to 2026-08-14T09:00+05:30"
```

What `--apply` does:

| Finding | What happens |
| --- | --- |
| A live row whose object is missing | Row marked destroyed with reason `restore_reconciled`; derived transcripts and analyses removed; a destruction-log row written. |
| …and it was a **recording** | The visit is additionally **quarantined**. |
| An object with no live row | The object is **deleted from storage** and a finding is recorded. |

`restore_reconciled` is deliberately not `retention` and not `withdrawal`. The cause
is genuinely unknown — absence cannot distinguish a ninety-day purge from a
withdrawal — and filing a guess in a compliance record is worse than filing the
truth that you do not know.

### 4. Deal with the quarantines

```sql
select q.visit_id, q.reason, f.doctor_id, f.created_at
  from public.visit_audio_quarantine q
  join public.restore_reconciliation_findings f on f.id = q.finding_id;
```

A quarantined visit issues no upload grant. That is the point: the system stops
behaving as though consent stands.

**The withdrawal is not re-created, and this is deliberate.** The consent ledger's
entire value is that every row in it is a real thing a real doctor really did. A row
this system invented because it inferred one would be worth less than no row at all,
and it would be indistinguishable from a genuine one forever afterwards. So the
system refuses to guess and puts a named human in front of the question instead.

Clearing one requires a person and a reason, and the clearance is append-only:

```sql
select public.clear_audio_quarantine(
  '<visit-id>',
  'Spoke to Dr <name> on 16 Aug; consent confirmed as standing. — <your name>'
);
```

**The quarantine is on the visit, not the doctor.** The doctor is the safer scope and
it is recorded on the finding for exactly that reason — widening it is one insert.
But a missing object can also be an ordinary storage fault, and blocking every future
recording for a doctor on that evidence turns a possible compliance question into a
certain outage across their whole territory. If the pattern of findings suggests the
doctor withdrew broadly, widen it by hand. That is a judgement, so a person makes it.

### 5. Check retention did not stall while you were busy

```bash
pnpm --filter @elmiron/api check:purge-health
```

A restore rewinds `audio_purge_runs` too, so the worker's history may now show a gap
that never happened, or hide one that did.

---

## What the reconciliation cannot do

Stated plainly, because a runbook that implies completeness it does not have is worse
than no runbook.

- **It cannot recover a withdrawal.** The consent row, the destruction-log row and
  `withdrawn_at` all lived in the database and all went back together. The only
  surviving trace is the object's absence, and absence is not evidence of intent.
- **It cannot tell a restore artifact from an ordinary storage fault.** A missing
  object looks the same either way. Everything here errs toward denial for that
  reason.
- **It cannot see anything the object store has not yet made visible.** If the bucket
  listing is eventually consistent, a very recent object may be missed. Run it twice,
  an hour apart, if the restore was recent.
- **It says nothing about Supabase's own infrastructure.** Whether the platform keeps
  a copy of a "destroyed" object in S3 versioning, a soft-delete window or a
  sub-processor's backup is not in the public documentation. That is a **DPA
  question, not an engineering one**, and it is on the escalation list.
