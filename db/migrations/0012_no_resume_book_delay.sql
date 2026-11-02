-- The resume book has no delay any more: every tier sees a new opt-in straight
-- away (Ethan, 2026-11-02). The column stays for old rows; the app no longer reads it.
UPDATE sponsor_tiers SET resume_book_embargo_hours = 0;
