# Machine Inventory — Maanav's Windows laptop

**Purpose:** record of what was installed for this project and where it lives, so it can be cleanly removed after handover.
Recorded 10 August 2026.

**Environment decision:** developing on **native Windows** at `D:\Praverse\Elmiron-App`. WSL2 / Ubuntu / fnm were deliberately **not** installed — the Windows setup was already working and this keeps the uninstall surface small.

---

## 1. Installed for this project — SAFE TO REMOVE at handover

| # | Item | Location on disk | How to remove |
|---|---|---|---|
| 1 | **Postman** 12.22.8 | `C:\Users\maana\AppData\Local\Postman` | `winget uninstall --id Postman.Postman` |
| 2 | **corepack shims** (pnpm, pnpx, yarn) | `C:\Users\maana\AppData\Roaming\npm\` — files `pnpm*`, `pnpx*`, `yarn*` | `corepack disable --install-directory "$env:APPDATA\npm"` then delete any leftover `pnpm*`/`pnpx*`/`yarn*` files in that folder |
| 3 | **corepack package cache** | `C:\Users\maana\AppData\Local\node\corepack` | `Remove-Item -Recurse -Force "$env:LOCALAPPDATA\node\corepack"` |
| 4 | **VS Code — PostgreSQL** (`ms-ossdata.vscode-pgsql` v1.28.0) | VS Code extensions dir | `code --uninstall-extension ms-ossdata.vscode-pgsql` |
| 5 | **VS Code — GitLens** (`eamodio.gitlens` v18.3.0) | VS Code extensions dir | `code --uninstall-extension eamodio.gitlens` |
| 6 | **VS Code — Error Lens** (`usernamehw.errorlens` v3.28.0) | VS Code extensions dir | `code --uninstall-extension usernamehw.errorlens` |
| 7 | **git `core.longpaths = true`** (global, user scope) | `C:\Users\maana\.gitconfig` | `git config --global --unset core.longpaths` |
| 8 | **Windows `LongPathsEnabled`** *(pending — needs admin)* | `HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem` | Set the DWORD back to `0`. Machine-wide setting — check nothing else depends on it first. |

### Project-local, removed by deleting the repo folder

These are **not** system installs. They live inside `D:\Praverse\Elmiron-App` and disappear with it.

| Item | Location |
|---|---|
| pnpm + Supabase CLI (dev dependencies) | `D:\Praverse\Elmiron-App\node_modules\.bin\` |
| pnpm content-addressable store | `D:\Praverse\Elmiron-App\.pnpm-store` |
| Supabase config + migrations | `D:\Praverse\Elmiron-App\supabase\` |

### Docker state — must be removed separately

Deleting the repo does **not** remove these. Run this from the repo **before** deleting it:

```bash
pnpm supabase stop --no-backup
```

That stops and removes the `supabase_*_Elmiron-App` containers and their volumes. Then reclaim the pulled images:

```bash
docker image prune -a
```

Supabase's images total several GB (`public.ecr.aws/supabase/*` — postgres, studio, kong, gotrue, realtime, storage-api, postgrest, edge-runtime, logflare, vector, mailpit, postgres-meta).

---

## 2. Pre-existing — DO NOT REMOVE

These were on the laptop before this project and are presumably used for other work.

| Item | Location |
|---|---|
| Git 2.54.0 | `C:\Program Files\Git` |
| Node.js v24.18.0 + npm 11.16.0 | `C:\Program Files\nodejs` |
| Docker Desktop 29.5.3 | `C:\Program Files\Docker\Docker` |
| VS Code | `C:\Users\maana\AppData\Local\Programs\Microsoft VS Code` |
| Claude Code CLI | `C:\Users\maana\.local\bin\claude.exe` |
| VS Code — ESLint, Prettier, ~65 other extensions | VS Code extensions dir |
| WSL2 engine + `docker-desktop` utility distro | Windows feature — belongs to Docker Desktop, not this project |

---

## 3. Deliberately not installed

| Item | Reason |
|---|---|
| WSL2 + Ubuntu distro | Chose native Windows. Docker's `docker-desktop` distro already present and is not a dev environment. |
| fnm / nvm | Only needed inside WSL. Windows Node is already 24.x, matching `.nvmrc` and `package.json` engines. |
| VS Code WSL extension | Not on the WSL path. |
| TablePlus / DBeaver | Supabase Studio at `http://localhost:54323` covers local database work. |
| Bruno | Postman chosen instead (MCP connection). |
| Prisma, standalone Postgres, Deno | Explicitly ruled out in `backend-setup.md` §7. |

---

## 4. Open items — flagged, not yet actioned

| # | Item | Why it matters | Owner |
|---|---|---|---|
| 1 | Confirm the **Supabase cloud project exists in `ap-south-1` (Mumbai)**. Only the local stack has been verified. | Region cannot be changed later without a full migration. Confirm before anyone builds against it. | Maanav |
| 2 | Send the **Apple Developer Program** purchase request to whoever handles company payments. | Per `backend-setup.md` §10, the only item with a lead time that cannot be compressed — company account verification can take days to weeks. Needed for the week-5 App Store probe, so start it in week 3. | Maanav → payments |
| 3 | Set Windows `LongPathsEnabled = 1` in the registry (needs admin + reboot). | `git config core.longpaths` is already set, but it only covers git's own file operations — not pnpm's or Node's. Without the registry flag, deep `node_modules` nesting will still fail. | Maanav |
| ~~4~~ | ~~Decide how to handle the crash-looping `supabase_vector` container.~~ **Resolved 10 Aug 2026** — analytics disabled in `supabase/config.toml`. | — | — |

---

## 5. Verification state as of 10 August 2026

All of `backend-setup.md` Part 4 passes:

- `node -v` → v24.18.0
- `pnpm -v` → 11.21.0
- `docker ps` → 12 containers running, daemon reachable
- `pnpm supabase status` → API `:54321`, DB `:54322`, Studio `:54323`

### Analytics disabled — deliberate

`[analytics] enabled = false` in `supabase/config.toml`. This drops the `vector` and `logflare` containers, taking the stack from 12 containers to 10.

**Why:** on Windows the Supabase CLI starts vector with `DOCKER_HOST=http://host.docker.internal:2375`. Docker Desktop does not expose that TCP port by default, so vector could not reach the daemon and crash-looped every ~60s (26 restarts before the change). The alternative fix — ticking "Expose daemon on tcp://localhost:2375 without TLS" in Docker Desktop — was rejected: that endpoint is unauthenticated and daemon access is root-equivalent on the host.

**Consequence:** Studio's Logs pane is empty. Read service logs directly instead:

```bash
docker logs -f supabase_auth_Elmiron-App
```

**Note for the team:** `config.toml` is committed, so this applies to every local stack. Anyone on macOS or Linux, where vector works, loses Studio Logs as a result.

### One remaining known issue, not blocking

`supabase_imgproxy` and `supabase_pooler` are stopped, as reported by `supabase status`. Not needed for current work — imgproxy matters only for image transforms, pooler only for connection pooling.
