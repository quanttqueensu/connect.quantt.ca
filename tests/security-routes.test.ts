import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "company_user", path: "", sign: vi.fn(), download: vi.fn(),
  company: "company", member: "11111111-1111-4111-8111-111111111111",
  application: "22222222-2222-4222-8222-222222222222",
}));
vi.mock("@/lib/auth", () => ({
  getCurrentProfile: async () => ({ id: state.member, role: state.role }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ storage: { from: () => ({ createSignedUrl: state.sign, download: state.download }) } }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async () => ({ data: state.path }),
    storage: { from: () => ({ createSignedUrl: state.sign }) },
    from: (table: string) => {
      const query = {
        select: () => query, eq: () => query,
        maybeSingle: async () => ({ data: table === "company_users"
          ? { company_id: state.company }
          : table === "profiles" ? { id: state.member, photo_path: state.path }
            : { id: state.application, company_id: state.company, resume_path: state.path } }),
      };
      return query;
    },
  }),
}));
import { GET as talentResume } from "../app/(company)/company/talent/[memberId]/resume/route";
import { GET as talentPhoto } from "../app/(company)/company/talent/[memberId]/photo/route";
import { GET as applicantResume } from "../app/(company)/company/applications/[id]/resume/route";
import { GET as memberPhoto } from "../app/(member)/members/[id]/photo/route";

describe("document routes validate stored paths before signing", () => {
  beforeEach(() => {
    state.role = "company_user";
    state.sign.mockReset().mockResolvedValue({ data: { signedUrl: "https://example.com/signed" } });
  });
  const request = new Request("https://connect.example/resume");
  const talentParams = { params: Promise.resolve({ memberId: state.member }) };
  const applicationParams = { params: Promise.resolve({ id: state.application }) };

  it("fails closed for stored traversal and encoded paths at every privileged signer", async () => {
    for (const unsafe of [
      `${state.member}/../victim/packages/x/resume.pdf`,
      `${state.member}/packages/%2e%2e/resume.pdf`,
    ]) {
      state.path = unsafe;
      expect((await talentResume(request, talentParams)).status).toBe(404);
    }
    state.path = `${state.member}/../../resumes/victim/resume.pdf`;
    expect((await talentPhoto(request, talentParams)).status).toBe(404);
    state.path = `snapshots/${state.application}/../victim/resume.pdf`;
    expect((await applicantResume(request, applicationParams)).status).toBe(404);
    expect(state.sign).not.toHaveBeenCalled();
  });

  it("keeps legitimate resume, photo and application downloads", async () => {
    state.path = `${state.member}/packages/x/resume.pdf`;
    expect((await talentResume(request, talentParams)).status).toBe(302);
    expect(state.sign).toHaveBeenLastCalledWith(state.path, 90, { download: true });
    state.path = `${state.member}/photo.webp`;
    expect((await talentPhoto(request, talentParams)).status).toBe(302);
    state.path = `snapshots/${state.application}/resume.pdf`;
    expect((await applicantResume(request, applicationParams)).status).toBe(302);
  });

  it("checks member photo legacy rows before using session Storage", async () => {
    state.role = "member";
    state.path = `${state.member}/../../resumes/victim/resume.pdf`;
    const params = { params: Promise.resolve({ id: state.member }) };
    expect((await memberPhoto(request, params)).status).toBe(404);
    expect(state.sign).not.toHaveBeenCalled();
    state.path = `${state.member}/photo.jpg`;
    expect((await memberPhoto(request, params)).status).toBe(302);
  });
});
