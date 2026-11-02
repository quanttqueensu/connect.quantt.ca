/**
 * The D1 permission rules, checked against the same situations the
 * Supabase RLS suite (tests/rls) covers, on a real SQLite database.
 */
import { describe, expect, it } from "vitest";

import { resolveCompanyAccess } from "@/lib/db/access";
import {
  applicationInsert,
  applicationsScope,
  assertApplicationUpdate,
  assertCompanyUpdate,
  assertConversationInsert,
  assertJobSlot,
  assertMessageInsert,
  assertPostInsert,
  assertPostUpdate,
  canReadFile,
  canWriteFile,
  cleanJoinRequest,
  companiesScope,
  contactableOptInSql,
  conversationsScope,
  Denied,
  documentsScope,
  joinAdmissionBuckets,
  messagesScope,
  openInAppJobCountSql,
  postsScope,
  profilesScope,
  profileUpdate,
  talentListSql,
  visibleApplicantSql,
  type ProfileRow,
} from "@/lib/db/policies";

import {
  addApplication,
  addCompany,
  addMember,
  addPost,
  addResume,
  all,
  freshDb,
  hoursAgo,
  loadAccess,
  NOW,
  run,
  TIER,
  uuid,
  viewer,
  where,
  type Db,
} from "./sqlite";

function exists(db: Db, q: { sql: string; params: unknown[] }) {
  if (q.sql === "0") return false;
  return all(db, { sql: `SELECT ${q.sql} AS ok`, params: q.params })[0].ok === 1;
}

function profileRow(db: Db, id: string): ProfileRow {
  return all<ProfileRow>(db, `SELECT * FROM profiles WHERE id = ?`, id)[0];
}

describe("firm access", () => {
  it("an inactive firm has no capabilities", () => {
    const db = freshDb();
    const firm = addCompany(db, "principal", { status: "inactive" });
    const access = loadAccess(db, firm.companyId)!;
    expect(access.has("read_applicants")).toBe(false);
    expect(access.has("post_in_app_job")).toBe(false);
  });

  it("a firm in grace keeps its old package until the grace date passes", () => {
    const db = freshDb();
    const firm = addCompany(db, "none", { grace: "grandfathered", graceUntil: "2026-11-01" });
    expect(loadAccess(db, firm.companyId, NOW)!.has("post_event")).toBe(true);
    const nextDay = new Date("2026-11-02T00:00:01Z");
    expect(loadAccess(db, firm.companyId, nextDay)!.has("post_event")).toBe(false);
  });

  it("an override can revoke or grant a capability and set a quota", () => {
    const db = freshDb();
    const firm = addCompany(db, "principal");
    run(db, `INSERT INTO company_capability_overrides VALUES (?, 'resume_book', 0, NULL)`, firm.companyId);
    run(db, `INSERT INTO company_capability_overrides VALUES (?, 'post_in_app_job', 1, 2)`, firm.companyId);
    const access = loadAccess(db, firm.companyId)!;
    expect(access.has("resume_book")).toBe(false);
    expect(access.has("post_in_app_job")).toBe(true);
    expect(access.value("post_in_app_job")).toBe(2);
  });

  it("uses the assigned package's book delay when that package has the book", () => {
    const access = resolveCompanyAccess(
      {
        company: { id: "c", status: "active", sponsor_tier_id: "a", grace_tier_id: "g", tier_grace_until: "2099-01-01" },
        tiers: [
          { id: "a", applicant_embargo_hours: 72, resume_book_embargo_hours: 168 },
          { id: "g", applicant_embargo_hours: 0, resume_book_embargo_hours: 0 },
        ],
        tierCapabilities: [{ tier_id: "a", capability: "resume_book", value: null }],
        overrides: [],
      },
      NOW,
    );
    expect(access.effectiveTierId).toBe("g");
    expect(access.applicantEmbargoHours).toBe(0);
  });
});

describe("read scopes", () => {
  it("a signed-out visitor sees nothing", () => {
    const db = freshDb();
    const firm = addCompany(db, "partner");
    addPost(db, firm.companyId, firm.userId, { kind: "announcement" });
    expect(where(db, "posts", "p", postsScope(null))).toEqual([]);
    expect(where(db, "profiles", "p", profilesScope(null))).toEqual([]);
    expect(where(db, "companies", "c", companiesScope(null))).toEqual([]);
  });

  it("members see the published feed; firms see only their own posts", () => {
    const db = freshDb();
    const member = addMember(db);
    const a = addCompany(db, "partner");
    const b = addCompany(db, "partner");
    const aPost = addPost(db, a.companyId, a.userId, { kind: "announcement" });
    const aDraft = addPost(db, a.companyId, a.userId, { kind: "announcement", published: false });
    const bPost = addPost(db, b.companyId, b.userId, { kind: "announcement" });

    expect(where(db, "posts", "p", postsScope(viewer(db, member)))).toEqual([aPost, bPost].sort());
    expect(where(db, "posts", "p", postsScope(viewer(db, a.userId)))).toEqual([aPost, aDraft].sort());
  });

  it("members see active firms only; firms see only themselves", () => {
    const db = freshDb();
    const member = addMember(db);
    const a = addCompany(db, "partner");
    addCompany(db, "partner", { status: "inactive" });
    expect(where(db, "companies", "c", companiesScope(viewer(db, member)))).toEqual([a.companyId]);
    expect(where(db, "companies", "c", companiesScope(viewer(db, a.userId)))).toEqual([a.companyId]);
  });

  it("a firm sees an applicant only after its applicant embargo", () => {
    const db = freshDb();
    const member = addMember(db);
    const partner = addCompany(db, "partner");
    const principal = addCompany(db, "principal");
    const pPost = addPost(db, partner.companyId, partner.userId);
    const qPost = addPost(db, principal.companyId, principal.userId);
    const fresh = addApplication(db, member, pPost, hoursAgo(1));
    const instant = addApplication(db, member, qPost, hoursAgo(1));

    const partnerView = viewer(db, partner.userId);
    expect(where(db, "applications", "ap", applicationsScope(partnerView))).toEqual([]);
    expect(where(db, "profiles", "p", profilesScope(partnerView))).toEqual([partner.userId]);

    run(db, `UPDATE applications SET created_at = ? WHERE id = ?`, hoursAgo(73), fresh);
    expect(where(db, "applications", "ap", applicationsScope(viewer(db, partner.userId)))).toEqual([fresh]);
    expect(where(db, "profiles", "p", profilesScope(viewer(db, partner.userId)))).toContain(member);

    expect(where(db, "applications", "ap", applicationsScope(viewer(db, principal.userId)))).toEqual([instant]);
    expect(where(db, "applications", "ap", applicationsScope(viewer(db, member)))).toEqual([fresh, instant].sort());
  });

  it("a firm never sees another firm's applicants", () => {
    const db = freshDb();
    const member = addMember(db);
    const a = addCompany(db, "principal");
    const b = addCompany(db, "principal");
    addApplication(db, member, addPost(db, a.companyId, a.userId), hoursAgo(100));
    const bView = viewer(db, b.userId);
    expect(where(db, "applications", "ap", applicationsScope(bView))).toEqual([]);
    expect(where(db, "profiles", "p", profilesScope(bView))).toEqual([b.userId]);
  });

  it("a none-tier firm cannot see applicants at all", () => {
    const db = freshDb();
    const member = addMember(db);
    const firm = addCompany(db, "none");
    addApplication(db, member, addPost(db, firm.companyId, firm.userId), hoursAgo(100));
    expect(exists(db, visibleApplicantSql(viewer(db, firm.userId), `'${member}'`))).toBe(false);
  });

  it("members read each other's profiles; firms do not get the directory", () => {
    const db = freshDb();
    const m1 = addMember(db);
    const m2 = addMember(db);
    const firm = addCompany(db, "principal");
    expect(where(db, "profiles", "p", profilesScope(viewer(db, m1)))).toEqual([m1, m2].sort());
    expect(where(db, "profiles", "p", profilesScope(viewer(db, firm.userId)))).toEqual([firm.userId]);
  });

  it("only the two sides read a conversation's messages", () => {
    const db = freshDb();
    const member = addMember(db);
    const outsider = addMember(db);
    const admin = addMember(db, { admin: true });
    const a = addCompany(db, "partner");
    const b = addCompany(db, "partner");
    const conv = uuid();
    run(db, `INSERT INTO conversations (id, member_id, company_id) VALUES (?, ?, ?)`, conv, member, a.companyId);
    const msg = uuid();
    run(db, `INSERT INTO messages (id, conversation_id, sender_id, body) VALUES (?, ?, ?, 'hi')`, msg, conv, member);

    expect(where(db, "messages", "m", messagesScope(viewer(db, member)))).toEqual([msg]);
    expect(where(db, "messages", "m", messagesScope(viewer(db, a.userId)))).toEqual([msg]);
    expect(where(db, "messages", "m", messagesScope(viewer(db, b.userId)))).toEqual([]);
    expect(where(db, "messages", "m", messagesScope(viewer(db, outsider)))).toEqual([]);
    expect(where(db, "messages", "m", messagesScope(viewer(db, admin)))).toEqual([]);
    expect(where(db, "conversations", "cv", conversationsScope(viewer(db, admin)))).toEqual([conv]);
    expect(where(db, "conversations", "cv", conversationsScope(viewer(db, b.userId)))).toEqual([]);
  });

  it("member documents are private to the member, admins included", () => {
    const db = freshDb();
    const member = addMember(db);
    const admin = addMember(db, { admin: true });
    addResume(db, member);
    const docs = (id: string) =>
      all(db, { sql: `SELECT member_id FROM member_documents d WHERE ${documentsScope(viewer(db, id)).sql}`, params: documentsScope(viewer(db, id)).params });
    expect(docs(member)).toHaveLength(1);
    expect(docs(admin)).toHaveLength(0);
  });
});

describe("resume book and candidate search", () => {
  function setup(tier: "none" | "partner" | "leader" | "principal", optedHoursAgo: number) {
    const db = freshDb();
    const firm = addCompany(db, tier);
    const member = addMember(db, { optInAt: hoursAgo(optedHoursAgo) });
    addResume(db, member);
    const hidden = addMember(db);
    addResume(db, hidden);
    return { db, firm, member, v: viewer(db, firm.userId) };
  }

  it("a none-tier firm cannot list the book", () => {
    const { v } = setup("none", 1000);
    expect(talentListSql(v, "resume_book")).toBeNull();
  });

  it("a principal firm sees a just-opted-in member immediately", () => {
    const { db, member, v } = setup("principal", 0);
    expect(all(db, talentListSql(v, "resume_book")!).map((r) => r.id)).toEqual([member]);
  });

  it("a new opt-in shows in the book straight away, at every tier", () => {
    for (const tier of ["partner", "leader", "principal"] as const) {
      const fresh = setup(tier, 0);
      expect(all(fresh.db, talentListSql(fresh.v, "resume_book")!).map((r) => r.id)).toEqual([fresh.member]);
    }
  });

  it("candidate search is closed below leader and filters by text", () => {
    expect(talentListSql(setup("partner", 1000).v, "candidate_search", { q: "x" })).toBeNull();
    const { db, member, v } = setup("leader", 1000);
    run(db, `UPDATE profiles SET interests = 'Options market making' WHERE id = ?`, member);
    expect(all(db, talentListSql(v, "candidate_search", { q: "MARKET" })!).map((r) => r.id)).toEqual([member]);
    expect(all(db, talentListSql(v, "candidate_search", { q: "100%" })!)).toEqual([]);
  });

  it("only opted-in members' files are readable by a talent firm", () => {
    const { db, member, v } = setup("principal", 1000);
    const optedIn = exists(db, contactableOptInSql(v, `'${member}'`));
    expect(optedIn).toBe(true);
    expect(canReadFile(v, "resumes", `${member}/packages/main/resume.pdf`, { talentOptedIn: optedIn })).toBe(true);
    expect(canReadFile(v, "resumes", `${member}/packages/main/resume.pdf`)).toBe(false);
  });
});

describe("write checks", () => {
  it("members cannot promote themselves or change their email", () => {
    const db = freshDb();
    const member = addMember(db);
    const patch = profileUpdate(viewer(db, member), profileRow(db, member), {
      full_name: "New",
      is_admin: 1,
      role: "company_user",
      email: "x@y.z",
    });
    expect(patch).toEqual({ full_name: "New" });
  });

  it("a member cannot edit someone else; an admin can", () => {
    const db = freshDb();
    const m1 = addMember(db);
    const m2 = addMember(db);
    const admin = addMember(db, { admin: true });
    expect(() => profileUpdate(viewer(db, m1), profileRow(db, m2), { bio: "x" })).toThrow(Denied);
    expect(profileUpdate(viewer(db, admin), profileRow(db, m2), { is_admin: 1 })).toEqual({ is_admin: 1 });
  });

  it("only the member can grant resume book consent, stamped with server time", () => {
    const db = freshDb();
    const member = addMember(db);
    const admin = addMember(db, { admin: true });
    expect(() => profileUpdate(viewer(db, admin), profileRow(db, member), { resume_book_opt_in: 1 })).toThrow(
      /Only the member/,
    );
    const patch = profileUpdate(viewer(db, member), profileRow(db, member), {
      resume_book_opt_in: 1,
      resume_book_opt_in_at: "2000-01-01T00:00:00.000Z",
    });
    expect(patch).toMatchObject({ resume_book_opt_in: 1, resume_book_opt_in_at: NOW.toISOString(), resume_book_opt_in_by: member });
  });

  it("refuses a photo path outside the member's folder", () => {
    const db = freshDb();
    const member = addMember(db);
    const other = addMember(db);
    expect(() => profileUpdate(viewer(db, member), profileRow(db, member), { photo_path: `${other}/a.jpg` })).toThrow(
      /photo/,
    );
    expect(profileUpdate(viewer(db, member), profileRow(db, member), { photo_path: `${member}/a.jpg` })).toEqual({
      photo_path: `${member}/a.jpg`,
    });
  });

  it("a firm edits its own profile but not its tier, slug or status", () => {
    const db = freshDb();
    const a = addCompany(db, "partner");
    const b = addCompany(db, "partner");
    const v = viewer(db, a.userId);
    assertCompanyUpdate(v, a.companyId, { description: "x" });
    expect(() => assertCompanyUpdate(v, a.companyId, { sponsor_tier_id: TIER.principal })).toThrow(/admins/);
    expect(() => assertCompanyUpdate(v, b.companyId, { description: "x" })).toThrow(Denied);
  });

  it("posting events needs the event capability", () => {
    const db = freshDb();
    const partner = addCompany(db, "partner");
    const leader = addCompany(db, "leader");
    const event = (c: { companyId: string; userId: string }) => ({
      company_id: c.companyId, author_id: c.userId, kind: "event", external_url: null,
    });
    expect(() => assertPostInsert(viewer(db, partner.userId), event(partner))).toThrow(Denied);
    assertPostInsert(viewer(db, leader.userId), event(leader));
    expect(() => assertPostInsert(viewer(db, leader.userId), event(partner))).toThrow(Denied);
  });

  it("a firm cannot hand a post to someone else", () => {
    const db = freshDb();
    const a = addCompany(db, "partner");
    const before = { company_id: a.companyId, author_id: a.userId, kind: "announcement", external_url: null };
    expect(() => assertPostUpdate(viewer(db, a.userId), before, { ...before, author_id: uuid() })).toThrow(/author/);
  });

  it("enforces the in-app job quota", () => {
    const db = freshDb();
    const supporter = addCompany(db, "supporter");
    const none = addCompany(db, "none");
    const admin = addMember(db, { admin: true });
    const count = () => all<{ n: number }>(db, openInAppJobCountSql(supporter.companyId))[0].n;
    const firm = loadAccess(db, supporter.companyId);

    assertJobSlot(viewer(db, supporter.userId), firm, count(), "insert");
    addPost(db, supporter.companyId, supporter.userId);
    expect(() => assertJobSlot(viewer(db, supporter.userId), firm, count(), "insert")).toThrow(/limit/);
    assertJobSlot(viewer(db, admin), firm, count(), "insert");
    expect(() => assertJobSlot(viewer(db, admin), firm, count(), "update")).toThrow(/limit/);
    expect(() => assertJobSlot(viewer(db, none.userId), loadAccess(db, none.companyId), 0, "insert")).toThrow(
      /not allowed/,
    );
  });

  it("applying needs an open in-app job at a firm that reads applicants", () => {
    const db = freshDb();
    const member = addMember(db);
    const firm = addCompany(db, "partner");
    const closedFirm = addCompany(db, "none");
    const postId = addPost(db, firm.companyId, firm.userId);
    const post = all<{ id: string; kind: string; external_url: string | null; status: string; published: number; company_id: string }>(
      db, `SELECT id, kind, external_url, status, published, company_id FROM posts WHERE id = ?`, postId,
    )[0];
    const id = uuid();
    const app = {
      id, member_id: member, kind: "in_app" as const, post_id: postId, package_id: null,
      resume_path: `snapshots/${id}/resume.pdf`, cover_letter_path: null,
    };
    const ctx = { post, postFirm: loadAccess(db, firm.companyId), packageOwnerId: null };

    expect(applicationInsert(viewer(db, member), app, ctx)).toEqual({ company_id: firm.companyId });
    expect(() => applicationInsert(viewer(db, firm.userId), app, ctx)).toThrow(Denied);
    expect(() => applicationInsert(viewer(db, member), { ...app, member_id: uuid() }, ctx)).toThrow(Denied);
    expect(() => applicationInsert(viewer(db, member), app, { ...ctx, post: { ...post, status: "closed" } })).toThrow(
      /open in-app/,
    );
    expect(() =>
      applicationInsert(viewer(db, member), app, { ...ctx, postFirm: loadAccess(db, closedFirm.companyId) }),
    ).toThrow(/not accepting/);
    expect(() =>
      applicationInsert(viewer(db, member), { ...app, resume_path: `${member}/packages/x/resume.pdf` }, ctx),
    ).toThrow(/resume path/);
    expect(() =>
      applicationInsert(viewer(db, member), { ...app, package_id: uuid() }, { ...ctx, packageOwnerId: uuid() }),
    ).toThrow(/package/);
  });

  it("firms move the stage only; members edit only their off-platform rows", () => {
    const db = freshDb();
    const member = addMember(db);
    const firm = addCompany(db, "principal");
    const v = viewer(db, firm.userId);
    const inApp = { member_id: member, kind: "in_app" };
    assertApplicationUpdate(v, inApp, { stage: "offer" }, { visibleToFirm: true });
    expect(() => assertApplicationUpdate(v, inApp, { stage: "offer" }, { visibleToFirm: false })).toThrow(Denied);
    expect(() => assertApplicationUpdate(v, inApp, { notes: "x" }, { visibleToFirm: true })).toThrow(Denied);
    expect(() => assertApplicationUpdate(viewer(db, member), inApp, { stage: "offer" }, { visibleToFirm: false })).toThrow(
      Denied,
    );
    assertApplicationUpdate(viewer(db, member), { member_id: member, kind: "off_platform" }, { stage: "offer", notes: "x" }, { visibleToFirm: false });
  });

  it("starting a conversation follows the firm's messaging capabilities", () => {
    const db = freshDb();
    const applicant = addMember(db);
    const opted = addMember(db, { optInAt: hoursAgo(1000) });
    const partner = addCompany(db, "partner");
    const principal = addCompany(db, "principal");
    addApplication(db, applicant, addPost(db, partner.companyId, partner.userId), hoursAgo(100));

    const pv = viewer(db, partner.userId);
    const visible = exists(db, visibleApplicantSql(pv, `'${applicant}'`));
    expect(visible).toBe(true);
    assertConversationInsert(pv, { member_id: applicant, company_id: partner.companyId }, { visibleApplicant: visible });

    const partnerContact = exists(db, contactableOptInSql(pv, `'${opted}'`));
    expect(partnerContact).toBe(false);
    expect(() =>
      assertConversationInsert(pv, { member_id: opted, company_id: partner.companyId }, { contactableOptIn: partnerContact }),
    ).toThrow(Denied);

    const qv = viewer(db, principal.userId);
    const principalContact = exists(db, contactableOptInSql(qv, `'${opted}'`));
    expect(principalContact).toBe(true);
    assertConversationInsert(qv, { member_id: opted, company_id: principal.companyId }, { contactableOptIn: principalContact });

    assertConversationInsert(viewer(db, applicant), { member_id: applicant, company_id: principal.companyId });
    expect(() =>
      assertConversationInsert(viewer(db, applicant), { member_id: opted, company_id: principal.companyId }),
    ).toThrow(Denied);
  });

  it("only participants send messages, as themselves", () => {
    const db = freshDb();
    const member = addMember(db);
    const a = addCompany(db, "partner");
    const b = addCompany(db, "partner");
    const conv = { member_id: member, company_id: a.companyId };
    assertMessageInsert(viewer(db, member), { sender_id: member }, conv);
    assertMessageInsert(viewer(db, a.userId), { sender_id: a.userId }, conv);
    expect(() => assertMessageInsert(viewer(db, b.userId), { sender_id: b.userId }, conv)).toThrow(Denied);
    expect(() => assertMessageInsert(viewer(db, a.userId), { sender_id: member }, conv)).toThrow(Denied);
  });

  it("members upload only into their own folders, with canonical names", () => {
    const db = freshDb();
    const member = addMember(db);
    const firm = addCompany(db, "principal");
    const v = viewer(db, member);
    expect(canWriteFile(v, "photos", `${member}/me.png`)).toBe(true);
    expect(canWriteFile(v, "photos", `${member}/../x/me.png`)).toBe(false);
    expect(canWriteFile(v, "resumes", `${member}/packages/main/resume.pdf`)).toBe(true);
    expect(canWriteFile(v, "resumes", `${uuid()}/packages/main/resume.pdf`)).toBe(false);
    expect(canWriteFile(viewer(db, firm.userId), "photos", `${firm.userId}/me.png`)).toBe(false);
  });

  it("snapshot files open only for an application the viewer can see", () => {
    const db = freshDb();
    const firm = addCompany(db, "principal");
    const key = `snapshots/${uuid()}/resume.pdf`;
    expect(canReadFile(viewer(db, firm.userId), "resumes", key)).toBe(false);
    expect(canReadFile(viewer(db, firm.userId), "resumes", key, { applicationVisible: true })).toBe(true);
    expect(canReadFile(null, "photos", key)).toBe(false);
  });
});

describe("public join form", () => {
  it("trims, lowercases and bounds the fields", () => {
    expect(
      cleanJoinRequest({ company_name: " Acme ", website: null, contact_name: " Ann ", contact_email: " Ann@Acme.COM ", note: null }),
    ).toEqual({ company_name: "Acme", website: null, contact_name: "Ann", contact_email: "ann@acme.com", note: null });
    expect(cleanJoinRequest({ company_name: "", website: null, contact_name: "A", contact_email: "a@b.co", note: null })).toBeNull();
    expect(cleanJoinRequest({ company_name: "A", website: "javascript:x", contact_name: "A", contact_email: "a@b.co", note: null })).toBeNull();
    expect(cleanJoinRequest({ company_name: "A", website: null, contact_name: "A", contact_email: "not-an-email", note: null })).toBeNull();
  });

  it("uses fixed UTC windows for the rate limits", () => {
    const buckets = joinAdmissionBuckets(NOW, "s".repeat(64), "e".repeat(64));
    expect(buckets.map((b) => b.maximum)).toEqual([500, 100, 5, 3]);
    expect(buckets[1].expires_at).toBe("2026-11-01T13:00:00.000Z");
    expect(buckets[0].expires_at).toBe("2026-11-02T00:00:00.000Z");
  });
});
