# QUANTT Hub (Sponsor Connection)

Invite-only hub for QUANTT members and companies. Members see a global feed and apply to in-app jobs using their profile resume and optional cover letter. Companies see only their own posts and applicants.

The public brochure site remains [quantt-website](https://github.com). This app is Quantt-branded (navy, Inter, Merriweather) but is a separate product.

## Stack

Next.js 16, React 19, Tailwind 4, on Cloudflare Workers (OpenNext) with D1
(database) and R2 (files), all in the quanttgroup Cloudflare account.

Node **22.20.0** (see `.nvmrc` and the `engines` field in `package.json`). Run
`nvm use` in the repo root to pick it up.

## How it works

- **Database:** D1 `connect-db` (binding `DB`). Schema in `db/migrations/`
  (`npx wrangler d1 migrations apply connect-db --remote`); `db/seed.sql` has the
  sponsor tiers for a fresh database.
- **Files:** R2 `connect-files` (binding `FILES`), keys `resumes/<path>` and
  `photos/<path>`. Pages hand out signed links to `/files/...`
  (`app/files/[...path]/route.ts`), valid for minutes, signed with `FILES_SIGNING_KEY`.
- **Queries:** `lib/supabase/server.ts` and `lib/supabase/admin.ts` keep their old
  names but return the D1/R2 client in `lib/db/client.ts`. It takes the same calls as
  supabase-js (`from().select().eq()`, embeds, `rpc`, `storage`), so pages didn't change.
- **Permissions:** the old RLS policies live in `lib/db/policies.ts` and
  `lib/db/rules.ts` and run on every query for the signed-in person. Hidden rows are
  skipped silently; a refused write returns error `42501`. `createAdminClient()` skips
  them, so check who may do what first.
- **Sign-in:** members use Sign in with QUANTT (auth.quantt.ca, below), like the
  calendar. Sponsors get a six-digit emailed code (Resend, `lib/cf-auth/`), valid once
  for 10 minutes. The session is an HttpOnly cookie `connect_session`; D1 keeps only its
  hash, for 30 days. Nobody has a password. An invite is just an `invites` row: the
  person's profile is created the first time they sign in with that email.
- **Cron:** `worker.js` `scheduled` runs hourly: it syncs headshots and resumes from
  auth.quantt.ca (below), and at 08:00 UTC also deletes expired sessions, codes and
  join-form counters.
- **Headshots and resumes:** uploaded once on auth.quantt.ca. Each member's profile has
  **Keep in sync** (on by default): while on, Connect copies a newer upload from the
  directory at sign-in, when they open their profile, and hourly, and locks its own photo and
  resume upload; turned off, the member uploads their own files here. Copies go to new R2
  keys, so nothing earlier is deleted. Table `directory_sync` (`db/migrations/0007`, also
  created on first use). Code: `lib/directory-files.ts`.

## Setup (a new copy)

1. In the quanttgroup Cloudflare account: `npx wrangler d1 create connect-db` and
   `npx wrangler r2 bucket create connect-files`. Put the database id in `wrangler.jsonc`.
2. `npx wrangler d1 migrations apply connect-db --remote`, then
   `npx wrangler d1 execute connect-db --remote --file db/seed.sql`.
3. Worker secrets on `quantt-connect`: `RESEND_API_KEY`, `FILES_SIGNING_KEY`
   (`openssl rand -hex 32`), `OPPORTUNITIES_SYNC_TOKEN` (see Opportunities). Optional `LOGIN_EMAIL_FROM`
   (default `QUANTT Connect <connect@quantt.ca>`; its domain must be verified in Resend).
   Variable `NEXT_PUBLIC_SITE_URL=https://connect.quantt.ca`.
4. First admin:

```bash
npx wrangler d1 execute connect-db --remote --command \
  "INSERT INTO invites (id, email, full_name, role, is_admin) VALUES (lower(hex(randomblob(16))), 'you@queensu.ca', 'Your Name', 'member', 1)"
```

   Then sign in at `/login` with that email.

## Moving the data from Supabase

`npm run import:supabase` (`scripts/import-supabase.mjs`) reads every table and
both storage buckets with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, and
writes `./supabase-export/`: `d1-import.sql`, `files/` and `r2-upload.sh`. Then,
logged in to quanttgroup:

```bash
npx wrangler d1 execute connect-db --remote --file supabase-export/d1-import.sql
sh supabase-export/r2-upload.sh
```

The import can be run again; it replaces what's there. The folder holds member
data and resumes: it's gitignored, delete it afterwards.

## Opportunities

`/opportunities` lists open quant internships and new-grad roles for club members
(sponsors don't see it). It piggybacks on public lists other people keep current,
rather than scraping firms' career sites:

- Simplify's [internship](https://github.com/SimplifyJobs/Summer2027-Internships) and
  [new-grad](https://github.com/SimplifyJobs/New-Grad-Positions) lists, "Quant" category only.
- Northwestern Fintech's [quant internship list](https://github.com/northwesternfintech/2027QuantInternships).

Once a day `.github/workflows/opportunities.yml` runs `scripts/sync-opportunities.mjs`,
which fetches the lists, keeps the quant roles whose term hasn't started
(`lib/jobs/sources.ts`), and POSTs them to `/api/opportunities/sync`. `worker.js`
answers that route before Next; `lib/jobs/store.ts` checks the bearer token and upserts
into `job_listings` by link. A listing a source stops showing is closed; closed
listings are deleted after 90 days. The fetching runs on GitHub, not the Worker,
because Simplify's files are about 13 MB each, more than a free-plan Worker's CPU allows.

One role is stored once: two links count as the same role when the firm and title match
after `roleKey` (Quant/Quantitative, Researcher/Research, Intern/Internship, word order,
firm suffixes) and the terms match or one source leaves the term out.

Admins can hide a listing from the page (Hide, then "Hidden listings" to undo).

Members can "Mark applied" on a listing: it adds an off-platform entry to their
Applications, linked by `applications.job_listing_id` (`db/migrations/0008`), and the
Applied filter shows applied or not-applied listings. "Applied ✓" undoes it.

Each run also posts the roles that weren't open before to #opportunities in the
QUANTT Discord from QUANTT Bot, grouped by internship term, then new grad, with a 🇨🇦
on Canadian roles (repo secret `DISCORD_BOT_TOKEN`; skipped without it). Run workflow
with "Post all open roles" ticked posts the whole list the same way.

Setup, once:

1. `npx wrangler d1 migrations apply connect-db --remote` (adds `job_listings`, and 0008's `applications.job_listing_id`).
2. Make a token with `openssl rand -hex 32`. Put it in the Worker secret
   `OPPORTUNITIES_SYNC_TOKEN` on `quantt-connect` and in the GitHub repo secret of the
   same name (Settings → Secrets and variables → Actions).
3. Keep workers.dev on for quantt-connect (Settings → Domains & Routes): the Action
   posts to https://quantt-connect.quanttgroup.workers.dev, because connect.quantt.ca
   answers GitHub's runners with a bot challenge. A repo variable `CONNECT_URL`
   overrides the address.
4. Actions → Opportunities → Run workflow, for the first fill.

Preview locally with `node --experimental-strip-types scripts/sync-opportunities.mjs --dry-run`.

## Sign in with QUANTT (club members)

Club members sign in only one way, the same as the calendar and the other QUANTT sites: **Sign in with your Queen's email** on `/login` sends them to auth.quantt.ca (the shared QUANTT member directory, behind Cloudflare Access), which sends them back to `/auth/quantt/callback` with a one-time code. The callback redeems the code through the service binding `AUTH` (the `quantt-auth` Worker), signs them in, creating their profile the first time, and copies their Connect role from auth.quantt.ca onto `is_admin` (Admin there makes them a hub admin; anyone else is a member). Emails that aren't in the directory, and company accounts, are refused. No secret is shared: only a Worker bound to `quantt-auth` in the same Cloudflare account can redeem a code. Code: `lib/quantt-signin.ts`, `app/auth/quantt/`. Emailed codes are for sponsors only: `/login` never sends one to a member account or member invite.

If the site runs anywhere but `https://connect.quantt.ca` (a preview, `http://localhost:3000` with `npm run preview`), list that origin in `CONNECT_ORIGINS` on `quantt-auth`.

## Alumni

Alumni have their own area at `/alumni`, kept apart from members and sponsors: their own tables (`alumni*`, `db/migrations/0006_alumni.sql`, also created on first use by `lib/alumni/schema.ts`), their own invites, sign-in codes and session cookie (`connect_alumni`). A member or sponsor session never opens the alumni area, and an alumni session never opens the member or company app.

- **Invite:** Admin → Alumni. The alum gets an email and signs in at `/alumni/login` with a six-digit code (10 minutes, 5 tries, 5 codes an hour). Removing an alum deletes their account, posts, messages and sessions.
- **Alumni can:** post jobs and mentorship offers (and close their own), browse current members and other alumni, message members, and edit their profile, including whether to get an email when a member messages them (off until they turn it on).
- **Members can:** see alumni posts and the alumni directory at `/alumni-network`, and message alumni. Alumni messages follow the member's normal Messages email setting.
- **Discord:** `/alumni/discord` has "Join the QUANTT Discord". The alum links their Discord account (Discord's consent screen, `identify guilds.join`) and the QUANTT Bot adds them to the server with the **Alumni** role and their name as nickname (`lib/alumni/discord.ts`, link stored in `alumni_discord`, `db/migrations/0007_alumni_discord.sql`). Removing an alum in Admin takes the Alumni role away; they stay in the server but see only #welcome. Only goes connect -> Discord, and the bot never touches member roles (auth.quantt.ca manages those). The Alumni role sees #welcome, #rules, #announcements, #events (read-only) and the Alumni Network category: #alumni-lounge, #alumni-jobs and Coffee Chats (shared with members) plus #alumni (alumni only).
  Setup: in the Discord developer portal, "QUANTT Bot" app -> OAuth2 -> Redirects, add `https://connect.quantt.ca/alumni/discord/callback`. On the `quantt-connect` Worker add secrets `DISCORD_CLIENT_SECRET` (same value as on `quantt-auth`) and `DISCORD_BOT_TOKEN`. `DISCORD_CLIENT_ID` and `DISCORD_GUILD_ID` are vars in `wrangler.jsonc`.
- `/alumni` is public in `middleware.ts` because the member/sponsor session doesn't apply there; `app/alumni/(hub)/layout.tsx` and every alumni action check the alumni session instead (`lib/alumni/current.ts`).

## Sponsor tiers and company overrides

Use **Admin → Sponsor tiers** to edit the features shared by a tier. Use
**Admin → Companies → Company feature overrides** for exceptions:

- **Follow tier** inherits the assigned tier and any current grandfathered access.
- **Enable for this company** grants the feature only to that company, with its own job limit when applicable (blank means unlimited).
- **Disable for this company** blocks the feature for that company.

Explicit overrides take priority and survive later tier edits or reassignment.
Choose **Follow tier** to reset one feature, or **Reset all features to tier defaults**
to clear all of a company's exceptions. Inactive companies keep their saved settings
but have no feature access until reactivated.

## Hosting: Cloudflare Workers

The hub runs as the Worker `quantt-connect`, built with [OpenNext](https://opennext.js.org/cloudflare) (`wrangler.jsonc`, `open-next.config.ts`), in the same account as `quantt-auth`. Workers Builds: build command `npx opennextjs-cloudflare build`, deploy command `npx opennextjs-cloudflare deploy`. PR preview builds are off (Settings → Builds → Previews Base).

Local: `npm run preview` runs the Worker build locally with local D1/R2
(`npx wrangler d1 migrations apply connect-db --local` first). Plain `next dev` has no bindings.

## Tests

`npm test` runs everything on in-memory SQLite (`node:sqlite`): the schema
(`tests/db/schema.test.ts`), the permission rules (`tests/db/policies.test.ts`), the
query layer (`tests/db/rest.test.ts`), sign-in (`tests/db/auth.test.ts`,
`tests/cf-switch.test.ts`) and the import. CI runs lint, test typecheck, tests and build.

Join-form limits use D1 counters (`join_admission`): 5 attempts per source per UTC
hour, 3 per email per UTC day, 100 globally per hour, 500 globally per day, and at
most 1,000 pending requests. Duplicates and throttled requests get the same answer.
The source is an HMAC (key `FILES_SIGNING_KEY`) of Cloudflare's client-IP header.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Next dev server |
| `npm run build` | Production build (also typechecks app code) |
| `npm run lint` | ESLint, including type-aware `no-floating-promises` — takes a minute or two |
| `npm run typecheck` | `tsc --noEmit` over app code |
| `npm run typecheck:tests` | `tsc --noEmit` over `tests/` |
| `npm test` / `npm run test:unit` | All tests, on in-memory SQLite |
| `npm run import:supabase` | Copy the data out of Supabase (see above) |

CI (`.github/workflows/ci.yml`) runs lint, `typecheck:tests`, tests and build on every
push and pull request.

## Rules (v1)

- Apply with profile documents (or application-specific PDF uploads) only on **in-app jobs** (`kind = job`, no `external_url`).
- Posts can have comments. Comments are not applications.
- External job links: “Open listing”, optional off-platform log.
- Member feed is global. Companies see **only their own posts**.
- Email: sign-in codes and invite notices go through Resend. If an invite email
  fails, the invite still works and the admin screen says to tell the person to sign in.
  Notification emails (`lib/notifications.ts`): new messages (both sides, at most one
  per conversation every 15 minutes), new applications (sponsors), application stage
  changes and, if turned on, new jobs (members). They are all off until each person turns them on
  under Profile (members) or Sponsorship (sponsors). Emails never include message text.
- Resumes: PDF, 5MB. Photos: ~2MB.

## Routes

| Who | Paths |
| --- | --- |
| Public | `/` (landing), `/for-companies`, `/login`, `/join`, `/auth/quantt/*`, `/files/*` (signed links), `/alumni/*` (checks its own session). `POST /api/opportunities/sync` is answered by `worker.js` with a bearer token, before the middleware. |
| Member | `/feed`, `/opportunities`, `/applications`, `/profile`, `/members`, `/messages`, `/alumni-network` |
| Alumni | `/alumni/login`, then `/alumni` (posts), `/alumni/members`, `/alumni/directory`, `/alumni/messages`, `/alumni/discord`, `/alumni/profile`, with the separate alumni session |
| Company | `/company`, `/company/posts/new`, `/company/applicants`, `/company/messages` |
| Admin | `/admin` panel (invite, people, companies, requests, posts, applications, alumni). Admins are also members and use the member app separately. |

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
