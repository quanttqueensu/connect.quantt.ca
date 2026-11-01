-- company_join_request_queue: the admin review list, with each field cut to
-- its form limit (from 20261101040104_security_boundary_fixes.sql). Admin-only;
-- lib/db/rules.ts scopes it.
CREATE VIEW company_join_request_queue AS
SELECT id,
       created_at,
       status,
       substr(company_name, 1, 200) AS company_name,
       substr(contact_name, 1, 120) AS contact_name,
       substr(contact_email, 1, 254) AS contact_email,
       substr(note, 1, 2000) AS note
  FROM company_join_requests;
