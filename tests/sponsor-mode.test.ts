import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { NextRequest } from "next/server";
import type { Profile } from "../lib/types";

const ADMIN = "11111111-1111-4111-8111-111111111111";
const REAL_COMPANY = "22222222-2222-4222-8222-222222222222";
const state = vi.hoisted(() => ({
  profile: null as Profile | null,
  cookie: undefined as string | undefined,
  setCookie: vi.fn(), deleteCookie: vi.fn(), read: vi.fn(), write: vi.fn(), after: vi.fn(),
  allowMembership: false,
}));

vi.mock("@/lib/auth", () => {
  const requireProfile = async () => {
    if (!state.profile) throw new Error("Not signed in");
    return state.profile;
  };
  return { getCurrentProfile: async () => state.profile, requireProfile, requireCurrentProfile: requireProfile };
});
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: () => state.cookie ? { value: state.cookie } : undefined,
  set: state.setCookie, delete: state.deleteCookie,
}) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`redirect:${url}`); },
  notFound: () => { throw new Error("not-found"); },
  usePathname: () => "/company",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(), after: state.after,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { throw new Error("Preview used privileged storage"); } }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: { DB: {} } }) }));
vi.mock("@/lib/cf-auth/sessions", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/cf-auth/sessions")>(),
  readSession: async () => state.profile && { ...state.profile, email: "admin@queensu.ca", company_id: null },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from: (table: string) => {
    state.read(table);
    if (!state.allowMembership) throw new Error(`Preview queried production table: ${table}`);
    const query = {
      select: () => query, eq: () => query,
      maybeSingle: async () => ({ data: table === "company_users" ? { company_id: REAL_COMPANY } : { id: REAL_COMPANY, name: "Real sponsor" } }),
    };
    return query;
  },
  rpc: state.write,
}) }));

import { DEMO_APPLICATIONS, DEMO_COMPANY_ID, DEMO_CONVERSATIONS, DEMO_POSTS } from "../lib/sponsor-demo";
import { assertSponsorWriteAllowed, getCompanyContext, loadPreviewTalent, sponsorModeCompanyId } from "../lib/sponsor-mode";
import { enterSponsorMode, exitSponsorMode } from "../lib/actions/sponsor-mode";
import { createPost, closePost } from "../lib/actions/posts";
import { sendMessage, startConversation, markRead } from "../lib/actions/messages";
import { updateCompanyProfile } from "../lib/actions/company";
import { updateApplicationStage } from "../lib/actions/applications";
import { GET as applicantResume } from "../app/(company)/company/applications/[id]/resume/route";
import { GET as applicantExport } from "../app/(company)/company/applicants/export/route";
import { GET as talentResume } from "../app/(company)/company/talent/[memberId]/resume/route";
import { GET as talentPhoto } from "../app/(company)/company/talent/[memberId]/photo/route";
import SponsorModePage from "../app/(admin)/admin/sponsor-mode/page";
import CompanyLayout from "../app/(company)/layout";
import CompanyHome from "../app/(company)/company/page";
import ApplicantsPage from "../app/(company)/company/applicants/page";
import CompanyPostPage from "../app/(company)/company/posts/[id]/page";
import NewCompanyPost from "../app/(company)/company/posts/new/page";
import ResumeBookPage from "../app/(company)/company/resume-book/page";
import CandidateSearchPage from "../app/(company)/company/search/page";
import SponsorshipPage from "../app/(company)/company/sponsorship/page";
import CompanyMessagesPage from "../app/(company)/company/messages/page";
import CompanyThreadPage from "../app/(company)/company/messages/[id]/page";
import { middleware } from "../middleware";

const searchParams = () => Promise.resolve({});

describe("admin sponsor demo isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.profile = { id: ADMIN, role: "member", is_admin: true } as Profile;
    state.cookie = `${ADMIN}:demo`;
    state.allowMembership = false;
  });

  it("uses a fictional company without querying or modifying a real sponsor", async () => {
    expect(await getCompanyContext()).toMatchObject({ company_id: DEMO_COMPANY_ID, company: { name: "Demo Sponsor" }, preview: true });
    expect(state.profile).toMatchObject({ role: "member", is_admin: true });
    expect(state.read).not.toHaveBeenCalled();
    expect(state.write).not.toHaveBeenCalled();
  });

  it("allows only admins to enable the demo, with no company selector or lookup", async () => {
    await expect(enterSponsorMode()).rejects.toThrow("redirect:/company");
    expect(state.setCookie).toHaveBeenCalledWith("connect-sponsor-mode", `${ADMIN}:demo`, expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }));
    expect(state.read).not.toHaveBeenCalled();
    state.setCookie.mockClear();
    state.profile!.is_admin = false;
    await expect(enterSponsorMode()).rejects.toThrow("Admins only");
    await expect(SponsorModePage()).rejects.toThrow("redirect:/feed");
    expect(state.setCookie).not.toHaveBeenCalled();
    expect(await getCompanyContext()).toBeNull();
  });

  it("rejects real-company ids, old impersonation cookies, and another admin's cookie", async () => {
    for (const cookie of [`${ADMIN}:${REAL_COMPANY}`, `other-admin:demo`, `${ADMIN}:demo:extra`, "enabled", undefined]) {
      state.cookie = cookie;
      expect(await sponsorModeCompanyId(state.profile!)).toBeNull();
      expect(await getCompanyContext()).toBeNull();
    }
    expect(state.read).not.toHaveBeenCalled();
    state.profile = null;
    expect(await getCompanyContext()).toBeNull();
    await expect(enterSponsorMode()).rejects.toThrow("Not signed in");
  });

  it("keeps ordinary sponsors on their real membership even with a forged demo cookie", async () => {
    state.profile!.is_admin = false;
    state.profile!.role = "company_user";
    state.allowMembership = true;
    expect(await getCompanyContext()).toMatchObject({ company_id: REAL_COMPANY, preview: false });
  });

  it("keeps admin/member URLs out of active demo mode and rejects non-admin entry", async () => {
    {
      const request = (path: string) => new NextRequest(`https://example.com${path}`, {
        headers: { cookie: `connect_session=stub; connect-sponsor-mode=${state.cookie}` },
      });
      for (const path of ["/admin/companies", "/feed", "/members", "/messages/private-id"]) {
        expect((await middleware(request(path))).headers.get("location")).toBe("https://example.com/company");
      }
      expect((await middleware(request("/company"))).status).toBe(200);
      state.profile!.is_admin = false;
      expect((await middleware(request("/company"))).headers.get("location")).toBe("https://example.com/feed");
    }
  });

  it("loads every sponsor preview page and layout without production data queries", async () => {
    await SponsorModePage();
    await CompanyLayout({ children: createElement("p", null, "Demo") });
    await CompanyHome({ searchParams: searchParams() });
    await ApplicantsPage({ searchParams: searchParams() });
    await CompanyPostPage({ params: Promise.resolve({ id: DEMO_POSTS[0].id }) });
    await NewCompanyPost({ searchParams: searchParams() });
    await ResumeBookPage({ searchParams: searchParams() });
    await CandidateSearchPage({ searchParams: searchParams() });
    await SponsorshipPage({ searchParams: searchParams() });
    await CompanyMessagesPage();
    await CompanyThreadPage({ params: Promise.resolve({ id: DEMO_CONVERSATIONS[0].id }), searchParams: searchParams() });
    expect(state.read).not.toHaveBeenCalled();
    expect(state.write).not.toHaveBeenCalled();
    expect(state.after).not.toHaveBeenCalled();
  });

  it("rejects real post and conversation URLs instead of looking them up", async () => {
    await expect(CompanyPostPage({ params: Promise.resolve({ id: "real-post" }) })).rejects.toThrow("not-found");
    await expect(CompanyThreadPage({ params: Promise.resolve({ id: "real-conversation" }), searchParams: searchParams() })).rejects.toThrow("not-found");
    expect(state.read).not.toHaveBeenCalled();
  });

  it("shows and filters fictional candidates only", async () => {
    expect(await loadPreviewTalent({ capability: "resume_book", program: "science", year: 2028 })).toMatchObject([{ id: "demo-member-1", full_name: "Alex Example" }]);
    expect(await loadPreviewTalent({ capability: "candidate_search", q: "Markets" })).toMatchObject([{ id: "demo-member-2" }]);
    expect(await loadPreviewTalent({ capability: "resume_book", memberId: "real-member" })).toEqual([]);
    expect(await loadPreviewTalent({ capability: "resume_book", year: 2029 })).toEqual([]);
    expect(state.read).not.toHaveBeenCalled();
  });

  it("blocks all exports, documents and photos, including forged production ids", async () => {
    const request = new Request("https://example.com/resume");
    expect((await applicantExport()).status).toBe(404);
    for (const id of ["real-id", DEMO_APPLICATIONS[0].id]) {
      expect((await applicantResume(request, { params: Promise.resolve({ id }) })).status).toBe(404);
      expect((await talentResume(request, { params: Promise.resolve({ memberId: id }) })).status).toBe(404);
      expect((await talentPhoto(request, { params: Promise.resolve({ memberId: id }) })).status).toBe(404);
    }
    expect(state.read).not.toHaveBeenCalled();
    expect(state.write).not.toHaveBeenCalled();
  });

  it("blocks every sponsor write even if the disabled UI is bypassed", async () => {
    const form = new FormData();
    form.set("company_id", REAL_COMPANY);
    for (const action of [createPost, closePost, sendMessage, startConversation, updateCompanyProfile, updateApplicationStage]) {
      await expect(action(form)).rejects.toThrow("Sponsor mode is read-only");
    }
    await expect(markRead("real-conversation")).rejects.toThrow("Sponsor mode is read-only");
    expect(state.read).not.toHaveBeenCalled();
    expect(state.write).not.toHaveBeenCalled();
    await expect(exitSponsorMode()).rejects.toThrow("redirect:/admin");
    expect(state.deleteCookie).toHaveBeenCalledWith("connect-sponsor-mode");
    state.cookie = undefined;
    await expect(assertSponsorWriteAllowed(state.profile!)).resolves.toBeUndefined();
  });
});
