/**
 * Opportunities: parsing the public job lists, storing them in D1, and who may
 * read or change them.
 */
import { describe, expect, it } from "vitest";

import { createHubClient } from "@/lib/db/client";
import {
  dedupe,
  dropPastTerms,
  inCanada,
  normalizeUrl,
  parseNwft,
  parseSimplify,
  roleKey,
  type Listing,
} from "@/lib/jobs/sources";
import { handleSync, storeListings } from "@/lib/jobs/store";

import { addCompany, addMember, addPost, all, asD1, freshDb, viewer } from "./db/sqlite";

const simplifyRow = (over: Record<string, unknown> = {}) => ({
  source: "Simplify",
  category: "Quant",
  company_name: "Jane Street",
  id: "x",
  title: "Quantitative Trader Intern",
  active: true,
  terms: ["Summer 2027"],
  date_posted: 1793560603,
  url: "https://example.com/jobs/1?utm_source=Simplify&ref=Simplify",
  locations: ["New York, NY"],
  is_visible: true,
  ...over,
});

const SIMPLIFY = JSON.stringify(
  [
    simplifyRow({ category: "Software", url: "https://example.com/swe" }),
    simplifyRow(),
    simplifyRow({ url: "https://example.com/closed", active: false }),
    simplifyRow({ url: "https://example.com/hidden", is_visible: false }),
    simplifyRow({ url: "javascript:alert(1)" }),
    simplifyRow({ category: "Quantitative Finance", url: "https://example.com/2", company_name: "CCLIM", locations: ["Toronto, ON, Canada"] }),
  ],
  null,
  4,
);

const NWFT = `# Summer 2027 Quant Internships

## Contributing

|Role|Links|
|-------|-------|
|QR|[✅ ](https://example.com/should-not-count)|

## Akuna Capital
**Website**: [Akuna Capital](https://akunacapital.com/careers)

**Locations**: Chicago, Sydney

**Notes**:

|Role|Links|
|-------|-------|
|QD|[✅ ](https://akuna.example/qd)|
|SWE|[✅ C++](https://akuna.example/cpp)&nbsp;&nbsp;[🔒 Python](https://akuna.example/py)|
`;

describe("sources", () => {
  it("keeps only open, visible quant rows from Simplify, with clean links", () => {
    const got = parseSimplify(SIMPLIFY, "internship");
    expect(got.map((l) => l.url).sort()).toEqual(["https://example.com/2", "https://example.com/jobs/1"]);
    const js = got.find((l) => l.company === "Jane Street")!;
    expect(js).toMatchObject({ term: "Summer 2027", role_type: "internship", locations: ["New York, NY"] });
    expect(js.posted_at).toBe(new Date(1793560603 * 1000).toISOString());
  });

  it("reads Northwestern Fintech's firm tables and skips closed links", () => {
    const got = parseNwft(NWFT);
    expect(got.map((l) => [l.company, l.title, l.url])).toEqual([
      ["Akuna Capital", "Quantitative Developer Intern", "https://akuna.example/qd"],
      ["Akuna Capital", "Software Engineer Intern (C++)", "https://akuna.example/cpp"],
    ]);
    expect(got[0]).toMatchObject({ term: "Summer 2027", locations: ["Chicago", "Sydney"], posted_at: null });
  });

  it("drops terms that have started, dedupes links and spots Canada", () => {
    const base = parseNwft(NWFT)[0];
    const now = new Date("2026-11-02T00:00:00Z");
    const terms = ["Summer 2026", "Fall 2026", "Winter 2027", "Summer 2027"].map((term) => ({ ...base, term }));
    expect(dropPastTerms([...terms, { ...base, term: null }], now).map((l) => l.term)).toEqual([
      "Winter 2027",
      "Summer 2027",
      null,
    ]);
    expect(dedupe([base, { ...base, title: "dup" }])).toHaveLength(1);
    const merged = dedupe([base, { ...base, url: "https://other.example/x", company: "AKUNA capital", locations: ["NYC"] }]);
    expect(merged).toHaveLength(1);
    expect(merged[0].locations).toEqual(["Chicago", "Sydney", "NYC"]);
    expect(dedupe([base, { ...base, url: "https://other.example/x", term: "Summer 2028" }])).toHaveLength(2);
    expect(dedupe([base, { ...base, url: "https://other.example/x", term: null }])).toHaveLength(1);
    const filled = dedupe([{ ...base, term: null }, { ...base, url: "https://other.example/x" }]);
    expect(filled).toHaveLength(1);
    expect(filled[0].term).toBe("Summer 2027");
    expect(inCanada(["Toronto, ON, Canada"])).toBe(true);
    expect(inCanada(["London, UK"])).toBe(false);
    expect(normalizeUrl("ftp://x")).toBeNull();
  });
});

describe("roleKey", () => {
  const key = (company: string, title: string) => roleKey({ company, title, term: null });

  it("reads different spellings of one role as the same role", () => {
    const same: [string, string, string, string][] = [
      ["Jane Street", "Quantitative Researcher Intern", "Jane Street", "Quant Research Internship"],
      ["Flow Traders", "Quantitative Trader Intern", "Flow Traders", "Quantitative Trading Intern"],
      ["Akuna Capital University", "Junior Quantitative Researcher", "Akuna Capital", "Junior Quantitative Researcher"],
      ["Optiver", "Graduate Quantitative Researcher", "Optiver", "Quantitative Researcher Graduate"],
      ["BlackRock", "Quantitative Master\u2019s Intern - Investing", "BlackRock", "Quantitative Masters Internship - Investing"],
      ["JP Morgan Chase", "Quant Research Summer Analyst Internship", "JP Morgan Chase", "Quantitative Research Intern"],
      ["Brevan Howard", "Trading Intern - Trading", "Brevan Howard", "Trading Intern"],
      ["Jane Street", "Quantitative Researcher Intern [Summer 2027]", "Jane Street", "Quantitative Researcher Intern"],
      ["Two Sigma, LLC", "Quant Co-op", "Two Sigma", "Quant Intern"],
    ];
    for (const [c1, t1, c2, t2] of same) expect(key(c1, t1), `${t1} / ${t2}`).toBe(key(c2, t2));
  });

  it("keeps different roles and firms apart", () => {
    const apart: [string, string, string, string][] = [
      ["Citadel", "Quantitative Research Intern", "Citadel Securities", "Quantitative Research Intern"],
      ["Jane Street", "Quantitative Researcher Intern", "Jane Street", "Quantitative Trader Intern"],
      ["Optiver", "Quantitative Researcher Intern", "Optiver", "Quantitative Researcher Graduate"],
      ["IMC", "Software Engineer Intern", "IMC", "Quant Software Engineer Intern"],
      ["PIMCO", "Quant Research Analyst Intern", "PIMCO", "Quant Research Intern"],
    ];
    for (const [c1, t1, c2, t2] of apart) expect(key(c1, t1), `${t1} / ${t2}`).not.toBe(key(c2, t2));
  });
});

const listing = (over: Partial<Listing> = {}): Listing => ({
  source: "simplify",
  company: "Citadel",
  title: "Quant Research Intern",
  url: "https://example.com/a",
  locations: ["Chicago, IL"],
  role_type: "internship",
  term: "Summer 2027",
  posted_at: "2026-10-01T00:00:00.000Z",
  ...over,
});

describe("storeListings", () => {
  it("inserts, refreshes, closes and keeps listings when a source fails", async () => {
    const raw = freshDb();
    const db = asD1(raw);
    const day1 = new Date("2026-11-01T11:00:00Z");
    const day2 = new Date("2026-11-02T11:00:00Z");

    const r1 = await storeListings(
      db,
      {
        sources: {
          simplify: [listing(), listing({ url: "https://example.com/b", title: "QT Intern" })],
          nwft: [listing({ source: "nwft", url: "https://example.com/n", title: "QR Intern", posted_at: null })],
        },
      },
      day1,
    );
    expect(r1).toMatchObject({ stored: 3, skipped: [] });
    expect(r1.added.map((l) => l.url).sort()).toEqual([
      "https://example.com/a",
      "https://example.com/b",
      "https://example.com/n",
    ]);
    expect(r1.added[0].locations).toEqual(["Chicago, IL"]);
    const n = all<{ posted_at: string; locations: string }>(raw, "SELECT posted_at, locations FROM job_listings WHERE source = 'nwft'")[0];
    expect(n.posted_at).toBe(day1.toISOString());
    expect(JSON.parse(n.locations)).toEqual(["Chicago, IL"]);

    // Day 2: Simplify drops /b and renames /a; Northwestern's fetch failed.
    const r2 = await storeListings(db, { sources: { simplify: [listing({ title: "Renamed" })], nwft: null } }, day2);
    expect(r2).toMatchObject({ stored: 1, closed: { simplify: 1 }, skipped: ["nwft"], added: [] });
    const rows = all<{ url: string; title: string; active: number; first_seen_at: string }>(
      raw,
      "SELECT url, title, active, first_seen_at FROM job_listings ORDER BY url",
    );
    expect(rows).toEqual([
      { url: "https://example.com/a", title: "Renamed", active: 1, first_seen_at: day1.toISOString() },
      { url: "https://example.com/b", title: "QT Intern", active: 0, first_seen_at: day1.toISOString() },
      { url: "https://example.com/n", title: "QR Intern", active: 1, first_seen_at: day1.toISOString() },
    ]);
  });

  it("doesn't add a role that's already open under another link", async () => {
    const raw = freshDb();
    const db = asD1(raw);
    await storeListings(db, { sources: { simplify: [listing()] } }, new Date("2026-11-01T11:00:00Z"));
    const r = await storeListings(
      db,
      { sources: { nwft: [listing({ source: "nwft", url: "https://other.example/a", company: "citadel" })] } },
      new Date("2026-11-02T11:00:00Z"),
    );
    expect(r.added).toEqual([]);
    expect(all(raw, "SELECT url FROM job_listings")).toEqual([{ url: "https://example.com/a" }]);
  });

  it("stores a role listed twice once, and a role that only changed link isn't new", async () => {
    const raw = freshDb();
    const db = asD1(raw);
    const r1 = await storeListings(
      db,
      {
        sources: {
          simplify: [listing()],
          nwft: [listing({ source: "nwft", url: "https://nwft.example/a", title: "Quantitative Researcher Internship", term: null })],
        },
      },
      new Date("2026-11-01T11:00:00Z"),
    );
    expect(r1.added.map((l) => l.url)).toEqual(["https://example.com/a"]);
    expect(all(raw, "SELECT url FROM job_listings")).toEqual([{ url: "https://example.com/a" }]);

    const r2 = await storeListings(
      db,
      { sources: { simplify: [listing({ url: "https://example.com/a2", title: "Quantitative Research Intern" })] } },
      new Date("2026-11-02T11:00:00Z"),
    );
    expect(r2.added).toEqual([]);
    expect(all(raw, "SELECT url, active FROM job_listings ORDER BY url")).toEqual([
      { url: "https://example.com/a", active: 0 },
      { url: "https://example.com/a2", active: 1 },
    ]);
  });

  it("closes a duplicate stored before, and keeps the one still listed", async () => {
    const raw = freshDb();
    const db = asD1(raw);
    await storeListings(db, { sources: { simplify: [listing()] } }, new Date("2026-11-01T11:00:00Z"));
    raw.exec(`INSERT INTO job_listings (id, url, source, company, title, locations, role_type, term, posted_at, first_seen_at, last_seen_at)
      VALUES ('dup', 'https://nwft.example/a', 'nwft', 'Citadel', 'Quantitative Researcher Intern', '[]', 'internship', NULL,
              '2026-11-01T11:00:00Z', '2026-11-01T11:00:00Z', '2026-11-01T11:00:00Z')`);
    const r = await storeListings(
      db,
      {
        sources: {
          simplify: [listing()],
          nwft: [listing({ source: "nwft", url: "https://nwft.example/a", title: "Quantitative Researcher Intern", term: null })],
        },
      },
      new Date("2026-11-02T11:00:00Z"),
    );
    expect(r).toMatchObject({ stored: 1, closed: { simplify: 0, nwft: 1 }, added: [] });
    expect(all(raw, "SELECT url FROM job_listings WHERE active = 1")).toEqual([{ url: "https://example.com/a" }]);
  });

  it("rejects junk rows and an empty source never closes anything", async () => {
    const raw = freshDb();
    const db = asD1(raw);
    await storeListings(db, { sources: { simplify: [listing()] } });
    const bad = [{ url: "javascript:x", company: "A", title: "B", role_type: "internship" }, { nope: 1 }, "str"];
    const r = await storeListings(db, { sources: { simplify: bad as unknown as Listing[] } });
    expect(r).toMatchObject({ stored: 0, skipped: ["simplify", "nwft"] });
    expect(all(raw, "SELECT url FROM job_listings WHERE active = 1")).toHaveLength(1);
  });

  it("needs the bearer token", async () => {
    const raw = freshDb();
    const env = { DB: asD1(raw), OPPORTUNITIES_SYNC_TOKEN: "s3cret" };
    const req = (auth?: string) =>
      new Request("https://connect.quantt.ca/api/opportunities/sync", {
        method: "POST",
        headers: auth ? { authorization: auth } : {},
        body: JSON.stringify({ sources: { simplify: [listing()] } }),
      });
    expect((await handleSync(req(), env)).status).toBe(401);
    expect((await handleSync(req("Bearer wrong"), env)).status).toBe(401);
    expect((await handleSync(req("Bearer s3cret"), { DB: env.DB })).status).toBe(401);
    const ok = await handleSync(req("Bearer s3cret"), env);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ stored: 1 });
  });
});

describe("job_listings access", () => {
  it("members and admins read; sponsors don't; only admins hide, and only hide", async () => {
    const raw = freshDb();
    const db = asD1(raw);
    await storeListings(db, { sources: { simplify: [listing()] } });
    const member = addMember(raw);
    const admin = addMember(raw, { admin: true });
    const firm = addCompany(raw, "partner");
    const as = (id: string) => createHubClient({
        db,
        files: null as never,
        principal: { kind: "user", viewer: viewer(raw, id) },
        fileLinks: null,
      });

    const { data: m } = await as(member).from("job_listings").select("id, locations, active, hidden");
    expect(m).toHaveLength(1);
    expect(m![0]).toMatchObject({ locations: ["Chicago, IL"], active: true, hidden: false });
    const { data: f } = await as(firm.userId).from("job_listings").select("id");
    expect(f).toEqual([]);

    const id = m![0].id as string;
    const { data: mUpd } = await as(member).from("job_listings").update({ hidden: true }).eq("id", id).select("id");
    expect(mUpd ?? []).toEqual([]);
    const { error: titleErr } = await as(admin).from("job_listings").update({ title: "x" }).eq("id", id);
    expect(titleErr).not.toBeNull();
    const { error } = await as(admin).from("job_listings").update({ hidden: true }).eq("id", id);
    expect(error).toBeNull();
    expect(all(raw, "SELECT hidden FROM job_listings")).toEqual([{ hidden: 1 }]);
  });
});

describe("sponsor jobs tab", () => {
  it("lists open job posts from sponsoring firms only", async () => {
    const raw = freshDb();
    const db = asD1(raw);
    const member = addMember(raw);
    const sponsor = addCompany(raw, "partner");
    const notSponsoring = addCompany(raw, "none");
    const job = addPost(raw, sponsor.companyId, sponsor.userId);
    const link = addPost(raw, sponsor.companyId, sponsor.userId, { kind: "job_link" });
    addPost(raw, sponsor.companyId, sponsor.userId, { kind: "announcement" });
    addPost(raw, notSponsoring.companyId, notSponsoring.userId);
    const client = createHubClient({
      db,
      files: null as never,
      principal: { kind: "user", viewer: viewer(raw, member) },
      fileLinks: null,
    });
    // The same query app/(member)/opportunities/page.tsx makes.
    const { data, error } = await client
      .from("posts")
      .select("*, companies!inner(*, sponsor_tiers!sponsor_tier_id!inner(id, name, rank, key))")
      .eq("published", true)
      .eq("status", "open")
      .in("kind", ["job", "job_link"])
      .gt("companies.sponsor_tiers!sponsor_tier_id.rank", 0)
      .order("created_at", { ascending: false })
      .limit(100);
    expect(error).toBeNull();
    expect((data ?? []).map((p) => p.id).sort()).toEqual([job, link].sort());
  });
});
