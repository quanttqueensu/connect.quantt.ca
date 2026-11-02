-- Opportunities: quant job and internship listings pulled from public lists
-- (Simplify, Northwestern Fintech) by .github/workflows/opportunities.yml and
-- stored by worker.js (lib/jobs/store.ts). Separate from posts on purpose: the
-- feed stays for QUANTT and partner-firm posts, and these come and go daily.
--
-- url is the identity: the same link from two sources is one listing.
-- active = 0 once the source stops listing it; hidden = 1 when an admin hides it.

CREATE TABLE job_listings (
  id text PRIMARY KEY,
  url text NOT NULL UNIQUE,
  source text NOT NULL CHECK (source IN ('simplify', 'nwft')),
  company text NOT NULL,
  title text NOT NULL,
  locations text NOT NULL DEFAULT '[]' CHECK (json_valid(locations)),
  role_type text NOT NULL CHECK (role_type IN ('internship', 'full_time')),
  term text,
  posted_at text NOT NULL,
  first_seen_at text NOT NULL,
  last_seen_at text NOT NULL,
  active integer NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  hidden integer NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1))
);

CREATE INDEX job_listings_open_idx ON job_listings (posted_at DESC) WHERE active = 1 AND hidden = 0;
