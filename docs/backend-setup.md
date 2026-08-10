# Backend — Machine Setup

**What to install today, in order. Windows.**
Verified 6 August 2026.

---

# 0. TWO THINGS THAT WILL BITE YOU

## 0.1 Global `npm install -g supabase` does not work

Supabase **removed support for global npm install.** It is still an open documentation issue on their repo. Two supported routes:

- **Project dependency** *(recommended)* — `pnpm add -D supabase`, then run everything as `pnpm supabase <command>`. The CLI version is then pinned in your repo and every dev gets the same one.
- **Scoop**, if you want a global `supabase` command on Windows.

Use the project-dependency route. Version drift between three developers on a database CLI is a bad afternoon.

## 0.2 Develop inside WSL2, not on `D:\`

Your repo is currently at `D:\Praverse\Elmiron-App`. If you run pnpm and Docker against a Windows-filesystem path from WSL (`/mnt/d/...`), **file operations are roughly 5–10× slower** — `pnpm install` and file watching in a monorepo become genuinely painful.

**Clone into the WSL filesystem instead** — `~/projects/elmiron-app`. Same git remote, same repo. Keep the `D:\` copy only if you want the planning docs handy in Windows, or just delete it.

You can develop on native Windows without WSL. It works. It is slower and you will hit path-length and line-ending issues in a monorepo. Your call, but I'd move.

---

# 1. INSTALL TODAY

| # | Tool | Version | Why |
|---|---|---|---|
| 1 | **WSL2 + Ubuntu** | latest | Your dev environment |
| 2 | **Git** | latest | |
| 3 | **Node** | **24 LTS** | See note below |
| 4 | **pnpm** | via corepack | Monorepo package manager |
| 5 | **Docker Desktop** | latest | Supabase local stack runs in containers — **not optional** |
| 6 | **Supabase CLI** | as a dev dependency | Migrations, local stack, type generation |
| 7 | **VS Code** or **Cursor** | latest | |
| 8 | **Claude Code CLI** | latest | How you'll actually be working |
| 9 | **TablePlus** *(or DBeaver)* | latest | Postgres GUI. Free tier is fine. |

### On the Node version

As of August 2026, **Node 24 is Active LTS** — its active support runs to October 2026. Node 26 released in May 2026 but does not become LTS until October, mid-project.

**Use Node 24.** Do not chase 26. Pin it in `.nvmrc` and `package.json` engines so all three of you are on the same runtime. *[Verified against endoflife.date, 6 Aug 2026.]*

### On Docker Desktop

Docker Desktop is free for personal use and for small businesses — the paid threshold is 250+ employees **or** $10M+ annual revenue. Praverse is almost certainly under it, but confirm rather than assume.

If you'd rather avoid it entirely, Supabase supports **Rancher Desktop, Podman, OrbStack and colima** as alternatives.

---

# 2. ACCOUNTS TO CREATE TODAY

| Account | Who pays | Note |
|---|---|---|
| **GitHub** | — | Repo + Actions. Free tier covers CI at this scale. |
| **Supabase** | You | **Create the project in `ap-south-1` (Mumbai).** Region cannot be changed later without a migration. |

That is all you need this week. Everything else comes later and is somebody else's purchase.

---

# 3. SETUP, IN ORDER

Run these inside WSL2 Ubuntu.

```bash
# 1. Node via fnm (faster than nvm, works well in WSL)
curl -fsSL https://fnm.vercel.app/install | bash
exec $SHELL
fnm install 24
fnm use 24
fnm default 24
node -v          # expect v24.x

# 2. pnpm via corepack (ships with Node)
corepack enable
corepack prepare pnpm@latest --activate
pnpm -v

# 3. Clone into the WSL filesystem, NOT /mnt/d
mkdir -p ~/projects && cd ~/projects
git clone <your-repo-url> elmiron-app
cd elmiron-app

# 4. Supabase CLI as a project dependency
pnpm add -D supabase
pnpm supabase --version

# 5. Initialise and start the local stack
pnpm supabase init
pnpm supabase start      # first run pulls images, takes a few minutes
```

`supabase start` prints your local API URL, anon key, service-role key, and **Studio at http://localhost:54323**. Studio is a full database GUI — you may not need TablePlus at all for local work.

**Docker Desktop must be running and WSL integration enabled** — Settings → Resources → WSL Integration → enable for your Ubuntu distro. Without that, `supabase start` fails with a confusing socket error.

---

# 4. VERIFY BEFORE YOU START WORK

```bash
node -v                  # v24.x
pnpm -v
docker ps                # daemon reachable, no permission error
pnpm supabase status     # all services running
```

Then open `http://localhost:54323` and confirm Studio loads. If all five pass, you're ready to run **BE-W1**.

---

# 5. EDITOR

VS Code or Cursor, with:

- **ESLint** and **Prettier** — CI will fail on these, so catch them locally
- **PostgreSQL** (ms-ossdata.vscode-pgsql) — run SQL against local Supabase without leaving the editor
- **GitLens**
- **Error Lens** — surfaces TS errors inline, saves real time in a strict-TS monorepo

Install the **WSL extension** and always open the project with `code .` **from inside WSL**. Opening the same folder through `\\wsl$\` in Windows Explorer gives you the slow path back.

---

# 6. API TESTING

You have two reasonable options:

- **Postman** — you already have it connected via MCP, so Claude can create and run collections for you directly. Worth using for that alone.
- **Bruno** — lightweight, stores collections as plain files in the repo, so they version with the code. Better for a three-person team than sharing a Postman workspace.

Either is fine. **Postman, given the MCP connection.**

---

# 7. WHAT YOU DO *NOT* NEED

Save yourself the setup time:

- **Prisma** — you have the MCP connected, but this project uses Supabase migrations and raw SQL. Row-level security policies are the core deliverable and they are not expressible through Prisma's schema. Don't introduce it.
- **A separate Postgres install** — Supabase's local stack provides it.
- **Deno** — the Supabase CLI bundles the Edge Functions runtime.
- **Any AI/speech SDK** — that's AI/ML's, from week 2.
- **Android Studio or Xcode** — frontend's, and only from week 3.

---

# 8. LATER — WHO BUYS WHAT, WHEN

Not yours this week, but you should know it's coming since you own release ops.

| When | What | Cost | Owner |
|---|---|---|---|
| Week 2 | **Sarvam AI** API account | ₹100 free credits, then ~₹45/hr diarized | AI/ML |
| Week 3 | **Transistorsoft** background-geolocation licence | $399–999 USD, Android release builds only | Frontend |
| Week 4 | **PowerSync** (offline sync) | Free tier, then Team ~$599/mo if the client needs SOC 2 | Frontend |
| **Week 5** | **Apple Developer Program** | **$99/yr** | Frontend — **needed for the App Store probe, buy it in week 4** |
| Week 5 | **Google Play Developer** | $25 one-time | Frontend |
| Week 7 | Supabase Pro (storage + egress for audio) | ~$25/mo + usage | You |
| Week 8 | LLM provider account (Gemini or Sarvam) | Negligible — 1–5% of transcription | AI/ML |
| Week 11 | Error tracking (Sentry) | Free tier likely sufficient | You |

**The Apple Developer account has a verification delay** — for a company account it can take days to weeks. If the week-5 probe matters, start that purchase in week 3, not week 5. Flag it to whoever handles company payments today.

---

# 9. ROUGH MONTHLY RUN COST AT PILOT SCALE

| Item | Monthly |
|---|---|
| Supabase Pro | ~$25 + usage |
| Sarvam transcription *(100 MRs)* | ~₹66,000 (~$750) |
| LLM analysis | ~$10–40 |
| Storage + egress *(90-day audio retention)* | Low hundreds of ₹ at pilot scale |

Transcription dominates everything else by an order of magnitude. Worth knowing before someone is surprised by an invoice — though at ₹660 per MR per month it is still a rounding error against Indian MR salaries.

---

# 10. TODAY, IN ORDER

1. Enable WSL2 + Ubuntu
2. Install Docker Desktop, enable WSL integration
3. `fnm` → Node 24 → corepack → pnpm
4. Create the Supabase project **in Mumbai**
5. Clone into `~/projects/` inside WSL — **not** `/mnt/d/`
6. `pnpm add -D supabase && pnpm supabase init && pnpm supabase start`
7. Run the five verification commands in Part 4
8. Run prompt **BE-W1**

**And send one message to whoever handles payments:** start the Apple Developer Program purchase now. It's the only thing on the list with a lead time you can't compress.

---

*Sources: [Supabase CLI getting started](https://supabase.com/docs/guides/local-development/cli/getting-started) · [supabase/cli issue #4496 — npm global install unsupported](https://github.com/supabase/cli/issues/4496) · [Node.js release status, endoflife.date](https://endoflife.date/nodejs) · [Node.js previous releases](https://nodejs.org/en/about/previous-releases)*
