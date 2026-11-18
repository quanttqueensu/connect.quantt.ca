/**
 * Small reliability guards: bad file links, the production site URL, Kingston grace dates,
 * and approving a join request once.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { verifyFileLink } from "../lib/db/storage";
import { siteUrl } from "../lib/site-url";
import { graceIsOpen } from "../lib/tiers";
import { approveJoinRequest } from "../lib/join-approval";
import { addMember, all, asD1, freshDb, run, TIER, uuid } from "./db/sqlite";

afterEach(() => vi.unstubAllEnvs());

describe("file links", () => {
  it("treats a malformed %-escape as a bad link, not a crash", async () => {
    expect(await verifyFileLink("k", new URL("https://connect.quantt.ca/files/resumes/%E0%A4%A/x.pdf?exp=9999999999&sig=x"))).toBeNull();
  });
});

describe("siteUrl", () => {
  it("throws in production without NEXT_PUBLIC_SITE_URL instead of using localhost", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("URL", "");
    vi.stubEnv("VERCEL_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => siteUrl()).toThrow(/NEXT_PUBLIC_SITE_URL/);
    vi.stubEnv("NODE_ENV", "test");
    expect(siteUrl()).toBe("http://localhost:3000");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://connect.quantt.ca/");
    expect(siteUrl()).toBe("https://connect.quantt.ca");
  });
});

describe("sponsor grace", () => {
  it("lasts through its last day in Kingston", () => {
    expect(graceIsOpen("2026-12-31", new Date("2027-01-01T04:59:00Z"))).toBe(true);
    expect(graceIsOpen("2026-12-31", new Date("2027-01-01T05:00:00Z"))).toBe(false);
  });
});

describe("join request approval", () => {
  function setup() {
    const raw = freshDb();
    const admin = addMember(raw, { admin: true });
    const id = uuid();
    run(raw, `INSERT INTO company_join_requests (id, company_name, contact_name, contact_email) VALUES (?, 'Acme Capital', 'Pat', 'pat@acme.com')`, id);
    return { raw, db: asD1(raw), admin, id };
  }

  it("makes one firm and one invite even when approved twice at once", async () => {
    const { raw, db, admin, id } = setup();
    const [a, b] = await Promise.all([
      approveJoinRequest(db, { id, adminId: admin, tierId: TIER.partner }),
      approveJoinRequest(db, { id, adminId: admin, tierId: TIER.partner }),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(all(raw, `SELECT count(*) AS n FROM companies WHERE name = 'Acme Capital'`)[0]).toEqual({ n: 1 });
    expect(all(raw, `SELECT count(*) AS n FROM invites WHERE email = 'pat@acme.com'`)[0]).toEqual({ n: 1 });
    expect(all(raw, `SELECT status FROM company_join_requests WHERE id = ?`, id)[0]).toEqual({ status: "approved" });
  });

  it("gives the request back when the save fails", async () => {
    const { raw, db, admin, id } = setup();
    const r = await approveJoinRequest(db, { id, adminId: admin, tierId: "no-such-tier" });
    expect(r).toEqual({ ok: false, code: "join_request_review_failed" });
    expect(all(raw, `SELECT status, reviewed_at FROM company_join_requests WHERE id = ?`, id)[0]).toEqual({ status: "pending", reviewed_at: null });
    expect(all(raw, `SELECT count(*) AS n FROM companies WHERE name = 'Acme Capital'`)[0]).toEqual({ n: 0 });
    expect((await approveJoinRequest(db, { id, adminId: admin, tierId: TIER.partner })).ok).toBe(true);
  });
});
