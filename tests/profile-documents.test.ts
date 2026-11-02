import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  member: "11111111-1111-4111-8111-111111111111", role: "member",
  upload: vi.fn(), remove: vi.fn(), upsert: vi.fn(), update: vi.fn(),
  saved: [] as { member_id: string }[], error: null as { message: string } | null, synced: false,
}));
vi.mock("@/lib/hub/env", () => ({ hubEnv: async () => ({ DB: {}, FILES: {} }) }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: async () => ({ env: {} }) }));
vi.mock("@/lib/directory-files", () => ({
  getDirectorySync: async () => state.synced, setDirectorySync: vi.fn(), syncDirectoryFiles: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => {
  throw Object.assign(new Error(url), { digest: "NEXT_REDIRECT" });
} }));
vi.mock("@/lib/auth", () => ({ requireProfile: async () => ({ id: state.member, role: state.role }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  storage: { from: () => ({ remove: state.remove }) },
}) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  storage: { from: () => ({ upload: state.upload }) },
  from: () => {
    const query = { eq: vi.fn(() => query), select: async () => ({ data: state.saved, error: state.error }) };
    state.upsert.mockImplementation(() => query);
    state.update.mockImplementation(() => query);
    return { upsert: state.upsert, update: state.update };
  },
}) }));
import { saveProfileDocument, removeProfileDocument } from "../lib/actions/profile";

const form = (body = "%PDF-1.7\n") => {
  const data = new FormData(); data.set("document", new File([body], "resume.pdf", { type: "application/pdf" }));
  return data;
};
describe("profile document writes", () => {
  beforeEach(() => {
    state.role = "member"; state.synced = false; state.saved = [{ member_id: state.member }]; state.error = null;
    state.upload.mockReset().mockResolvedValue({ error: null });
    state.remove.mockReset().mockResolvedValue({ error: null });
    state.upsert.mockReset(); state.update.mockReset();
  });
  it("replaces the resume without overwriting the cover", async () => {
    await saveProfileDocument("resume", form());
    const row = state.upsert.mock.calls[0][0];
    expect(row.member_id).toBe(state.member);
    expect(row.resume_path).toMatch(new RegExp(`^${state.member}/packages/[a-f0-9-]+/resume.pdf$`));
    expect(row).not.toHaveProperty("cover_letter_path");
    expect(row).not.toHaveProperty("cover_letter");
    expect(state.upload).toHaveBeenCalledWith(row.resume_path, expect.any(File), { contentType: "application/pdf" });
  });
  it("replaces a legacy text cover with a PDF without changing the resume", async () => {
    await saveProfileDocument("cover", form());
    const row = state.upsert.mock.calls[0][0];
    expect(row.cover_letter_path).toMatch(/\/cover.pdf$/);
    expect(row.cover_letter).toBeNull();
    expect(row).not.toHaveProperty("resume_path");
  });
  it("refuses resume changes while the member keeps sync on, but not the cover", async () => {
    state.synced = true;
    await expect(saveProfileDocument("resume", form())).rejects.toThrow("profile_files_synced");
    await expect(removeProfileDocument("resume")).rejects.toThrow("profile_files_synced");
    expect(state.upload).not.toHaveBeenCalled();
    await saveProfileDocument("cover", form());
    expect(state.upsert).toHaveBeenCalledOnce();
  });
  it("rejects a PDF with spoofed MIME before uploading", async () => {
    await expect(saveProfileDocument("resume", form("<html>"))).rejects.toThrow("profile_document_invalid");
    expect(state.upload).not.toHaveBeenCalled();
    expect(state.upsert).not.toHaveBeenCalled();
  });
  it("cleans up an uploaded file when attaching it fails", async () => {
    state.error = { message: "Failure" };
    await expect(saveProfileDocument("resume", form())).rejects.toThrow("profile_document_save_failed");
    expect(state.remove).toHaveBeenCalledExactlyOnceWith([state.upload.mock.calls[0][0]]);
  });
  it("treats silently dropped writes as failure", async () => {
    state.saved = [];
    await expect(saveProfileDocument("resume", form())).rejects.toThrow("profile_document_save_failed");
    expect(state.remove).toHaveBeenCalledOnce();
  });
  it("removes the cover reference and legacy text without deleting snapshots", async () => {
    await removeProfileDocument("cover");
    expect(state.update.mock.calls[0][0]).toMatchObject({ cover_letter_path: null, cover_letter: null });
    expect(state.update.mock.calls[0][0]).not.toHaveProperty("resume_path");
    expect(state.remove).not.toHaveBeenCalled();
  });
  it("refuses non-member uploads and removals", async () => {
    state.role = "company_user";
    await expect(saveProfileDocument("resume", form())).rejects.toThrow("Members only");
    await expect(removeProfileDocument("resume")).rejects.toThrow("Members only");
    expect(state.upload).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
  });
});
