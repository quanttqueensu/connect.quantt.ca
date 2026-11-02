-- Sponsor catalogue for a fresh database (local dev and tests).
-- Production gets its rows, ids included, from the Supabase import instead.

INSERT INTO sponsor_capabilities (key, label, description, kind, is_enforced, sort_order) VALUES
  ('post_in_app_job', 'Post in-app jobs', 'Jobs that take applications inside the hub. Blank limit means unlimited; a number caps concurrent open postings.', 'quota', 1, 10),
  ('read_applicants', 'Applicant pipeline', 'See who applied, open resumes, and move candidates through stages.', 'boolean', 1, 20),
  ('dm_initiate_applicant', 'Message applicants', 'Start a conversation with a member who applied to one of their postings.', 'boolean', 1, 30),
  ('post_event', 'Post events', 'Publish event postings to the member feed.', 'boolean', 1, 40),
  ('resume_book', 'Resume book', 'Browse opted-in members and their default hiring-package resume.', 'boolean', 1, 50),
  ('candidate_search', 'Candidate search', 'Search opted-in members by name, program, year, and interests.', 'boolean', 1, 60),
  ('dm_initiate_any', 'Message any member', 'Start a conversation with any member who opted into the resume book, not only applicants.', 'boolean', 1, 70);

INSERT INTO sponsor_tiers (id, key, name, rank, price_cents, blurb, applicant_embargo_hours, resume_book_embargo_hours, is_active, is_system) VALUES
  ('00000000-0000-4000-8000-000000000000', 'none', 'Not sponsoring', 0, NULL, 'Announcements, external listings, and replies to members.', 0, 0, 1, 1),
  ('00000000-0000-4000-8000-000000000999', 'grandfathered', 'Grandfathered (legacy access)', 999, NULL, 'Holds the access every firm had before tiers. Hidden from new assignments.', 0, 0, 0, 1),
  ('00000000-0000-4000-8000-000000000010', 'supporter', 'Supporter', 10, 50000, 'Basic platform access and the opt-in resume book.', 72, 0, 1, 0),
  ('00000000-0000-4000-8000-000000000020', 'partner', 'Partner', 20, 200000, 'Job posting privileges, the applicant pipeline, and the resume book.', 72, 0, 1, 0),
  ('00000000-0000-4000-8000-000000000030', 'leader', 'Leader', 30, 500000, 'Everything in Partner, plus candidate search, events, and faster applicant access.', 24, 0, 1, 0),
  ('00000000-0000-4000-8000-000000000040', 'principal', 'Principal', 40, 1000000, 'Priority access to every applicant the moment they apply, plus everything in Leader.', 0, 0, 1, 0);

INSERT INTO sponsor_tier_capabilities (tier_id, capability, value) VALUES
  ('00000000-0000-4000-8000-000000000010', 'resume_book', NULL),
  ('00000000-0000-4000-8000-000000000010', 'dm_initiate_applicant', NULL),
  ('00000000-0000-4000-8000-000000000010', 'read_applicants', NULL),
  ('00000000-0000-4000-8000-000000000010', 'post_in_app_job', 1),
  ('00000000-0000-4000-8000-000000000020', 'resume_book', NULL),
  ('00000000-0000-4000-8000-000000000020', 'dm_initiate_applicant', NULL),
  ('00000000-0000-4000-8000-000000000020', 'read_applicants', NULL),
  ('00000000-0000-4000-8000-000000000020', 'post_in_app_job', NULL),
  ('00000000-0000-4000-8000-000000000030', 'dm_initiate_any', NULL),
  ('00000000-0000-4000-8000-000000000030', 'candidate_search', NULL),
  ('00000000-0000-4000-8000-000000000030', 'resume_book', NULL),
  ('00000000-0000-4000-8000-000000000030', 'post_event', NULL),
  ('00000000-0000-4000-8000-000000000030', 'dm_initiate_applicant', NULL),
  ('00000000-0000-4000-8000-000000000030', 'read_applicants', NULL),
  ('00000000-0000-4000-8000-000000000030', 'post_in_app_job', NULL),
  ('00000000-0000-4000-8000-000000000040', 'dm_initiate_any', NULL),
  ('00000000-0000-4000-8000-000000000040', 'candidate_search', NULL),
  ('00000000-0000-4000-8000-000000000040', 'resume_book', NULL),
  ('00000000-0000-4000-8000-000000000040', 'post_event', NULL),
  ('00000000-0000-4000-8000-000000000040', 'dm_initiate_applicant', NULL),
  ('00000000-0000-4000-8000-000000000040', 'read_applicants', NULL),
  ('00000000-0000-4000-8000-000000000040', 'post_in_app_job', NULL),
  ('00000000-0000-4000-8000-000000000999', 'post_event', NULL),
  ('00000000-0000-4000-8000-000000000999', 'dm_initiate_applicant', NULL),
  ('00000000-0000-4000-8000-000000000999', 'read_applicants', NULL),
  ('00000000-0000-4000-8000-000000000999', 'post_in_app_job', NULL);
