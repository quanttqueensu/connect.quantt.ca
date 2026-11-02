-- "Mark applied" on /opportunities: an off-platform application can point at
-- the listing it came from, once per member and listing. When a closed listing
-- is cleaned up (90 days) the application stays in the tracker, unlinked.

ALTER TABLE applications ADD COLUMN job_listing_id text REFERENCES job_listings (id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS applications_one_per_listing
  ON applications (member_id, job_listing_id) WHERE job_listing_id IS NOT NULL;
