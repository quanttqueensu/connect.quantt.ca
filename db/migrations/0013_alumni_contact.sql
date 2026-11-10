-- Alumni contact details, required before an alum uses Connect (lib/alumni/profile.ts).
-- phone is shown to QUANTT admins only; other_social_url (X, GitHub, website) is public like LinkedIn.
-- Additive only: existing rows keep everything and get NULL here.
-- Also added on first use by ensureAlumniTables (lib/alumni/schema.ts), so this file can lag a deploy.
ALTER TABLE alumni ADD COLUMN phone text;
ALTER TABLE alumni ADD COLUMN other_social_url text;
