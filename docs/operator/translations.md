# Translations — Hindi and Marathi for the field app

**Written 14 October 2026 (`FE-W146`); brought up to date after the second pass the same day (`FE-W159`), and on 15 October after Learning moved and the handover polish (`FE-W193`).** The owner's decision that day: *"Hindi + Marathi; client
translates".* So the app ships everything except the translated words, and the client's translators
fill in a file we hand them. Nothing in this repository machine-translates anything.

## What the rep sees today

Me → **Language** lists **English**, **हिन्दी** and **मराठी**, each written in its own
script. With the translation files empty, Hindi and Marathi read *"Coming later — Hindi: waiting for
translation (0 of 1045 done)"* (the count on 15 October, `FE-W193`) and cannot be pressed. The moment a file is **complete**, its row
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
- **The adverse-event screen's regulated wording (`FE-W157`).** Six sentences about what a rep's
  flag is and is not, and what must not be written in it, stay English-only exactly as consent
  does — they describe a pharmacovigilance duty, and their translation is the client's safety and
  legal team's to approve, not a translator's. The screen's chrome (title, field label, buttons,
  "Flag sent" / "Flag saved", errors) is translated, so a Hindi screen shows a Hindi title above an
  English sentence. The English-only sentences, verbatim:
  - "You are flagging it, not assessing it."
  - "Write what you were told, in your own words. The safety team decides what it means and will
    contact the doctor if they need more."
  - "Do not write the patient’s name, phone number, address or any ID number. They are not needed,
    and they must not leave the clinic through this app."
  - "The safety team has it. You do not need to do anything else." (after sending)
  - "Saved on this phone. It will send by itself when you have signal — you do not have to write it
    again." (kept for later)
  - "This looks like it contains {a phone number / an email address / an ID number}. Take it out
    before sending — the safety team does not need it."

  Each carries a `FE-W157` comment in the code. Moving one into the catalogue is a decision for the
  client, not a code change to make quietly.
- **The brand line on the sign-in screen** ("Relief at the root."). It is brand copy, set in a face
  that has no Devanagari.
- **Anything the server or a person wrote**: doctor and clinic names, the reason a rep typed, the
  figures attached to a server refusal, the live-location privacy notice (legal, operator-approved —
  Q-12).
- **Messages already saved on the phone in another language.** A few queue reasons ("Waiting for
  its visit to be sent first.", "No answer from the server.") are written into the queue row when they
  happen, so a row recorded before a language change keeps the language it was recorded in until it
  sends. Fixing that would change the saved queue format.

## Dates (`FE-W149`)

Month and weekday names follow the language. English keeps the app's own short months ("Sep", not
"Sept"). Hindi and Marathi are named by `Intl.DateTimeFormat` with `hi-IN` / `mr-IN`, in the
territory's time zone, with Latin digits (`-u-nu-latn` — Marathi's default is Devanagari digits, and
every clock time and count beside a date is Latin): "11 सित॰", "11 सप्टें", "सोमवार".

**Why Intl and not a translated list:** React Native 0.86 builds Hermes with Intl switched on
(`HERMES_ENABLE_INTL=True` in `ReactAndroid/hermes-engine/build.gradle.kts`), and on Android that Intl
is backed by the phone's own ICU (minSdk 24), which carries Hindi and Marathi. That is read from the
build, not seen on a handset. If a phone's runtime ever fails to resolve the locale, the date is shown
in English rather than guessed — a correct "11 Sep" beats a wrong name. Clock times ("18:05") are the
same in every language.

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

**Every screen a rep sees is on the catalogue** (`FE-W145`, `FE-W150`–`FE-W158`, and Learning in
`FE-W183`): sign-in, the tab bar, Today, Me, Day end; a visit; the Doctors tab and a doctor's
profile; call report, samples and voice note; the outbox (queue); today's route, an unplanned visit
and the map; mileage, Mobile data, What this app records and the Live location screen; the first-run
screens (location, battery & autostart, notifications, microphone) and the start-up error screen; the
adverse event screen (except its regulated wording, above); coaching, an analysis and the reply; the
assistant, product questions and AI doctor practice; Learning — the course list, a course, a lesson,
its video and the lesson tutor. The shared error and "what to do" messages, and the "Back" control at
the top of a screen (`common.back`), follow the language on every screen. On 15 October the catalogue
held **1045** strings (`FE-W193`); `pnpm i18n:export` prints today's count.

**What stays the server's, untranslated by this file:** a course's, module's and lesson's title, a
course's summary and a lesson's text (the company's content, as published); the answers of the
assistant, product questions and the AI doctor; the live location notice.

**Not moved:**

| Screen | Why |
| --- | --- |
| Consent | **excluded by rule**, above — including the "Back" on its "Exactly what is collected" page, fixed English like every other word the doctor reads there (`FE-W188`) |

**Words that went into the catalogue on a judgement call** — say if any should be English-only:
the C14 line on a doctor's profile ("Nothing here about what they prescribe, and nothing about their
patients…", `doctors.boundary`), the coaching screens' "Written by an AI model" lines, the
"What this app records" copy (its own comment says it still needs privacy review), the Live location
screen's DRAFT banner and its "I have read this notice and agree" button (the notice itself is the
operator's, untouched), and the two "this visit / this doctor is not on your phone yet" banners, which
the consent screen shows to the REP as well (the doctor-facing consent words are unaffected).
