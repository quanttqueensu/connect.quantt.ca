# QUANTT Hub (Sponsor Connection)

Invite-only hub for QUANTT members and companies. Members see a global feed and apply to in-app jobs with hiring packages. Companies see only their own posts and applicants.

The public brochure site remains [quantt-website](https://github.com). This app is Quantt-branded (navy, Inter, Merriweather) but is a separate product.

## Stack

Next.js 16, React 19, Tailwind 4, Supabase (Auth, Postgres, Storage).

Node **22.20.0** (see `.nvmrc` and the `engines` field in `package.json`). Run
`nvm use` in the repo root to pick it up.

## Setup

1. Create a Supabase project. Turn **off** public signups (Authentication → Providers → Email: disable sign-ups; invites still work).
2. Run `supabase/migrations/0001_init.sql` in the SQL editor, then `supabase/seed.sql`.
3. Copy `.env.example` to `.env.local` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

4. Seed the first admin: insert a row into `invites` with your email, `role = 'member'`, `is_admin = true`, then invite that email from Authentication → Users → Invite (or use Admin → People after you have any admin). Fastest path in SQL:

```sql
insert into public.invites (email, full_name, role, is_admin)
values ('you@quantt.ca', 'Your Name', 'member', true);
```

Then send an invite from the Supabase dashboard for that email. Click the email link — you should land on **Create your password**, then log in at `/login`.

5. In **Authentication → URL Configuration**:
   - Site URL = `https://connect.quantt.ca`
   - Redirect URLs include `https://connect.quantt.ca/auth/callback` and `http://localhost:3000/auth/callback`

6. In **Authentication → Email Templates → Invite user**, replace the button URL with:

```html
<a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite">Accept the invite</a>
```

The default `{{ .ConfirmationURL }}` still works (tokens arrive in the URL hash), but the `token_hash` link is more reliable.

7. `npm install && npm run dev`

## Sign in with QUANTT (club members)

Club members can skip invites and passwords: **Sign in with your Queen's email** on `/login` sends them to auth.quantt.ca (the shared QUANTT member directory, behind Cloudflare Access), which sends them back to `/auth/quantt/callback` with a one-time code. The callback redeems the code through the service binding `AUTH` (the `quantt-auth` Worker), signs them into their Supabase account, creating it the first time through the normal invite row, and copies their Connect role from auth.quantt.ca onto `is_admin` (Admin there makes them a hub admin; anyone else is a member). Emails that aren't in the directory, and company accounts, are refused. Sponsors keep the email and password login. No secret is shared: only a Worker bound to `quantt-auth` in the same Cloudflare account can redeem a code. Code: `lib/quantt-signin.ts`, `app/auth/quantt/`.

If the site runs anywhere but `https://connect.quantt.ca` (a preview, `http://localhost:3000` with `npm run preview`), list that origin in `CONNECT_ORIGINS` on `quantt-auth`.

## Hosting: Cloudflare Workers

The hub runs as the Worker `quantt-connect`, built with [OpenNext](https://opennext.js.org/cloudflare) (`wrangler.jsonc`, `open-next.config.ts`).

1. Workers & Pages → Create → Import a repository → `quanttqueensu/connect.quantt.ca`. Name `quantt-connect`, build command `npx opennextjs-cloudflare build`, deploy command `npx opennextjs-cloudflare deploy`. It must be in the same account as `quantt-auth`.
2. Build variables (Settings → Build → Variables): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL=https://connect.quantt.ca`. These are baked into the browser bundle at build time.
3. Runtime variables (Settings → Variables and Secrets): the same three, plus the secret `SUPABASE_SERVICE_ROLE_KEY`.
4. Settings → Domains & Routes → add `connect.quantt.ca` (remove it from the old host first).

Local: `npm run dev` as before; `npm run preview` runs the Worker build locally.

## Tests

The suite is a **row-level-security harness**: each test signs in as a real
member / company / admin and asserts what Postgres will and will not let them
touch. It talks to a real database, so there is no mocking and no way to run it
without one.

You need Docker and the [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
supabase start          # boots local Postgres + Auth on :54321
npm run db:reset        # applies supabase/migrations/* and supabase/seed.sql
```

Then create a **`.env.test`** in the repo root — vitest loads it via dotenv
(`vitest.config.ts` sets `DOTENV_CONFIG_PATH=.env.test`), and the tests fail
immediately without it. Fill it from `supabase status`:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from `supabase status`>
SUPABASE_SERVICE_ROLE_KEY=<service_role key from `supabase status`>
```

`.env.test` is gitignored. Point it at a **local** stack only — the tests
truncate tables between files and will happily wipe whatever they are aimed at.

```bash
npm test          # vitest run
npm run test:watch
```

The tests share one database and truncate between files, so `fileParallelism`
is off; expect them to run serially.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Next dev server |
| `npm run build` | Production build (also typechecks app code) |
| `npm run lint` | ESLint, including type-aware `no-floating-promises` — takes a minute or two |
| `npm run typecheck` | `tsc --noEmit` over app code |
| `npm run typecheck:tests` | `tsc --noEmit` over `tests/` |
| `npm test` | RLS suite — needs a local Supabase and `.env.test` (see above) |
| `npm run db:reset` | Reapply migrations + seed to the local database |

CI (`.github/workflows/ci.yml`) runs lint, `typecheck:tests` and build on every
push and pull request. `npm test` is **not** in that path — it needs the live
database described above — and is available as a manual `workflow_dispatch`
run instead.

## Rules (v1)

- Apply + hiring package only on **in-app jobs** (`kind = job`, no `external_url`).
- Posts can have comments. Comments are not applications.
- External job links: “Open listing”, optional off-platform log.
- Member feed is global. Companies see **only their own posts**.
- Email is partly implemented. Invites **do** send: `inviteUserByEmail` (Supabase Auth)
  delivers the invite mail, and when Supabase rate-limits it the admin screens fall back
  to a shareable one-time password. Everything else — application status changes, message
  notifications — still goes through `lib/notify.ts`, which is a no-op stub.
- Resumes: PDF, 5MB. Photos: ~2MB.

## Routes

| Who | Paths |
| --- | --- |
| Public | `/` (landing), `/for-companies`, `/login`, `/join`, `/auth/callback`, `/auth/set-password` |
| Member | `/feed`, `/packages`, `/applications`, `/profile`, `/members`, `/messages` |
| Company | `/company`, `/company/posts/new`, `/company/applicants`, `/company/messages` |
| Admin | `/admin` panel (invite, people, companies, requests, posts, applications). Admins are also members and use the member app separately. |

Public routes are listed explicitly in `PUBLIC_PATHS` in `middleware.ts`. A new
`/auth/*` route is **private until it is added there deliberately** — there is
no prefix wildcard.

## Security headers

`next.config.ts` sets `X-Content-Type-Options`, `Referrer-Policy`,
`X-Frame-Options: DENY`, `Permissions-Policy` and HSTS on every response.

The Content-Security-Policy ships as **`Content-Security-Policy-Report-Only`**
because the App Router emits inline hydration scripts, so an enforcing policy
needs per-request nonces threaded through the middleware. The header comment in
`next.config.ts` has the steps for promoting it to enforcing.
