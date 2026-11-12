-- The resume book is opt-out (Ethan, 2026-11-12): every current member is in
-- unless they withdraw. New profiles start opted in (lib/cf-auth/accounts.ts);
-- this puts existing members who never opted in into the book. They can
-- withdraw from their profile.
UPDATE profiles
   SET resume_book_opt_in = 1, resume_book_opt_in_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), resume_book_opt_in_by = NULL
 WHERE role = 'member' AND resume_book_opt_in = 0
   -- Graduates were taken out of the book when they became alumni; leave them out.
   AND id NOT IN (SELECT profile_id FROM alumni_graduation WHERE profile_id IS NOT NULL AND suspended_at IS NULL);
