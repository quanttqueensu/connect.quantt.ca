import { beforeEach, describe, expect, it, vi } from "vitest";

const A = "11111111-1111-4111-8111-111111111111";
const B = "33333333-3333-4333-8333-333333333333";
const state = vi.hoisted(() => ({
  preview: false,
  hasBook: true,
  paths: {} as Record<string, string>,
  listArgs: null as unknown,
}));
vi.mock("@/lib/auth", () => ({
  getCurrentProfile: async () => ({ id: "p", role: "company_user" }),
}));
vi.mock("@/lib/sponsor-mode", () => ({
  getCompanyContext: async () => ({ company_id: "c", company: {}, preview: state.preview }),
}));
vi.mock("@/lib/tiers", () => ({
  loadMyCompanyTier: async () => ({ access: state.hasBook ? "book" : null }),
  can: (tier: unknown, key: string) => tier === "book" && key === "resume_book",
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (name: string, args: { p_member?: string }) => {
      if (name === "resume_book_list") {
        state.listArgs = args;
        return { data: [
          { id: A, full_name: "Jane Doe", program: "Commerce", grad_year: 2027, linkedin_url: null },
          { id: B, full_name: "Jane Doe", program: "=cmd", grad_year: 2028, linkedin_url: null },
        ] };
      }
      return { data: state.paths[args.p_member ?? ""] ?? null };
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: { from: () => ({ download: async (p: string) => ({ data: new Blob([`%PDF-${p}`]) }) }) },
  }),
}));
import { GET } from "../app/(company)/company/resume-book/download/route";

const req = (q = "") => new Request(`https://connect.example/company/resume-book/download${q}`);

describe("resume book ZIP download", () => {
  beforeEach(() => {
    state.preview = false;
    state.hasBook = true;
    state.paths = { [A]: `${A}/packages/x/resume.pdf`, [B]: `${B}/../victim/packages/x/resume.pdf` };
  });

  it("refuses sponsor mode and companies without the resume book", async () => {
    state.preview = true;
    expect((await GET(req())).status).toBe(404);
    state.preview = false;
    state.hasBook = false;
    expect((await GET(req())).status).toBe(404);
  });

  it("zips valid resumes with an index and skips bad paths", async () => {
    const res = await GET(req("?program=Comm&year=2027"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(state.listArgs).toEqual({ p_program: "Comm", p_grad_year: 2027 });
    const text = new TextDecoder().decode(await res.arrayBuffer());
    expect(text).toContain("Jane Doe.pdf");
    expect(text).toContain(`%PDF-${A}/packages/x/resume.pdf`);
    expect(text).not.toContain("victim");
    expect(text).toContain(`"'=cmd"`);
  });

  it("rejects a bad grad year", async () => {
    expect((await GET(req("?year=abc"))).status).toBe(400);
  });
});
