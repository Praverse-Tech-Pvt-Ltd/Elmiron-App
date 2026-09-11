
### MR-27 E1 — `FE-W40`: what an MR sees when they cold-start with no signal

**A decision, not a task.** Nothing below is implemented. The reviewer's lean is option C and
the argument against it is stated with it, because it is the one most likely to be adopted
without examining what it costs.

#### The situation

`today` is derived from the pull's `serverTime` and is not persisted. On a cold start with no
signal `summariseDay` has no day to summarise, and Today renders *"Could not load your day"*
over a store that holds every visit. The visits are there. The DATE is not.

This is `MR-15 A2` working: the territory's day comes from the SERVER's clock, never the
handset's, because an app that guesses the date from the device files visits on the wrong day.
That rule was earned — it is the same thread as the 5½-hour render.

And it is routine, not an edge case. A rep who opens the app in a basement on a Tuesday
morning is not an unusual user; it is the scenario the offline work exists for.

#### The options

**A. Render nothing, as today.** The app says it cannot load the day and shows none.

*For:* asserts nothing the server did not say. Cannot file a visit on the wrong day. Zero work.
*Against:* **useless exactly when it is opened.** The rep holds a phone with their whole day on
it and is shown an error. The most likely outcome is that they stop trusting the app, which is
the failure this project can least afford. It is also, quietly, the most expensive option: the
cost is borne by the rep, every time, and never appears in a changelog.

**B. Use the device clock when the server's is unavailable.** Fall back to `new Date()`.

*For:* trivial, and right almost always — a handset's clock is usually correct.
*Against:* **it is the defect MR-15 A2 exists to prevent, reintroduced behind a condition.**
"Almost always" is the problem: it fails on the phones whose clocks are wrong, silently, by
putting a visit on the wrong day — and a wrong-day visit is not visibly wrong to anyone.
`45007` exists because device clocks drift. **Not recommended, and named so it is not proposed
again as an obvious shortcut.**

**C. Persist the last `serverTime` and show the day as of the last sync, WITH its age.**
*The reviewer's lean.* Store `serverTime` with the instant it arrived; on a cold start, render
the day it implies and label it — *"Your day as of 07:40 this morning"*, or *"last synced
yesterday 18:20"*.

*For:* the rep gets their list. It asserts nothing the server did not say — the server DID say
that day, at that moment, and the label makes the "when" part of the claim rather than hiding
it. Strictly better than B: anchored to a server instant instead of the handset's opinion.

*Against, and this is the part to weigh:*
- **It is still the device clock, one step removed.** Deciding whether the stored day is still
  *today* requires knowing how much time has passed, which only the handset can tell you. A
  phone whose clock jumped forward two days will confidently render a stale day and label it
  with a stale age. The anchoring narrows the failure; it does not remove it.
- **Crossing midnight is the hard case, and it is common.** A rep who last synced at 18:20 and
  opens the app at 07:40 the next morning is shown YESTERDAY'S day. Correctly labelled, and
  still the wrong list — and "yesterday's visits, labelled yesterday" is a subtler wrong than
  an error message, because it is actionable and actionably wrong.
- **A label is not a control.** Every session of this project has found copy that was true and
  unread. "As of 18:20" sits above a list that looks exactly like a live one.

**D. Persist the day AND a staleness bound.** As C, but the app stops showing a day once the
anchor is older than an agreed limit, falling back to A.

*For:* keeps C's benefit for the case that matters — the morning of a day that started with a
sync — and bounds the failure C cannot fix. The midnight problem becomes explicit: if the
anchor is from a previous territory day, do not render it.
*Against:* needs a number nobody has yet, and a second decision about what to show past the
bound. More work than C and it is the work that makes C safe.

#### What is actually being decided

Not "show or hide". It is: **how stale may a server answer be before the app stops repeating
it, and what does the rep see at that point?** Every option above is a different answer to that
one question, and A and B are the two ends of it.

#### Engineering's recommendation

**D, with the bound set at the territory day boundary** — render the persisted day while the
anchor falls on the same territory date, and fall back to A's message once it does not. It
takes C's benefit, removes the failure C is worst at (the overnight case, which is precisely
the morning-with-no-signal scenario this is for), and needs no new number: the boundary is
`dayIn(anchor, zone)` versus `dayIn(anchor + elapsed, zone)`, which `territory-day.ts` already
computes.

It still leans on the handset for elapsed time. That is unavoidable for any option except A,
and it should be written down rather than discovered: **with no server clock, some device-clock
dependence is the price of rendering anything at all.** The question is how much, and D buys
the least.

#### Verification when it is built

Both sides, and the boundary chosen to expose the defect (the 11 September rule):
an anchor from earlier the same territory day renders the day with its age; an anchor from the
previous territory day renders NOTHING and says why; and the pair must straddle the
`18:30Z` IST midnight, not sit comfortably either side of it.
