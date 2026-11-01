import { describe, expect, it } from "vitest";

import { buildImportSql, convertRow, findProblems, r2UploadScript, sqlLiteral, toIso } from "../../scripts/import-core.mjs";

import { all, freshDb } from "./sqlite";

const T = "3ba237c4-8614-4516-868d-3e7eba8b5161";
const MEMBER = "9b6c2f1e-1111-4111-8111-000000000001";
const RECRUITER = "9b6c2f1e-1111-4111-8111-000000000002";
const FIRM = "9b6c2f1e-1111-4111-8111-000000000003";
const POST = "9b6c2f1e-1111-4111-8111-000000000004";
const APP = "9b6c2f1e-1111-4111-8111-000000000005";

/** Rows as Supabase's REST API returns them. */
function sample() {
  return {
    sponsor_capabilities: [
      { key: "read_applicants", label: "Applicant pipeline", description: "d", kind: "boolean", is_enforced: true, sort_order: 20 },
    ],
    sponsor_tiers: [
      { id: T, key: "none", name: "Not sponsoring", rank: 0, price_cents: null, blurb: "", applicant_embargo_hours: 0, is_active: true, is_system: true, created_at: "2026-10-01T10:00:00.123456+00:00", resume_book_embargo_hours: 0 },
      { id: "7128af78-00d0-4601-83a6-2b291935c8c9", key: "principal", name: "Principal", rank: 40, price_cents: 1000000, blurb: "It's top", applicant_embargo_hours: 0, is_active: true, is_system: false, created_at: "2026-10-01T10:00:00+00:00", resume_book_embargo_hours: 0 },
    ],
    sponsor_tier_capabilities: [{ tier_id: "7128af78-00d0-4601-83a6-2b291935c8c9", capability: "read_applicants", value: null }],
    profiles: [
      { id: MEMBER, email: "Ann@QueensU.ca", full_name: "Ann O'Neil", role: "member", is_admin: false, program: null, grad_year: 2027, bio: null, interests: null, linkedin_url: null, github_url: null, website_url: null, photo_path: null, created_at: "2026-09-01T00:00:00+00:00", resume_book_opt_in: true, resume_book_opt_in_at: "2026-09-02T00:00:00+00:00", resume_book_opt_in_by: MEMBER },
      { id: RECRUITER, email: "rita@acme.com", full_name: "Rita", role: "company_user", is_admin: false, program: null, grad_year: null, bio: null, interests: null, linkedin_url: null, github_url: null, website_url: null, photo_path: null, created_at: "2026-09-01T00:00:00+00:00", resume_book_opt_in: false, resume_book_opt_in_at: null, resume_book_opt_in_by: null },
    ],
    companies: [
      { id: FIRM, name: "Acme", slug: "acme", logo_url: null, website: null, description: null, status: "active", created_at: "2026-09-01T00:00:00+00:00", sponsor_tier_id: "7128af78-00d0-4601-83a6-2b291935c8c9", grace_tier_id: null, tier_grace_until: "2026-12-31" },
    ],
    company_users: [{ company_id: FIRM, profile_id: RECRUITER }],
    posts: [
      { id: POST, author_id: RECRUITER, company_id: FIRM, kind: "job", title: "Analyst", body: "", location: null, starts_at: null, published: true, status: "open", role_type: "internship", term_season: "summer", term_year: 2027, external_url: null, created_at: "2026-09-03T00:00:00+00:00", updated_at: "2026-09-03T00:00:00+00:00" },
    ],
    applications: [
      // An older row with a pre-0006 path still has to load.
      { id: APP, member_id: MEMBER, kind: "in_app", post_id: POST, company_id: FIRM, company_name: null, package_id: null, package_name: null, linkedin_url: null, resume_path: `${MEMBER}/packages/x/resume.pdf`, cover_letter: null, cover_letter_path: null, stage: "submitted", notes: null, created_at: "2026-09-04T00:00:00+00:00", updated_at: "2026-09-04T00:00:00+00:00" },
    ],
    sponsor_tier_events: [
      { id: "9b6c2f1e-1111-4111-8111-000000000009", kind: "tier_created", tier_id: T, company_id: null, detail: { note: "a'b" }, actor_id: null, created_at: "2026-09-01T00:00:00+00:00" },
    ],
  };
}

describe("Supabase import", () => {
  it("converts Postgres values to D1's", () => {
    expect(toIso("2026-10-01T10:00:00.123456+00:00")).toBe("2026-10-01T10:00:00.123Z");
    expect(toIso("2026-12-31")).toBe("2026-12-31");
    expect(sqlLiteral("it's")).toBe("'it''s'");
    expect(sqlLiteral(true)).toBe("1");
    expect((convertRow("sponsor_tier_events", { detail: { a: 1 } }) as { detail: string }).detail).toBe('{"a":1}');
  });

  it("loads into a fresh D1 schema, and runs again cleanly", () => {
    const db = freshDb({ seed: false }); // production starts empty: no dev seed
    const sql = buildImportSql(sample());
    db.exec(sql);
    db.exec(sql);
    expect(all(db, "SELECT key FROM sponsor_tiers ORDER BY rank").map((r) => r.key)).toEqual(["none", "principal"]);
    expect(all(db, "SELECT email, full_name, is_admin, resume_book_opt_in FROM profiles WHERE id = ?", MEMBER)[0]).toEqual({
      email: "Ann@QueensU.ca", full_name: "Ann O'Neil", is_admin: 0, resume_book_opt_in: 1,
    });
    expect(all(db, "SELECT detail FROM sponsor_tier_events")[0].detail).toBe('{"note":"a\'b"}');
    expect(all(db, "SELECT count(*) AS n FROM applications")[0].n).toBe(1);
    expect(all(db, "PRAGMA foreign_key_check")).toEqual([]);
  });

  it("flags emails that only differ in case", () => {
    const data = sample();
    data.profiles.push({ ...data.profiles[0], id: "9b6c2f1e-1111-4111-8111-00000000000a", email: "ann@queensu.ca" });
    expect(findProblems(data)).toHaveLength(1);
    expect(findProblems(sample())).toEqual([]);
  });

  it("quotes file names safely in the R2 upload script", () => {
    const script = r2UploadScript("connect-files", [{ key: "photos/a/it's.png", local: "/tmp/x/it's.png", contentType: "image/png" }]);
    expect(script).toContain(`'connect-files/photos/a/it'\\''s.png'`);
    expect(script).toContain("--remote");
  });
});
