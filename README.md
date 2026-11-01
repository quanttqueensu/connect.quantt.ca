# QUANTT Hub (Sponsor Connection)

Invite-only hub for QUANTT members and companies. Members see a global feed and apply to in-app jobs using their profile resume and optional cover letter. Companies see only their own posts and applicants.

The public brochure site remains [quantt-website](https://github.com). This app is Quantt-branded (navy, Inter, Merriweather) but is a separate product.

## Stack

Next.js 16, React 19, Tailwind 4, Supabase (Auth, Postgres, Storage).

Node **22.20.0** (see `.nvmrc` and the `engines` field in `package.json`). Run
`nvm use` in the repo root to pick it up.

## Setup

1. Create a Supabase project. Turn **off** public signups (Authentication → Providers → Email: disable sign-ups; invites still work).
2. Apply every SQL file in `supabase/migrations/` in filename order, then `supabase/seed.sql`. Applying only `0001_init.sql` leaves required tables, RPCs, and access policies missing.
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

## Sponsor tiers and company overrides

Use **Admin → Sponsor tiers** to edit the features shared by a tier. Use
**Admin → Companies → Company feature overrides** for exceptions:

- **Follow tier** inherits the assigned tier and any current grandfathered access.
- **Enable for this company** grants the feature only to that company, with its own job limit when applicable (blank means unlimited).
- **Disable for this company** blocks the feature for that company.

Explicit overrides take priority and survive later tier edits or reassignment.
Choose **Follow tier** to reset one feature, or **Reset all features to tier defaults**
to clear all of a company's exceptions. Inactive companies keep their saved settings
but have no feature access until reactivated. This uses the existing
`0012_company_access_overrides.sql` schema; no new migration is needed.

## Hosting: Cloudflare Workers

The hub runs as the Worker `quantt-connect`, built with [OpenNext](https://opennext.js.org/cloudflare) (`wrangler.jsonc`, `open-next.config.ts`).

1. Workers & Pages → Create → Import a repository → `quanttqueensu/connect.quantt.ca`. Name `quantt-connect`, build command `npx opennextjs-cloudflare build`, deploy command `npx opennextjs-cloudflare deploy`. It must be in the same account as `quantt-auth`.
2. Build variables (Settings → Build → Variables): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL=https://connect.quantt.ca`. These are baked into the browser bundle at build time.
3. Runtime variables (Settings → Variables and Secrets): the same three, plus the secret `SUPABASE_SERVICE_ROLE_KEY`.
4. Settings → Domains & Routes → add `connect.quantt.ca` (remove it from the old host first).
5. PR preview builds are off (Settings → Builds → Previews Base). `wrangler preview` never ran the OpenNext build there, so every PR showed a failed check.
6. Supabase keep-alive: the cron in `wrangler.jsonc` runs `scheduled` in `worker.js` every third day with one small database read, because Supabase pauses a free project after a week without activity and the hub then hangs.

Local: `npm run dev` as before; `npm run preview` runs the Worker build locally.

## Tests

Run `npm run test:unit` for the database-free tests (also run in CI).

The `tests/rls/` suite is a **row-level-security harness**: each test signs in as a real
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

### Security regression checks and rollout

`scripts/test-security-db.py` applies every migration to a newly created,
disposable local PostgreSQL database and checks path guards, role privileges,
join admission, and concurrent posting quotas. It requires `psql` and local
database-creation privileges, accepts only loopback URLs, and never reads `.env`:

```bash
python3 scripts/test-security-db.py postgresql://127.0.0.1:55439/postgres
```

This SQL fixture emulates the Supabase database roles and `auth.uid()` context;
run the `tests/rls/` suite against a local Supabase stack as well to verify the
Auth, PostgREST, and Storage HTTP integration.

Release `20261101040104_security_boundary_fixes.sql` together with the app code.
Public access requests fail closed until both are installed: direct anon and
authenticated inserts are revoked, and the action uses the service-only
`submit_join_request` RPC. Existing runtime service-role configuration is required;
no additional secret or external service is needed. Nothing in the local tests
applies migrations to the hosted database.

Admission limits use shared database counters: 5 attempts per source per UTC
hour, 3 per email per UTC day, 100 globally per hour, 500 globally per day, and
at most 1,000 pending requests. Duplicates and throttled valid requests receive
the same public acknowledgment. The source is an HMAC of Cloudflare's client-IP
header; other hosts share an `unknown` source bucket. Global budgets still apply
if a client can vary its apparent source. Expired counter rows are reclaimed on
submission; requests remain available for admin review, with 25 per page. A
security-invoker queue view bounds displayed field lengths even for old oversized
rows, preserves admin-only RLS, and leaves the original records intact.

Canonical path guards reject new unsafe package/photo/snapshot references.
The migration warns about existing unsafe references without deleting their
documents; download/signing routes refuse those legacy paths too. Review those
warnings and re-upload affected files. Safe legacy package directories such as
`packages/x/resume.pdf` remain supported. Job-slot counters are initialized from
existing open in-app jobs; a firm already over its cap can edit or close its jobs,
but cannot acquire another slot until it is below its cap. Privileged admin/service
inserts retain their existing quota bypass while still updating the counters.

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
| `npm run test:unit` | Database-free regression tests |
| `npm test` | RLS suite — needs a local Supabase and `.env.test` (see above) |
| `npm run db:reset` | Reapply migrations + seed to the local database |

CI (`.github/workflows/ci.yml`) runs lint, `typecheck:tests`, unit tests and build on every
push and pull request. `npm test` is **not** in that path — it needs the live
database described above — and is available as a manual `workflow_dispatch`
run instead.

## Rules (v1)

- Apply with profile documents (or application-specific PDF uploads) only on **in-app jobs** (`kind = job`, no `external_url`).
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
| Member | `/feed`, `/applications`, `/profile`, `/members`, `/messages` |
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

### Profile application documents

Members manage a resume and optional cover letter in `/profile#documents`. In-app applications use those documents automatically; either PDF can be replaced for a single application without changing the profile. Submitted files are immutable snapshots. `/packages` redirects to the profile.

Apply migration `20261101045550_profile_documents.sql` with this app change. It creates the owner-only `member_documents` table, imports each member’s previous default (or newest) package, and points resume-book/search RPCs at the profile resume. Historical packages and application snapshots are preserved.

### Migration checklist for this release

If the hosted database already has migrations through `0015_rls_invariants.sql`, apply these two files in order before deploying the updated app:

1. `20261101040104_security_boundary_fixes.sql` — canonical document paths, service-only access requests, the admin queue view, and atomic posting quotas.
2. `20261101045550_profile_documents.sql` — private profile documents, legacy document import, and updated talent RPCs.

If the database is older, apply any missing earlier migrations first, in filename order. Company feature overrides depend on `0012_company_access_overrides.sql`; sponsor demo mode needs no additional schema. Check the target project's migration history before running SQL: the timestamped migrations are not intended to be reapplied. This checklist does not confirm the hosted database's current state.
