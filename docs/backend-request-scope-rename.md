# Request to Backend — workspace scope renamed, and one allow-list entry

**17 August 2026. Two items, one urgent for a reason that is not the obvious one.**

Copy, fill the brackets, send today.

---

**To:** [Backend developer]
**Cc:** [reviewer]
**Subject:** `@elmiron/*` is now `@fieldforce/*` — check for in-flight work before you pull

---

Two things, and the first is time-sensitive.

## 1. The workspace scope changed. Check for in-flight work now.

Frontend renamed the npm workspace scope across the monorepo:

```
@elmiron/*  ->  @fieldforce/*
```

All seven packages: `api`, `console`, `core`, `field`, `mock`, `ui`, `ui-tokens`.
Every import, every `workspace:*` dependency entry, the root scripts, and the three
GitHub workflow `--filter` arguments.

**This touched `services/api` and `packages/core`, which are read-only to Frontend.**
The scope rename cannot be done without crossing that line — the package names *are*
the scope. It was explicitly authorised by the reviewer, and every changed line in
your workspaces is the substitution and nothing else. But you should hear it from us
rather than find it, and your 333 tests now import from a scope that changed under
them.

**Why today:** the rename is 53 files and is **not yet pushed** — Frontend's push has
been blocked on credentials. A 53-file rename conflicts with almost anything. If you
have **any unpushed or in-flight work touching package names, imports, or workflow
filters**, tell us before either side pushes, and we will sequence it. If everything
you have is already in `origin/main`, there is nothing to do and this is a
fast-forward.

## 2. One allow-list entry, whenever convenient

`services/api/supabase/config.toml`:

```toml
additional_redirect_urls = ["http://127.0.0.1:3000", "https://127.0.0.1:3000"]
```

**Please add:** `com.praversetech.fieldforce://auth-callback`

Same addition on any hosted project.

**Not urgent, but worth understanding.** No deep-link scheme has *ever* been in that
list, so this is a pre-existing gap the rename surfaced rather than caused. Nothing
is broken today because the app signs in with the password grant, which uses no
redirect. It matters the first time anyone uses email OTP, a magic link or OAuth —
`config.toml` enables OTP (`otp_length = 6`, `otp_expiry = 3600`) but the client has
never implemented it, so nothing exercises the redirect path yet.

When it does, **the failure will look like a client auth bug** and it will be a
server allow-list entry.

## Why the scheme is what it is

`com.praversetech.fieldforce` matches the Android package id, which makes it
guaranteed-unique rather than probably-unique. Verified into the generated
`AndroidManifest.xml` via `expo prebuild`, not just at config level — the config-level
check passes on a manifest that never receives the scheme.

Full reasoning, including why a third party's pharmaceutical trademark should not sit
in a permanent public identifier: `docs/brand-identifier-decision.md`. The write-ups
are `PROJECT-OVERVIEW.md` → FE-R1 and FE-R1a.

[name], Frontend
