-- No sponsor delays any more: every tier sees new applications and resume book
-- opt-ins straight away (Ethan, 2026-11-02). The columns stay for old rows; the
-- app no longer reads them.
UPDATE sponsor_tiers SET applicant_embargo_hours = 0, resume_book_embargo_hours = 0;
