import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  member: "11111111-1111-4111-8111-111111111111",
  role: "member", path: "", sign: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  getCurrentProfile: async () => ({ id: state.member, role: state.role }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    storage: { from: () => ({ createSignedUrl: state.sign }) },
    from: () => {
      const query = {
        select: () => query, eq: () => query,
        maybeSingle: async () => ({ data: { resume_path: state.path, cover_letter_path: state.path } }),
      };
      return query;
    },
  }),
}));
import { GET } from "../app/(member)/profile/documents/[kind]/route";

describe("private profile document downloads", () => {
  beforeEach(() => {
    state.role = "member";
    state.path = `${state.member}/packages/x/resume.pdf`;
    state.sign.mockReset().mockResolvedValue({ data: { signedUrl: "https://example.com/signed" } });
  });
  const request = new Request("https://connect.example/profile/documents/resume");
  const params = { params: Promise.resolve({ kind: "resume" }) };

  it("serves the member's document through a short-lived attachment URL", async () => {
    const response = await GET(request, params);
    expect(response.status).toBe(302);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(state.sign).toHaveBeenLastCalledWith(state.path, 90, { download: true });
  });
  it("denies company users", async () => {
    state.role = "company_user";
    expect((await GET(request, params)).status).toBe(404);
    expect(state.sign).not.toHaveBeenCalled();
  });
  it("refuses unsafe paths and unknown document kinds", async () => {
    state.path = `${state.member}/../victim/packages/x/resume.pdf`;
    expect((await GET(request, params)).status).toBe(404);
    state.path = `${state.member}/packages/x/resume.pdf`;
    expect((await GET(request, { params: Promise.resolve({ kind: "unknown" }) })).status).toBe(404);
    expect(state.sign).not.toHaveBeenCalled();
  });
});
