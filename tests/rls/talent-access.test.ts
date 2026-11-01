import { beforeEach, describe, expect, it } from "vitest";
import {
  asUser,
  resetDb,
  seedCompany,
  seedCompanyUser,
  seedMember,
} from "../helpers/db";

async function memberWithBook(email: string) {
  const memberId = await seedMember(email);
  const member = await asUser(email);
  const { error: pkgErr } = await member.from("member_documents").insert({
    member_id: memberId,
    resume_path: `${memberId}/packages/x/resume.pdf`,
  });
  if (pkgErr) throw new Error(pkgErr.message);
  const { error: optErr } = await member
    .from("profiles")
    .update({ resume_book_opt_in: true })
    .eq("id", memberId);
  if (optErr) throw new Error(optErr.message);
  return memberId;
}

describe("resume book, search, and DM-any", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("a none-tier firm cannot list the resume book", async () => {
    const firm = await seedCompany("None Co", { tierKey: "none" });
    await seedCompanyUser("none@firm.dev", firm);
    await memberWithBook("opted@club.dev");

    const recruiter = await asUser("none@firm.dev");
    const { data, error } = await recruiter.rpc("resume_book_list");
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("a principal firm sees a just-opted-in member immediately", async () => {
    const firm = await seedCompany("Principal Co", { tierKey: "principal" });
    await seedCompanyUser("principal@firm.dev", firm);
    const memberId = await memberWithBook("opted@club.dev");

    const recruiter = await asUser("principal@firm.dev");
    const { data, error } = await recruiter.rpc("resume_book_list");
    expect(error).toBeNull();
    expect((data ?? []).map((r: { id: string }) => r.id)).toContain(memberId);
  });

  it("a partner firm does not see a just-opted-in member during the book delay", async () => {
    const firm = await seedCompany("Partner Co", { tierKey: "partner" });
    await seedCompanyUser("partner@firm.dev", firm);
    await memberWithBook("opted@club.dev");

    const recruiter = await asUser("partner@firm.dev");
    const { data, error } = await recruiter.rpc("resume_book_list");
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("candidate search is empty below leader", async () => {
    const firm = await seedCompany("Partner Co", { tierKey: "partner" });
    await seedCompanyUser("partner@firm.dev", firm);
    const recruiter = await asUser("partner@firm.dev");
    const { data, error } = await recruiter.rpc("candidate_search_list", { p_q: "quant" });
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("principal can start a conversation with an opted-in member who never applied", async () => {
    const firm = await seedCompany("Principal Co", { tierKey: "principal" });
    await seedCompanyUser("principal@firm.dev", firm);
    const memberId = await memberWithBook("opted@club.dev");

    const recruiter = await asUser("principal@firm.dev");
    const { data, error } = await recruiter
      .from("conversations")
      .insert({ member_id: memberId, company_id: firm })
      .select("id")
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
  });

  it("partner cannot DM a non-applicant even if they opted in", async () => {
    const firm = await seedCompany("Partner Co", { tierKey: "partner" });
    await seedCompanyUser("partner@firm.dev", firm);
    const memberId = await memberWithBook("opted@club.dev");

    const recruiter = await asUser("partner@firm.dev");
    const { data, error } = await recruiter
      .from("conversations")
      .insert({ member_id: memberId, company_id: firm })
      .select("id");
    expect((data ?? []).length).toBe(0);
    expect(error).toBeTruthy();
  });
});
