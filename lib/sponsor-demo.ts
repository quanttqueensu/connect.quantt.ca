import type { Application, Company, Conversation, Message, Post, Profile, SponsorCapability } from "@/lib/types";
import type { TierWithCaps } from "@/lib/tiers";

// These fixtures are never persisted. Non-UUID ids cannot identify production rows.
export const DEMO_COMPANY_ID = "sponsor-demo";
const CREATED_AT = "2026-01-01T12:00:00.000Z";

export const DEMO_CAPABILITIES: SponsorCapability[] = [
  { key: "post_in_app_job", label: "In-app job posts", description: "Publish jobs that accept applications through Connect.", kind: "quota", is_enforced: true, sort_order: 0 },
  { key: "read_applicants", label: "Applicants", description: "Review applications to your job posts.", kind: "boolean", is_enforced: true, sort_order: 1 },
  { key: "dm_initiate_applicant", label: "Message applicants", description: "Start conversations with applicants.", kind: "boolean", is_enforced: true, sort_order: 2 },
  { key: "post_event", label: "Event posts", description: "Share events with members.", kind: "boolean", is_enforced: true, sort_order: 3 },
  { key: "resume_book", label: "Resume book", description: "Browse the opt-in talent directory.", kind: "boolean", is_enforced: true, sort_order: 4 },
  { key: "candidate_search", label: "Candidate search", description: "Search the talent directory.", kind: "boolean", is_enforced: true, sort_order: 5 },
  { key: "dm_initiate_any", label: "Message talent", description: "Start conversations with opted-in members.", kind: "boolean", is_enforced: true, sort_order: 6 },
];

export const DEMO_TIER: TierWithCaps = {
  id: "demo-package", key: "demo", name: "Demo sponsor package", rank: 1,
  price_cents: null, blurb: "Sample package for the admin preview. No real sponsorship is attached.",
  applicant_embargo_hours: 0, resume_book_embargo_hours: 0,
  is_active: true, is_system: false, created_at: CREATED_AT,
  sponsor_tier_capabilities: DEMO_CAPABILITIES.map((cap) => ({ tier_id: "demo-package", capability: cap.key, value: cap.kind === "quota" ? 5 : null })),
};

export const DEMO_COMPANY: Company = {
  id: DEMO_COMPANY_ID, name: "Demo Sponsor", slug: "demo-sponsor",
  sponsor_tier_id: DEMO_TIER.id, grace_tier_id: null, tier_grace_until: null,
  logo_url: null, website: "https://example.com", description: "A fictional company for exploring the sponsor experience.",
  status: "active", created_at: CREATED_AT,
};

export const DEMO_MEMBERS: Profile[] = ["Alex Example", "Taylor Sample"].map((name, index) => ({
  id: `demo-member-${index + 1}`, full_name: name, email: `demo${index + 1}@example.com`,
  role: "member", is_admin: false, program: index ? "Commerce" : "Computer Science", grad_year: 2028,
  bio: "Fictional candidate included for demonstration.", interests: index ? "Markets and research" : "Software and data",
  linkedin_url: null, github_url: null, website_url: null, photo_path: null, created_at: CREATED_AT,
  resume_book_opt_in: true, resume_book_opt_in_at: CREATED_AT, resume_book_opt_in_by: null,
}));

export const DEMO_POSTS: Post[] = [{
  id: "demo-post-1", author_id: "demo-contact", company_id: DEMO_COMPANY_ID,
  kind: "job", title: "Sample analyst internship", body: "This is a fictional job posting. Use it to explore the sponsor experience without accessing real applications.",
  location: "Toronto, ON", starts_at: null, published: true, status: "open", role_type: "internship",
  term_season: "summer", term_year: 2027, external_url: null, created_at: CREATED_AT, updated_at: CREATED_AT,
}];

export const DEMO_APPLICATIONS: Application[] = DEMO_MEMBERS.map((member, index) => ({
  id: `demo-application-${index + 1}`, member_id: member.id, kind: "in_app", post_id: DEMO_POSTS[0].id,
  company_id: DEMO_COMPANY_ID, company_name: DEMO_COMPANY.name, package_id: null,
  package_name: "Sample hiring package", linkedin_url: null, resume_path: null,
  cover_letter: "This is sample application text. No real candidate information or documents are included.",
  cover_letter_path: null, stage: index ? "reviewing" : "submitted", notes: null,
  created_at: CREATED_AT, updated_at: CREATED_AT, posts: DEMO_POSTS[0], profiles: member,
}));

export const DEMO_CONVERSATIONS: Conversation[] = [{
  id: "demo-conversation-1", member_id: DEMO_MEMBERS[0].id, company_id: DEMO_COMPANY_ID,
  member_last_read_at: null, company_last_read_at: null, created_at: CREATED_AT,
  profiles: DEMO_MEMBERS[0],
}];

export const DEMO_MESSAGES: Message[] = [{
  id: "demo-message-1", conversation_id: DEMO_CONVERSATIONS[0].id, sender_id: DEMO_MEMBERS[0].id,
  body: "This is a sample message from a fictional candidate. No real conversations appear in sponsor mode.", created_at: CREATED_AT,
}];
