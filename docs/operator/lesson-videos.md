# Lesson videos — from a conference recording to a rep's phone (`BE-W213`)

**For the owner.** The client's 15 conference videos (doctors explaining IC/BPS, PPS, cystoscopy,
phenotyping…) are 0.6–4.2 GB each — far too big for a phone or for Supabase Storage. So you cut out the
**sections** a rep should watch, each becomes a small phone-sized clip, and each clip sits **inside a
lesson**, above its text, in the app. Written 14 October 2026 (decision of that day: Supabase Storage,
trimmed sections, played in the app).

Everything below is a command or a console page. None of it is SQL, and nothing is uploaded until step 5.

## Once: the tools

* **ffmpeg** (it cuts and re-encodes): `winget install Gyan.FFmpeg`, then open a **new** terminal.
  `ffmpeg -version` should answer. The trim command says so plainly if it cannot find it.
* The usual project setup (`docs/START-HERE.md`). For a local rehearsal, the stack running
  (`pnpm db:start`).

## The path, end to end

| # | Step | Command / page | What you should see |
| --- | --- | --- | --- |
| 1 | **Download** the source video from the client's OneDrive to a folder **outside** this repository, e.g. `C:\videos\source\` (in OneDrive: right-click → Download, or "Always keep on this device"). Watch it and write down where each section starts and ends | — | a 0.6–4.2 GB `.mp4` on disk |
| 2 | **Trim** one section into a clip | `pnpm video:trim --in "C:\videos\source\ICBPS-panel.mp4" --from 00:12:00 --to 00:21:30 --out "C:\videos\clips\phenotyping.mp4"` | `CLIP READY`, with its length, size (under 48 MB), resolution, and a poster `phenotyping.jpg` beside it. It prints the two lines for step 3 |
| 3 | **Add it to the lesson** in the course file (copy of `docs/operator/course-template.md`): right under the lesson's `###` title, with `minutes:` if you use it. Paths are relative to the course file, or absolute | see the example below | — |
| 4 | **Check** the course file — offline, writes nothing | `node services/api/scripts/load-course.mjs my-course.md` | `my-course.md is loadable: "…", 2 module(s), 6 lesson(s), 3 video(s)`. A missing clip, one over 50 MiB, or one a phone would not play is refused by line |
| 5 | **Load** it as a DRAFT — the clips are uploaded as you, the admin | PowerShell: `$env:LOADER_PASSWORD = '<your admin password>'`, then `node services/api/scripts/load-course.mjs my-course.md --write --url <address> --key <publishable key> --email <your admin email>` | `DRAFT written: …, 3 video(s) uploaded` |
| 6 | **Approval of the clinical content** — before step 7. See "Who must approve", below | — | written sign-off from the client's reviewer |
| 7 | **Publish** the version | the console, **Courses** → Publish (or `content-step.mjs publish-course "<course title>" --url … --key … --email …`) | Courses shows it Published, and its **Videos** column lists each video lesson with its length |
| 8 | **Assign** it | the console's **Learning** page | — |
| 9 | **See it on the phone** — in a build with `EXPO_PUBLIC_LEARNING=true` (the demo APK built with `-AllFeatures` has it) | Me → Learning → the course → the lesson → tap the picture | the clip plays in the lesson, with the phone's own controls and full screen; the text is underneath |

**The course-file lines** (step 3):

```markdown
### The four phenotypes of IC/BPS
minutes: 12
Video: clips/phenotyping.mp4
Poster: clips/phenotyping.jpg
Dr Rao explains how the four phenotypes are told apart. Watch the clip, then read the summary below.
```

`Poster:` is optional (the trim makes one; without it the player shows a plain frame). A lesson still
needs its text: the video is part of the lesson, not instead of it.

## What a rep sees

* **Poster first, tap to play.** Nothing downloads until the rep taps — opening a lesson to read it costs
  no video data. Native controls, full screen; no picture-in-picture and no playing in the background.
* **With no signal**, one calm line: the video needs a connection; the lesson's text is all there. It is
  not shown as an error. A clip that would not load says "did not load", with **Try again**.
* **Who can watch** is decided by the database, the same rule as the lesson's text: someone in the same
  company, once the version is published. The app gets a **one-hour signed link** for the clip, issued
  only to someone allowed to read that lesson; there is no public link to any clip, and another company's
  rep is refused (`services/api/tests/lesson-videos.spec.ts`).

## Who must approve — before a rep sees anything clinical

**These clips are clinical content**: doctors explaining a disease, in the company's training. **The
client's medical/regulatory reviewer must approve each clip and its lesson before the course is
published** (step 6). The trimmed clip on your disk is exactly what will be uploaded, so it can be
reviewed before step 5.

What the system enforces today, and what it does not:

* **Approved material** (the knowledge documents) and AI instruction sets need **a second admin** to
  approve them in the console — four eyes, enforced by the database.
* **A course is published by one admin**, with no second approval. Whether courses should also need a
  second admin is the open question **Q-21** (`docs/operator-inputs.md`, section 10). Engineering's lean
  there already says: yes, if courses carry regulated content. **Clinical videos are that case.** Until
  Q-21 is answered, the sign-off happens outside the system, and the admin publishes only once it is in
  writing. Nothing here invents a different rule.

## Fixing a mistake

* **A published version never changes** — its clips are frozen with its text, exactly like its words. To
  change a clip, edit the course file and load it again: that makes a **new draft version**; publish it,
  and the previous one is retired (a rep already part-way through keeps the version they started).
* **A clip cannot be replaced or deleted through the app, the console or the loader — by anyone.** If a
  clip must be removed from storage altogether (wrong content uploaded), that is an operator's act with
  the Storage dashboard or API, and a lesson that named it will then show "did not load". Tell
  engineering first.
* A load that failed part-way leaves its clips in the draft's folder, where no rep can read them; run the
  load again.

## Storage and bandwidth — how much fits

What `pnpm video:trim` produces (measured from its own maths, `services/api/tests/trim-video.spec.ts`):

| Clip length | Resolution | Size |
| --- | --- | --- |
| 1 minute | 720p | about 12 MB |
| 3 minutes | 720p | about 37 MB |
| 5 minutes | 720p | about 46 MB |
| 10 minutes | 540p | about 46 MB |
| 15 minutes | 480p | about 46 MB |
| 20 minutes | 360p | about 46 MB |
| over about 23¾ minutes | — | **refused**: cut it shorter, or into two lessons |

So **every clip of five minutes or more is about 46 MB**, and shorter clips are smaller. Two limits
matter on Supabase — **the figures are from memory, not measured: check them on Supabase's pricing page
before deciding:**

* **Storage.** Free plan: **1 GB in total** (all buckets) and **50 MB per file** → about **20 clips of
  five minutes or more**, or about 80 minutes of 720p video. The 15 conference videos cut into, say, three
  10-minute sections each would be 45 clips ≈ **2 GB: that needs Pro** (100 GB included, about
  US$25/month, then a few cents per GB) — room for roughly 2,000 such clips.
* **Bandwidth (egress).** Every play downloads the clip. Free plan: about **5 GB a month** → about **110
  full plays of a 46 MB clip a month across all reps** — 30 reps watching 4 clips each is already more.
  Pro includes about 250 GB a month (roughly 5,000 plays). **For a pilot with real reps, plan on Pro.**

Shorter clips cost less of both: a 3-minute clip is about 37 MB; a 1-minute clip about 12 MB.

## Rehearse it locally first

`pnpm key-day` (`docs/KEY-DAY.md`) puts an 8-second **TEST clip** (a test pattern and a tone, generated
by ffmpeg) on the first lesson of its TEST course, so the whole path — upload, publish, assign, play on the
phone, refused to another company — can be seen on this laptop before any real clip is trimmed. Without
ffmpeg it says so and the TEST course is text only.

**Production** has not been deployed (`docs/DEPLOY-RUNBOOK.md`). When it is, the migration that makes
the private `lesson-videos` bucket goes with every other one; nothing on this page needs a separate step
there.
