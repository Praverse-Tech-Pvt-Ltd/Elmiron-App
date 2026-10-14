# Third-party notices

The field app (`apps/field`) and the console (`apps/console`) include or are built with the
third-party material below. This file lists what is **shipped inside the product** by name, and
summarises the rest. Written 15 October 2026; regenerate the summary with
`pnpm licenses list --prod`.

**This file is not the product's own licence.** The repository has no `LICENSE` file: who owns the
product code, and on what terms the client receives it, is set by the contract between Praverse Tech
and the client, not by this repository. Add a `LICENSE` once that is decided.

## Shipped inside the product

| Material                                                              | Where it appears                                                                           | Licence                           | Notice                                                                                                                                                                   |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **DM Sans** typeface                                                  | every screen of the app and the console                                                    | SIL Open Font License 1.1         | Copyright 2014 The DM Sans Project Authors (https://github.com/googlefonts/dm-fonts)                                                                                     |
| **Cormorant Garamond** typeface                                       | the sign-in brand line only                                                                | SIL Open Font License 1.1         | Copyright 2015 The Cormorant Project Authors (https://github.com/CatharsisFonts/Cormorant)                                                                               |
| `@expo-google-fonts/dm-sans`, `@expo-google-fonts/cormorant-garamond` | load the two typefaces in the app                                                          | MIT (packaging) + OFL 1.1 (fonts) | see each package's `LICENSE`                                                                                                                                             |
| **Lucide** icon outlines                                              | the console's icons and the placeholder app icon's leaf (`apps/console/src/lib/icons.tsx`) | ISC                               | Copyright (c) for portions of Lucide are held by Cole Bemis 2013–2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022. |
| React, React Native, Expo SDK modules, expo-router                    | the app runtime                                                                            | MIT                               | see each package's `LICENSE`                                                                                                                                             |
| `@supabase/supabase-js` and its sub-packages                          | talking to the backend, in the app and the console                                         | MIT                               | see each package's `LICENSE`                                                                                                                                             |
| `react-native-maps`                                                   | the in-app map (only when maps are switched on)                                            | MIT                               | see the package's `LICENSE`                                                                                                                                              |
| Next.js, React DOM                                                    | the console                                                                                | MIT                               | see each package's `LICENSE`                                                                                                                                             |
| Zod                                                                   | data checks in `packages/core`                                                             | MIT                               | see the package's `LICENSE`                                                                                                                                              |

The OFL lets the fonts be bundled, embedded and redistributed with the software. They may not be
sold on their own, and a modified version may not use the reserved font name.

## Everything else, by licence

Counted from `pnpm licenses list --prod` on 15 October 2026, all workspaces:

| Licence                                                       | Packages |
| ------------------------------------------------------------- | -------- |
| MIT                                                           | 578      |
| ISC                                                           | 33       |
| Apache-2.0                                                    | 19       |
| BSD-3-Clause                                                  | 15       |
| BlueOak-1.0.0                                                 | 6        |
| BSD-2-Clause                                                  | 4        |
| others (0BSD, Unlicense, CC0/MIT, Python-2.0, MIT+Apache-2.0) | 8        |

**Worth a second look before a commercial release.** All of these are **build tools**, used on the
build machine or the console's server to build the product, and not inside the Android app:

- `lightningcss` (MPL-2.0), a CSS compiler used by the console build.
- `@img/sharp-win32-x64` (Apache-2.0 and LGPL-3.0-or-later; it bundles libvips), Next.js image tooling.
- `caniuse-lite` (CC-BY-4.0), browser-support data used by the build.
- `node-forge` (BSD-3-Clause OR GPL-2.0); the BSD option applies.
