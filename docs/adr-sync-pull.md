# ADR — `sync_pull`

**Status:** proposed, for the reviewer. **Date:** 7 September 2026. **Author:** FIX-09.
**This is a decision record, not an implementation.** No code was written.

---

## 1. The problem

Offline sync is half-built. `sync_push` exists, is granted to `authenticated`, and has 40
tests. **`sync_pull` exists on neither side**: no function, no view, no table
(`select count(*) from pg_proc where proname='sync_pull'` → `0`), and
`apps/field/src/sync/` is entirely outbox and push — `grep` for `syncPull`, `since` or
`hasMore` across it returns nothing.

The contract, however, is fully specified:

```ts
SyncPullRequest  { since: IsoDateTime | null, entities: SyncEntity[] | null }
SyncPullResponse { changes: [{ entity, entityId, deleted: boolean,
                               payload: object | null, updatedAt }],
                   serverTime, hasMore }
```

`services/mock` implements it with `deleted` always `false`, `hasMore` always `false`, and
a **hard-coded `serverTime`**. So the frontend has been built against a pull that has never
produced a delete, a second page, or a moving clock.

**Why it matters beyond FE-G2.** The app promises the MR a notification "when tomorrow's
visits are ready, and when a manager changes them". Without pull it can never learn that
either happened. Today's Today screen is honest about everything except that it will never
update.

### 1.1 Two holes in the contract as written

**Hole 1 — `hasMore` cannot be honoured by a bare watermark.** With many rows sharing an
`updated_at`, a page boundary inside that group is unresolvable: the next `since` either
repeats rows or skips them. There is no cursor field to carry the position.

**Hole 2 — the watermark gap.** If the client stores `serverTime` as the next `since`, a
row committed *during* the pull but stamped earlier is **missed permanently**. Under
`READ COMMITTED` a transaction that began before the pull can commit after it, with an
`updated_at` below the watermark the client has already advanced past.

---

## 2. The design questions

### 2.1 Watermark vs cursor

| option | trade-off |
| --- | --- |
| **(a) Bare watermark** (`since` only) — what the contract says | Simple, stateless, and **cannot page**. Fails hole 1 |
| **(b) Composite cursor** `(updated_at, id)`, opaque to the client | Total order, so paging is exact. Client stores a token rather than a timestamp. Contract change |
| **(c) Monotonic sequence column** — a `bigint` from a sequence, bumped on every write | Simplest correct paging, and it also closes hole 2 because commit order and sequence order agree. Costs a column and an index on every synced table, and a trigger to maintain it |

**Recommendation: (b), a composite `(updated_at, id)` cursor.** It closes hole 1 with no
schema change, and `id` is already unique so the ordering is total. (c) is strictly better
for correctness and materially more expensive: every synced table gains a column, an index
and a trigger, and the AI layer's tables would need them too. If hole 2's mitigation in
§2.2 proves insufficient in practice, (c) is the escalation.

### 2.2 Not losing a row committed mid-pull

| option | trade-off |
| --- | --- |
| **(a) Overlap window** — the client re-requests the last N seconds each time | Trivial. Costs duplicate rows the client must handle idempotently, and N is a guess that is wrong on a slow network |
| **(b) Serve the pull from one snapshot** — `repeatable read`, and return the transaction's own `snapshot` boundary as the next cursor | Correct: nothing committed after the snapshot is inside it, and nothing inside is missed. Costs a longer-lived transaction |
| **(c) Sequence column** — as §2.1(c). Commit order is the ordering key | Correct and cheap to read. Expensive to add |

**Recommendation: (b).** The reads are short and the correctness is exact rather than
probabilistic. **(a) should be explicitly rejected**: an overlap window is a guess that
silently loses data when the guess is wrong, which is the failure mode this project has
been removing everywhere else.

### 2.3 How deletes are represented

This is where the product's retention promise collides with sync.

| option | trade-off |
| --- | --- |
| **(a) Tombstones** — a row survives deletion carrying `deleted: true` | The client can be told. But **a tombstone is a record of a deleted thing**, and this product destroys audio on a 90-day schedule and promises the row goes with the object. A tombstone table would keep an id and a timestamp for something the retention worker was asked to erase |
| **(b) Absence** — the row simply stops appearing | Nothing is retained. But a client that only ever receives changes **cannot distinguish "deleted" from "not changed"**, so it keeps showing the row forever |
| **(c) Tombstones with their own retention** — a tombstone is kept only as long as the longest plausible offline period, then destroyed | Bounded retention, and a client offline longer than that window must do a full re-sync. Needs a full-resync path, which is extra work |

**Recommendation: (c), with the tombstone window set from the same threshold machinery as
everything else.** (b) is not viable — a stale row on a handset is exactly the "displaying
something no server said" failure this product refuses elsewhere. (a) conflicts with the
retention promise for the tables that carry audio.

**This one needs a human**: the tombstone window is a retention decision, and a tombstone
for a *consent* record is a legal question, not an engineering one.

### 2.4 RLS scoping

| option | trade-off |
| --- | --- |
| **(a) Plain table reads, RLS filters** | Free, consistent with `visits`. But nine tables have RLS forced and **no policies at all** and are unreadable this way — `analyses`, `consent_records` and `analysis_overrides` among them |
| **(b) `SECURITY DEFINER` RPC applying `visible_user_ids()`** | Works for every table, matches how those nine are already read, and can write the audit row that reads of `consent_records` and `analyses` are required to produce |

**Recommendation: (b).** It is not really a choice: a pull that carries consent records or
analyses **must** audit each read, and Postgres has no SELECT trigger. See §2.6.

### 2.5 What happens when a row leaves the caller's scope

An MR is reassigned; a territory moves; `is_active` flips. Rows that were theirs are not
any more.

| option | trade-off |
| --- | --- |
| **(a) It arrives as `deleted: true`** | The handset drops it. But `deleted` now means two different things — destroyed, and no longer yours — and the client cannot tell them apart, which matters because one is a retention event and one is not |
| **(b) Nothing arrives; it stops appearing** | The handset **keeps showing a doctor, a visit and a beat plan that are no longer the MR's**, indefinitely, with no event to correct it |
| **(c) A distinct `reason` on the change** — `deleted` \| `out_of_scope` | The client can drop the row and say why. Costs a contract field |

**Recommendation: (c).** This is **a product decision as much as a technical one**, and it
should be taken by a human: (b) is a privacy problem — an MR who loses a territory keeps
that territory's doctor list on their phone until they reinstall — and (a) tells them the
record was deleted, which is false and, for a consent record, dangerously so.

### 2.6 RPC or table read

FIX-08 established that a **table** path can only ever refuse with RLS `42501`, so every
policy failure reaches the MR as one message, whereas an **RPC** can raise a specific
actionable code — which is how `45001`–`45004` came to exist.

**Recommendation: RPC.** Three reasons, and the first is decisive: the nine policy-free
tables are unreadable any other way; reads of `consent_records` and `analyses` must write
an audit row first; and a pull has real refusals worth distinguishing — a cursor from a
future version, a cursor older than the tombstone window (which means "do a full
re-sync", an instruction the client can act on), and a deactivated user.

---

## 3. What has to change in `packages/core`

The contract as written cannot be implemented correctly.

- `SyncPullRequest.since` → an opaque `cursor: string | null`. A timestamp cannot express
  a position inside a group of rows sharing one.
- `SyncPullResponse` gains `nextCursor: string | null`. `hasMore` alone is unactionable
  without it.
- `serverTime` should stop being the thing the client stores. It is the hole-2 trap: it
  looks like a watermark and is not one.
- `changes[].deleted: boolean` → `changes[].reason: 'updated' | 'deleted' | 'out_of_scope'`
  (§2.5).
- New refusal codes in the FIX-06 error contract: at least *cursor expired, re-sync* and
  *cursor not recognised*.

---

## 4. Revised estimate

FIX-04 put S5 at 23 half-days. Broken down, with what could ship alone:

| piece | half-days | ships alone? |
| --- | ---: | --- |
| Contract changes (§3) | 2 | No — everything depends on it |
| `sync_pull` RPC: cursor, snapshot, RLS scoping, audit | 8 | **Yes** — updates-only pull |
| Tombstones + their retention + full-resync path | 5 | No — needs the above |
| `out_of_scope` handling (§2.5) | 2 | **Yes**, after tombstones |
| Client pull consumer in `apps/field/src/sync/` | 5 | No |
| `FE-W18` conflict resolution | 4 | No |
| `FE-W19` offline day on a handset (FE-G2) | 3 | No |
| **Total** | **29** | |

**Is an updates-only pull worth shipping first?** **Yes, and it is the recommended first
increment** — but only if the client is explicit about what it does not do. It delivers the
product promise that is currently broken: an MR learns that a manager changed tomorrow's
visits. It does not let a handset learn that anything was removed, so a deleted or
reassigned record persists on the device until a full re-sync.

That is acceptable **only** if the app says so. Shipping an updates-only pull silently is
worse than not shipping it: an MR who sees their list updating will reasonably conclude it
is current, and a stale doctor on a beat plan is a wasted visit rather than a cosmetic bug.

**The estimate rose from 23 to 29** because §2.3 and §2.5 turned out to be two pieces of
work rather than one line.

---

## 5. Questions that need a human, not an engineer

1. **The tombstone window** (§2.3). How long may a record of a deleted thing be kept, and
   does a **consent** tombstone conflict with the withdrawal promise? Legal, not technical.
2. **What an MR keeps when they lose a territory** (§2.5). Privacy question with a product
   answer.
3. **Whether an updates-only pull may ship** (§4), given it must tell the user it cannot
   see deletions.
4. **Whether consent and analyses belong in the pull at all.** Every such read writes an
   audit row — per pull, per MR, per day. That is a volume and a compliance decision before
   it is a schema one.
5. **The offline consent question from FIX-02 §3 is upstream of all of this.** If consent
   capture cannot be queued offline, a pull that carries consent records is solving a
   problem the product does not have yet.
