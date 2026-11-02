import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  member: "11111111-1111-4111-8111-111111111111", path: "", cover: null as string | null,
  download: vi.fn(), upload: vi.fn(), insert: vi.fn(), remove: vi.fn(),
  missing: false, queryError: false, text: null as string | null,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => {
  throw Object.assign(new Error(url), { digest: "NEXT_REDIRECT" });
} }));
vi.mock("@/lib/auth", () => ({ requireProfile: async () => ({ id: state.member, role: "member", linkedin_url: "https://linkedin.com/in/member" }) }));
vi.mock("@/lib/notify", () => ({ notifyLater: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  storage: { from: () => ({ download: state.download, upload: state.upload, remove: state.remove }) },
}) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from: (table: string) => {
    const query = {
      select: () => query, eq: () => query, insert: state.insert,
      maybeSingle: async () => ({ data: state.missing ? null : { resume_path: state.path, cover_letter_path: state.cover, cover_letter: state.text }, error: state.queryError ? { message: "Unavailable" } : null }),
      single: async () => ({ data: table === "posts"
        ? { id: "post", kind: "job", external_url: null, status: "open", published: true, company_id: "firm" }
        : { id: "package", name: "Safe", resume_path: state.path, cover_letter_path: state.cover } }),
    };
    return query;
  },
}) }));
import { applyToJob } from "../lib/actions/applications";

describe("application snapshot download boundary", () => {
  beforeEach(() => {
    state.path = `${state.member}/packages/x/resume.pdf`;
    state.cover = null;
    state.missing = false; state.queryError = false; state.text = null;
    state.remove.mockReset().mockResolvedValue({ error: null });
    state.download.mockReset().mockResolvedValue({ data: new Blob(["%PDF-1.7\n"]) });
    state.upload.mockReset().mockResolvedValue({ error: null });
    state.insert.mockReset().mockResolvedValue({ error: null });
  });
  const form = () => {
    const data = new FormData();
    data.set("post_id", "post");
    return data;
  };

  it.each(["../victim/packages/x/resume.pdf", "packages/%2e%2e/resume.pdf", "packages/x/resume.pdf?x"]) (
    "never downloads an unsafe stored source: %s", async (suffix) => {
      state.path = `${state.member}/${suffix}`;
      await expect(applyToJob(form())).rejects.toThrow("application_document_invalid");
      expect(state.download).not.toHaveBeenCalled();
      expect(state.upload).not.toHaveBeenCalled();
    },
  );
  it("validates optional cover paths too", async () => {
    state.cover = `${state.member}/../victim/cover.pdf`;
    await expect(applyToJob(form())).rejects.toThrow("application_document_invalid");
    expect(state.download).not.toHaveBeenCalled();
  });
  it("copies a legitimate PDF and records its immutable snapshot", async () => {
    await applyToJob(form());
    expect(state.download).toHaveBeenCalledWith(state.path);
    const stored = state.insert.mock.calls[0][0];
    expect(stored.resume_path).toBe(`snapshots/${stored.id}/resume.pdf`);
    expect(state.upload).toHaveBeenCalledTimes(1);
  });
  it("uses the saved cover and profile LinkedIn without a package selection", async () => {
    state.cover = `${state.member}/packages/x/cover.pdf`;
    await applyToJob(form());
    expect(state.download.mock.calls.map(([path]) => path)).toEqual([state.path, state.cover]);
    expect(state.insert.mock.calls[0][0]).toMatchObject({ linkedin_url: "https://linkedin.com/in/member" });
    expect(state.insert.mock.calls[0][0]).not.toHaveProperty("package_id");
  });
  it("uses both overrides without reading or updating the saved files", async () => {
    const data = form();
    const resume = new File(["%PDF-1.7\ncustom resume"], "resume.pdf");
    const cover = new File(["%PDF-1.7\ncustom cover"], "cover.pdf");
    data.set("resume", resume); data.set("cover_pdf", cover);
    await applyToJob(data);
    expect(state.download).not.toHaveBeenCalled();
    expect(state.upload.mock.calls[0][1]).toBe(resume);
    expect(state.upload.mock.calls[1][1]).toBe(cover);
    expect(state.insert.mock.calls[0][0].cover_letter).toBeNull();
  });
  it("overrides just the resume and keeps the profile cover", async () => {
    state.cover = `${state.member}/packages/x/cover.pdf`;
    const data = form(); data.set("resume", new File(["%PDF-1.7\n"], "resume.pdf"));
    await applyToJob(data);
    expect(state.download).toHaveBeenCalledExactlyOnceWith(state.cover);
  });
  it("overrides just the cover and keeps the profile resume", async () => {
    state.cover = `${state.member}/packages/x/cover.pdf`;
    const data = form(); data.set("cover_pdf", new File(["%PDF-1.7\n"], "cover.pdf"));
    await applyToJob(data);
    expect(state.download).toHaveBeenCalledExactlyOnceWith(state.path);
  });
  it("allows direct application with no saved documents", async () => {
    state.missing = true;
    const data = form(); data.set("resume", new File(["%PDF-1.7\n"], "resume.pdf"));
    await applyToJob(data);
    expect(state.insert).toHaveBeenCalledOnce();
    expect(state.download).not.toHaveBeenCalled();
  });
  it("requires a resume when no profile resume or upload exists", async () => {
    state.missing = true;
    await expect(applyToJob(form())).rejects.toThrow("application_resume_required");
    expect(state.upload).not.toHaveBeenCalled();
  });
  it("does not silently omit defaults when the document query fails", async () => {
    state.queryError = true;
    await expect(applyToJob(form())).rejects.toThrow("application_documents_unavailable");
    expect(state.insert).not.toHaveBeenCalled();
  });
  it("rejects a spoofed PDF before creating any snapshots", async () => {
    const data = form(); data.set("cover_pdf", new File(["<html>"], "cover.pdf", { type: "application/pdf" }));
    await expect(applyToJob(data)).rejects.toThrow("application_document_invalid");
    expect(state.upload).not.toHaveBeenCalled();
    expect(state.download).not.toHaveBeenCalled();
  });
  it("can omit the saved cover without changing the profile", async () => {
    state.cover = `${state.member}/packages/x/cover.pdf`; state.text = "Saved letter";
    const data = form(); data.set("omit_cover", "on");
    await applyToJob(data);
    expect(state.download).toHaveBeenCalledExactlyOnceWith(state.path);
    expect(state.insert.mock.calls[0][0]).toMatchObject({ cover_letter: null, cover_letter_path: null });
  });
  it("preserves a legacy text cover by default", async () => {
    state.text = "Saved letter";
    await applyToJob(form());
    expect(state.insert.mock.calls[0][0].cover_letter).toBe("Saved letter");
  });
  it("cleans up the resume snapshot if copying the cover fails", async () => {
    state.cover = `${state.member}/packages/x/cover.pdf`;
    state.download.mockResolvedValueOnce({ data: new Blob(["%PDF-1.7\n"]) }).mockResolvedValueOnce({ error: { message: "Missing" } });
    await expect(applyToJob(form())).rejects.toThrow("application_document_invalid");
    expect(state.remove.mock.calls[0][0][0]).toMatch(/^snapshots\/.+\/resume.pdf$/);
    expect(state.insert).not.toHaveBeenCalled();
  });
  it("cleans up both snapshots if the application insert fails", async () => {
    state.cover = `${state.member}/packages/x/cover.pdf`;
    state.insert.mockResolvedValue({ error: { code: "23505" } });
    await expect(applyToJob(form())).rejects.toThrow("application_duplicate");
    expect(state.remove.mock.calls[0][0]).toHaveLength(2);
  });

});
