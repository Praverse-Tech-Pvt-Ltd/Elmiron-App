# iOS — what is ready, and what the day it is built needs (`FE-W161`)

**For the owner.** Written 14 October 2026. The field app's code is prepared for iPhone; **no iOS build has
been made**, because building one needs two accounts that do not exist yet. Nothing on this page has been
seen on an iPhone.

## What is already done in the code

| Area | On iPhone |
| --- | --- |
| The app | `apps/field/app.json` builds for `android` and `ios`, under the same identifier `com.praversetech.fieldforce` (permanent once anything is published) |
| Location | Asked as "While Using the App", with the reason on screen. **Never "Always", never in the background**, as on Android: `plugins/ios-release.cjs` refuses a config that asks, and `src/onboarding/no-background-location.test.ts` scans for it |
| First-run permissions | Location, notifications and microphone are asked through iOS itself (before this, the Android-only call answered "denied" on an iPhone without asking). After one "Don't Allow", iOS never asks again, so the app opens Settings — the same path as Android's "Don't ask again" |
| Battery and autostart | Android phone-maker settings; an iPhone has neither, so first run skips the step and Me has no row for it |
| Demo build to this laptop | With `DEMO_CLEARTEXT_HOSTS`, plain http is allowed to exactly those hosts (and the local network), as on Android. iOS asks the user once about the local network |
| Build number | `FIELD_IOS_BUILD_NUMBER`, a whole number that must go up with every build handed out (TestFlight refuses a repeat) |
| Build profiles | `apps/field/eas.json`: `ios-simulator`, `ios-demo` (internal, to registered iPhones), `ios-production` (App Store / TestFlight) |

## What stays off on iPhone, and why

* **Push notifications.** The server sends through Firebase and accepts only Android phones
  (`device_push_tokens.platform = 'android'`). iOS needs an APNs key from the Apple account **and a
  migration** that admits iOS tokens — migrations wait for the release-prep rule to lift. Until then the
  app registers nothing on an iPhone even in a build with `EXPO_PUBLIC_PUSH=true`.
* **The first-visit microphone screen (A4)** is shown on Android only. On an iPhone the voice-note
  screen asks for the microphone itself, the first time it is used.
* **Recording and coaching** — off on every platform (D-15), unchanged.

## What the day needs — only the owner can provide these

1. **An Apple Developer account** (US$99 a year), in the company's name. Without it no iPhone installs
   the app — there is no "copy the file and tap it" on iOS.
2. **An Expo account** (free plan is enough to start), because iPhone apps are built on a Mac and this
   laptop is Windows: Expo's EAS Build builds on its Macs.
3. For `ios-demo`: each test iPhone registered with Apple (`eas device:create`), or use TestFlight.

Then, from `apps/field`:

```powershell
npm install -g eas-cli          # once
eas login                        # the Expo account
eas init                         # links the project; writes its id into the config
# The server address the phone will use, and its publishable key — as EAS environment variables:
#   EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_KEY, and for a laptop demo DEMO_CLEARTEXT_HOSTS
eas build --platform ios --profile ios-demo
```

EAS asks for the Apple account on the first iOS build and creates the signing certificate itself.

## Working on an iPhone today, without a Mac or an Apple account: Expo Go

**Expo Go** (free, App Store) runs this app straight from the laptop's development server, so a change
made on Windows shows on the iPhone within seconds. Every native module the app uses is a stock Expo
module (plus `react-native-maps`), which Expo Go already contains. Added 15 October 2026.

**Its limits.** The App Store's Expo Go runs only the **current** Expo SDK. It supported SDK 57 (this
app's) in September 2026, and moves to SDK 58 shortly after that is stable; check the SDK version
shown in Expo Go's settings first. The app's own name, icon, permission texts and the plugins in
`apps/field/plugins/` do not apply inside Expo Go, and notifications are limited. It is for working
on screens and flows, not for a release.

1. On the iPhone, install **Expo Go** and sign in with an Expo account (free). Since September 2026
   Expo Go opens a development project only when the **same account** is signed in on the laptop.
2. On the laptop, once: `cd apps/field` then `npx expo login` (the same account).
3. The iPhone and the laptop on the **same Wi-Fi**. Windows Firewall must let the phone reach
   Node.js (Metro, port 8081) and Docker (Supabase, port 54321). On this laptop both already have
   inbound allow rules.
4. With Docker Desktop running, from the repository root: **`pnpm expo-go`** (`FE-W206`). It starts
   the local stack if it is down (the first time on a machine pulls several GB of images), runs
   `pnpm key-day` (the TEST company, its people, approved content, a course, today's plans), finds
   this laptop's Wi-Fi address, and starts Expo with the app pointed at it — not at `127.0.0.1`,
   which on a phone is the phone. `--no-seed` skips `key-day`; `--ip <address>` picks the address.
5. In Expo Go, open the project under **Development servers** (or enter the `exp://` address the
   command prints). Allow "Local Network" when iOS asks. Sign in with a test rep the command lists;
   the password is the `password` field of `services/api/.key-day/world.json`.

**On a new machine**, before step 4: Git, Node 24, Docker Desktop, then
`git clone https://github.com/Praverse-Tech-Pvt-Ltd/Elmiron-App.git`, check out the working
branch, and `corepack pnpm install` (`docs/START-HERE.md`, section 1). The test data is created
fresh by `key-day`; nothing from another laptop's database is needed. The AI features answer from the
labelled stub until an OpenAI key is put in `services/api/supabase/functions/.env` by hand
(`docs/KEY-DAY.md`) — never in the repository.

## Not verified — check on a real iPhone first

* That live location keeps sharing while the app is on screen, and stops when it is not.
* That a demo build reaches this laptop over Wi-Fi (the App Transport Security exception and the local
  network prompt).
* The lesson videos (expo-video) and the in-app map (Apple Maps when `EXPO_PUBLIC_MAPS=true`; the build
  check still asks for the Android Maps key today).
