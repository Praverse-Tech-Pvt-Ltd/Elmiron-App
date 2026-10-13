---
# THE COURSE TEMPLATE (W2-H A1). Copy this file, rename it, and replace everything below with your own
# course. Then check it:      node services/api/scripts/load-course.mjs your-course.md
# and load it as a DRAFT:     see docs/HANDOVER.md, "Content" (W2-I: DAY-ONE.md has no such section).
#
# The loader REFUSES this file as it is: the title below starts with EXAMPLE, so the example can never
# be loaded by mistake. Lines starting with # inside this block are notes and are ignored.
#
# A VIDEO in a lesson (BE-W210): make a clip from a long recording with
#     pnpm video:trim --in <source.mp4> --from HH:MM:SS --to HH:MM:SS --out clips/my-clip.mp4
# then put these lines right under the lesson's ### title (with minutes: if you use it), before its text:
#     Video: clips/my-clip.mp4
#     Poster: clips/my-clip.jpg
# Paths are relative to this file. The clip is uploaded when you load with --write. Clinical content needs
# the client's medical/regulatory approval before the course is published: docs/operator/lesson-videos.md.
course: EXAMPLE — Storage and handling basics
# market: the name of one of your company's markets (for example India), or "any" for every market.
market: any
# product: optional — a product's brand or generic name, if the course is about one product.
product:
summary: How to keep samples and stock in good condition between the depot and the clinic.
---

## Keeping stock in good condition

### Why storage matters
minutes: 4

A product that has been stored badly can stop working as it should, even when the pack looks normal.
This lesson explains what "stored badly" means for the samples and stock you carry, and why it matters
to the doctors you visit.

Write the lesson in plain sentences. Each "###" line starts a new lesson; each "##" line starts a new
module. The order in this file is the order a rep sees.

### Temperature on the road
minutes: 5

Your car is not a store room. On a warm day the inside of a parked car can be far hotter than the
label allows. Keep samples out of direct sun, never leave them in a parked car, and use the cool bag
your company provides.

## Handing samples over

### Recording what you hand over
minutes: 3

Every sample you hand over is recorded in the app on the visit, with the batch number. This is how the
company can trace a batch if it is ever recalled.
