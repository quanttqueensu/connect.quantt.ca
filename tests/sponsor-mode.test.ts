/**
 * Sponsor mode end to end on SQLite: an admin who picks a company sees what
 * a contact at that company sees (same rows, same package and overrides),
 * and nothing they do there writes anything.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { NextRequest } from "next/server";

import type { R2BucketLike } from "@/lib/db/storage";
import { createSession } from "@/lib/cf-auth/sessions";

import { addApplication, addCompany, addMember, addPost, addResume, all, asD1, freshDb, hoursAgo, run, type Db } from "./db/sqlite";

const state = vi.hoisted(() => ({
  raw: null as unknown as Db,
  env: {} as Record<string, unknown>,
  jar: new Map<string, string>(),
  after: [] as unknown[],
}));

vi.mock("@/lib/hub/env", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/hub/env")>(),
  hubEnv: async () => state.env,
  hubEnvSync: () => state.env,
}));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: state.env }) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.jar.has(name) ? { value: state.jar.get(name) } : undefined),
    set: (name: string, value: string) => void state.jar.set(name, value),
    delete: (name: string | { name: string }) => void state.jar.delete(typeof name === "string" ? name : name.name),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`redirect:${url}`); },
  notFound: () => { throw new Error("not-found"); },
  usePathname: () => "/company",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: (fn: unknown) => void state.after.push(fn),
}));

import { createClient } from "../lib/supabase/server";
import { getCompanyContext, sponsorModeCompanyId, assertSponsorWriteAllowed } from "../lib/sponsor-mode";
import { parseSponsorModeCookie, SPONSOR_MODE_COOKIE } from "../lib/sponsor-mode-cookie";
import { enterSponsorMode, exitSponsorMode } from "../lib/actions/sponsor-mode";
import { loadMyCompanyTier } from "../lib/tiers";
import { getCurrentProfile } from "../lib/auth";
import { closePost } from "../lib/actions/posts";
import { GET as applicantExport } from "../app/(company)/company/applicants/export/route";
import SponsorModePage from "../app/(admin)/admin/sponsor-mode/page";
import CompanyLayout from "../app/(company)/layout";
import CompanyHome from "../app/(company)/company/page";
import ApplicantsPage from "../app/(company)/company/applicants/page";
import ResumeBookPage from "../app/(company)/company/resume-book/page";
import SponsorshipPage from "../app/(company)/company/sponsorship/page";
import CompanyMessagesPage from "../app/(company)/company/messages/page";
import { middleware } from "../middleware";

const emptyR2: R2BucketLike = {
  async get() { return null; },
  async head() { return null; },
  async put() { throw new Error("R2 write in sponsor mode"); },
  async delete() { throw new Error("R2 delete in sponsor mode"); },
};

let admin: string;
let firm: { companyId: string; userId: string };
let otherFirm: { companyId: string; userId: string };
let postId: string;

async function signIn(profileId: string) {
  const { token } = await createSession(asD1(state.raw), profileId);
  state.jar = new Map([["connect_session", token]]);
  return token;
}

function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const sp = () => Promise.resolve({});

beforeEach(() => {
  state.raw = freshDb();
  state.env = { DB: asD1(state.raw), FILES: emptyR2 };
  state.after = [];
  admin = addMember(state.raw, { admin: true });
  firm = addCompany(state.raw, "partner");
  otherFirm = addCompany(state.raw, "leader");
  postId = addPost(state.raw, firm.companyId, firm.userId);
  addPost(state.raw, otherFirm.companyId, otherFirm.userId);
  const member = addMember(state.raw, { optInAt: hoursAgo(24 * 30) });
  addResume(state.raw, member);
  addApplication(state.raw, member, postId, hoursAgo(24 * 30));
  // Every profile has picked notifications, as they would have after first sign-in.
  for (const { id } of all<{ id: string }>(state.raw, `SELECT id FROM profiles`)) {
    run(state.raw, `INSERT OR IGNORE INTO notification_prefs (profile_id) VALUES (?)`, id);
  }
});

async function readsAs(profileId: string, cookie?: string) {
  await signIn(profileId);
  if (cookie) state.jar.set(SPONSOR_MODE_COOKIE, cookie);
  const db = await createClient();
  const [posts, apps, companies, convos] = await Promise.all([
    db.from("posts").select("id").order("id"),
    db.from("applications").select("id").order("id"),
    db.from("companies").select("id").order("id"),
    db.from("conversations").select("id").order("id"),
  ]);
  const tier = await loadMyCompanyTier(firm.companyId);
  return {
    posts: posts.data, apps: apps.data, companies: companies.data, convos: convos.data,
    caps: tier.access?.sponsor_tier_capabilities.map((c) => c.capability).sort(),
  };
}

describe("sponsor mode", () => {
  it("reads exactly what that company's own contact reads", async () => {
    const sponsor = await readsAs(firm.userId);
    const preview = await readsAs(admin, `${admin}:${firm.companyId}`);
    expect(preview).toEqual(sponsor);
    expect(preview.companies).toEqual([{ id: firm.companyId }]);
    expect(preview.apps).toHaveLength(1);
    // Without the cookie the same admin sees everything.
    const asAdmin = await readsAs(admin);
    expect(asAdmin.companies).toHaveLength(2);
  });

  it("follows a company override, like the sponsor does", async () => {
    run(
      state.raw,
      `INSERT INTO company_capability_overrides (company_id, capability, granted, value) VALUES (?, 'resume_book', 0, NULL)`,
      firm.companyId,
    );
    const sponsor = await readsAs(firm.userId);
    const preview = await readsAs(admin, `${admin}:${firm.companyId}`);
    expect(preview.caps).toEqual(sponsor.caps);
    expect(preview.caps).not.toContain("resume_book");
  });

  it("only turns on for the admin who set it, and only for a real company", async () => {
    expect(parseSponsorModeCookie(`${admin}:${firm.companyId}`, admin)).toBe(firm.companyId);
    expect(parseSponsorModeCookie(`other:${firm.companyId}`, admin)).toBeNull();
    expect(parseSponsorModeCookie(`${admin}:a b`, admin)).toBeNull();
    expect(parseSponsorModeCookie(undefined, admin)).toBeNull();

    await signIn(admin);
    state.jar.set(SPONSOR_MODE_COOKIE, `${admin}:missing-company`);
    expect(await sponsorModeCompanyId((await getCurrentProfile())!)).toBeNull();

    // A sponsor carrying a forged cookie for another firm stays on their own.
    await signIn(firm.userId);
    state.jar.set(SPONSOR_MODE_COOKIE, `${firm.userId}:${otherFirm.companyId}`);
    expect(await getCompanyContext()).toMatchObject({ company_id: firm.companyId, preview: false });
  });

  it("lets only admins pick a company, and exits back to the picker", async () => {
    await signIn(firm.userId);
    await expect(enterSponsorMode(form({ company_id: firm.companyId }))).rejects.toThrow("Admins only");

    await signIn(admin);
    await expect(enterSponsorMode(form({ company_id: "nope" }))).rejects.toThrow("redirect:/admin/sponsor-mode?error=company");
    await expect(enterSponsorMode(form({ company_id: firm.companyId }))).rejects.toThrow("redirect:/company");
    expect(state.jar.get(SPONSOR_MODE_COOKIE)).toBe(`${admin}:${firm.companyId}`);
    expect(await getCompanyContext()).toMatchObject({ company_id: firm.companyId, preview: true });

    await expect(exitSponsorMode()).rejects.toThrow("redirect:/admin/sponsor-mode");
    expect(state.jar.has(SPONSOR_MODE_COOKIE)).toBe(false);
  });

  it("refuses every write, in actions and in the database layer", async () => {
    await signIn(admin);
    state.jar.set(SPONSOR_MODE_COOKIE, `${admin}:${firm.companyId}`);
    await expect(assertSponsorWriteAllowed((await getCurrentProfile())!)).rejects.toThrow("read-only");
    await expect(closePost(form({ id: postId }))).rejects.toThrow("read-only");

    const db = await createClient();
    const before = all(state.raw, `SELECT * FROM posts ORDER BY id`);
    const insert = await db.from("posts").insert({ author_id: admin, company_id: firm.companyId, kind: "announcement", title: "x", body: "x" });
    const update = await db.from("posts").update({ title: "changed" }).eq("id", postId);
    const remove = await db.from("posts").delete().eq("id", postId);
    const rpc = await db.rpc("close_own_post", { p_post: postId });
    const upload = await db.storage.from("photos").upload(`${admin}/photo.jpg`, new Uint8Array([1]), { contentType: "image/jpeg" });
    for (const r of [insert, update, remove, rpc, upload]) expect(r.error?.message).toMatch(/read-only|security/);
    expect(all(state.raw, `SELECT * FROM posts ORDER BY id`)).toEqual(before);
  });

  it("renders the sponsor pages from real data and keeps the applicant export", async () => {
    await signIn(admin);
    await SponsorModePage({ searchParams: sp() });
    state.jar.set(SPONSOR_MODE_COOKIE, `${admin}:${firm.companyId}`);
    await CompanyLayout({ children: createElement("p", null, "x") });
    await CompanyHome({ searchParams: sp() });
    await ApplicantsPage({ searchParams: sp() });
    await ResumeBookPage({ searchParams: sp() });
    await SponsorshipPage({ searchParams: sp() });
    await CompanyMessagesPage();
    const csv = await applicantExport();
    expect(csv.status).toBe(200);
    expect((await csv.text()).split("\n").length).toBeGreaterThan(1);
  });

  it("keeps the admin on /company (and the picker) until they exit", async () => {
    const token = await signIn(admin);
    const go = (path: string) => middleware(new NextRequest(`https://connect.test${path}`, {
      headers: { cookie: `connect_session=${token}; ${SPONSOR_MODE_COOKIE}=${admin}:${firm.companyId}` },
    }));
    for (const path of ["/admin/companies", "/feed", "/members", "/messages/x"]) {
      expect((await go(path)).headers.get("location")).toBe("https://connect.test/company");
    }
    expect((await go("/company/applicants")).status).toBe(200);
    expect((await go("/admin/sponsor-mode")).status).toBe(200);
  });
});
