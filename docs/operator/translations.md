# Translations — Hindi and Marathi for the field app

**Written 14 October 2026 (`FE-W146`).** The owner's decision that day: *"Hindi + Marathi; client
translates".* So the app ships everything except the translated words, and the client's translators
fill in a file we hand them. Nothing in this repository machine-translates anything.

## What the rep sees today

Me → Settings → **Language** lists **English**, **हिन्दी** and **मराठी**, each written in its own
script. With the translation files empty, Hindi and Marathi read *"Coming later — Hindi: waiting for
translation (0 of 221 done)"* and cannot be pressed. The moment a file is **complete**, its row
becomes pressable and the app switches to it, with no code change. A half-done file is never offered:
a rep would be reading half Hindi and half English, and the app would be claiming a translation that
does not exist.

The choice is kept per phone (not per account — the phone is shared, and the language belongs to
whoever is holding it at the sign-in screen). If a later build adds new English words the
translators have not done, the language stops being complete; the app then opens in English and the
row shows the new count.

The number of strings changes as screens move; `pnpm i18n:export` prints today's count.

## The round trip

1. **Export.** From the repository root:

   ```sh
   pnpm i18n:export --out field-app-translations.csv
   ```

   It prints how many strings there are and how far each language has got. The file has one row per
   string: `key, english, context, max_length, hindi, marathi`.

2. **Send the CSV to the translators.** Tell them:
   - fill only the `hindi` and `marathi` columns; leave `key`, `english`, `context` and `max_length`
     exactly as they are;
   - keep every `{placeholder}` exactly as written — `{count}`, `{doctor}`, `{time}` are filled in by
     the app. They may move within the sentence; they may not be renamed, translated or dropped;
   - where `max_length` has a number, the translation must fit in that many characters (it is a tab
     label, a badge or a button);
   - keys ending `_one` and `_other` are the singular and plural of one sentence. **Hindi uses the
     `_one` form for 0 as well as 1** (that is the language's own rule, and the app follows it);
     Marathi and English use `_one` for 1 only;
   - an empty cell means "not done yet"; partial files are fine;
   - in Excel, save as **"CSV UTF-8 (Comma delimited)"**. The exported file starts with a byte-order
     mark so Excel opens Devanagari correctly; a plain "CSV" save loses it.

3. **Check what came back, without writing anything:**

   ```sh
   pnpm i18n:import their-file.csv --check
   ```

4. **Import it:**

   ```sh
   pnpm i18n:import their-file.csv
   ```

   This rewrites `packages/ui/src/i18n/hi.json` and `mr.json`. Commit them. The import prints how many
   of each language are now done.

### What the import refuses

All problems are listed at once, and **nothing is written unless every row passes**:

| Refused | Why |
| --- | --- |
| a key the app does not have | a typo, or a row from an older file |
| the same key twice | which one is meant is a guess |
| an `english` cell that is not today's English | the file is older than the app: export a fresh one and translate that |
| a translation whose `{placeholders}` differ from English's | a renamed `{count}` prints a raw brace on a rep's screen; a dropped one loses the number |
| a translation longer than `max_length` | it will not fit where it is drawn (counted as a reader sees letters, so a Devanagari conjunct counts once) |
| a first row that is not exactly the header | not the exported file |

Rows missing from the file leave those strings as they were.

## What is NOT in the translators' file, on purpose

- **The consent screen's doctor-facing words, and the consent notice itself (`FE-W148`).** This is
  legal text. The notice a doctor agrees to is a row in `consent_text_versions`: versioned, hashed,
  immutable, and published only by the operator — no role in the app can write that table. A Hindi or
  Marathi notice exists when, and only when, the operator publishes one in that language **after it
  has been approved**, through the reference-data loader
  (`services/api/scripts/seed-reference-data.mjs`, a `consentTextVersions` entry with
  `"language": "hi-IN"` or `"mr-IN"`). The consent screen then offers it, and the consent record names
  exactly that version and its language — the server checks that the version was the one in force
  for that language at that moment (`45001`). Until then the consent screen says, plainly: *"This
  notice is in English only. No Hindi or Marathi version has been approved yet."* The app-written
  framing around the notice (the question, the two panels, the details list) stays English whatever
  the app language is; translating it is a legal decision for the client, and it would arrive the same
  way as the notice, not through this file. A test fails the build if those files ever call the
  catalogue.
- **The brand line on the sign-in screen** ("Relief at the root."). It is brand copy, set in a face
  that has no Devanagari.
- **Anything the server or a person wrote**: doctor and clinic names, the reason a rep typed, the
  figures attached to a server refusal, the live-location privacy notice (legal, operator-approved —
  Q-12).
- **Dates and times** are still drawn as "14 Oct" and "18:05". Month names are English in every
  language for now.

## How Devanagari is drawn (`FE-W147`)

The brand face, DM Sans, has **no Devanagari at all** — measured from the four shipped font files
(0 of the 128 code points U+0900–U+097F). No font was bundled for it: Android draws any letter the
app's font lacks with the phone's own Devanagari font (Noto Sans Devanagari on stock Android), so
Hindi and Marathi render in the platform's face while Latin text stays DM Sans. **This has not yet
been checked on a handset** — the first complete translation should be looked at on a real phone,
including the bold weights and the tab bar.

## For a developer adding or changing a string

- Add the key and its English to `packages/ui/src/i18n/en.json`, run `pnpm i18n:sync` (it gives
  `hi.json` and `mr.json` the same keys, new ones empty), and use `t('your.key', { … })`. The key's
  first segment is the screen; add a line to `notes.json` if translators need context or a length
  limit.
- **Changing what an English string means? Give it a new key.** A translation is of the words it was
  made from; reusing the key keeps a translation of the old meaning.
- A string built in a plain module and exported as a constant is frozen in the language it was in
  when the module loaded. Make it a function, or a getter, so it is read when shown (`FE-W144`).
- `t()` must be reached during render, and the component must subscribe (`useT()` or
  `useLanguage()`), or a language change will not repaint it.
- `packages/ui/src/i18n/catalogue.test.ts` fails the build if code asks for a key English lacks, if an
  English key is used nowhere, if `hi.json` / `mr.json` drift from English's keys, or if a filled
  translation changes a placeholder.

## What has moved, and what is left

**Moved (`FE-W145`)** — every word on these, including the helpers that build their sentences:
sign-in and the start-up spinner; the tab bar; **Today** (the day card, the next visit, the progress
card, the buttons, the sync line, the pending-sync list, the mobile data note, the live location line,
the "list rebuilt" and "record moved" notices, the time-zone banner); the manager/administrator home
placeholder; **Me / Settings** (every row, sign out and its warnings); **Day end**; and the words
the shared controls supply themselves (Choose one, On/Off, Close, Clear). The shared error and
"what to do" messages (`errors/plain.ts`, `sync/explanation.ts`) are in the catalogue too, so they
follow the language on every screen that shows them.

**Not moved yet** — these still show English whatever the language, and each is a whole screen, so
none is half done:

| Screen | Route / component |
| --- | --- |
| Doctors tab and a doctor's profile | `app/(tabs)/doctors.tsx`, `app/doctor/[id].tsx`, `DoctorListScreen`, `DoctorProfileScreen` |
| A visit (check in / out, not met) | `app/visit/[id].tsx`, `VisitScreen` |
| Call report, samples, voice note | `app/report/[visitId].tsx`, `app/samples/[visitId].tsx`, `app/voice-note/[visitId].tsx` and their screens |
| The outbox (queue) screen | `app/queue.tsx`, `QueueScreen` |
| Today's route, unplanned visit, map | `app/beat-plan.tsx`, `app/unplanned-visit.tsx`, `app/map.tsx` |
| Mileage, Mobile data, What this app records | `app/mileage.tsx`, `app/data-settings.tsx`, `app/transparency.tsx` |
| Live location (the screen; its notice is legal and excluded) | `app/live-tracking.tsx` |
| First run: location, battery & autostart, notifications, microphone | `app/onboarding/*` |
| Adverse event | `app/adverse-event/[visitId].tsx` |
| Coaching, analysis, reply (behind a flag) | `app/(tabs)/coaching.tsx`, `app/analysis/[id].tsx`, `app/reply/[analysisId].tsx` |
| Assistant, product questions, practice, learning (behind flags) | `app/assistant.tsx`, `app/product-qa.tsx`, `app/practice/*`, `app/learning/*` |
| Consent | **excluded by rule**, above |

The visit screen is the next most used after Today and should go first.
