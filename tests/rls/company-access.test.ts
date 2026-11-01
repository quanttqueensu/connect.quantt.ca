import { beforeEach, describe, expect, it } from "vitest";
import {
  asService,
  asUser,
  resetDb,
  seedCompany,
  seedCompanyUser,
  seedMember,
  seedProfileDocuments,
} from "../helpers/db";

async function memberWithBook(email: string) {
  const memberId = await seedMember(email);
  const member = await asUser(email);
  await seedProfileDocuments(email, memberId);
  const { error: optErr } = await member
    .from("profiles")
    .update({ resume_book_opt_in: true })
    .eq("id", memberId);
  if (optErr) throw new Error(optErr.message);
  return memberId;
}

describe("per-firm access and no company feed", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("a company contact cannot read another firm's posts", async () => {
    const acme = await seedCompany("Acme Capital", { tierKey: "partner" });
    const rival = await seedCompany("Rival Partners", { tierKey: "partner" });
    await seedCompanyUser("recruiter@acme.dev", acme);
    const rivalOwner = await seedCompanyUser("owner@rival.dev", rival);

    const { data: post, error: postErr } = await asService()
      .from("posts")
      .insert({
        author_id: rivalOwner,
        company_id: rival,
        kind: "announcement",
        title: "Rival announcement",
        published: true,
        status: "open",
      })
      .select("id")
      .single();
    if (postErr) throw new Error(postErr.message);

    const recruiter = await asUser("recruiter@acme.dev");
    const { data } = await recruiter.from("posts").select("id").eq("id", post!.id);
    expect(data ?? []).toHaveLength(0);
  });

  it("a company user cannot grant their own firm extra access", async () => {
    const firm = await seedCompany("Partner Co", { tierKey: "partner" });
    await seedCompanyUser("partner@firm.dev", firm);
    const recruiter = await asUser("partner@firm.dev");
    const { error } = await recruiter.from("company_capability_overrides").insert({
      company_id: firm,
      capability: "dm_initiate_any",
      granted: true,
    });
    expect(error).toBeTruthy();
  });

  it("an admin override can give a none-tier firm the resume book", async () => {
    const firm = await seedCompany("None Co", { tierKey: "none" });
    await seedCompanyUser("none@firm.dev", firm);
    const memberId = await memberWithBook("opted@club.dev");

    const { error: ovErr } = await asService().from("company_capability_overrides").insert({
      company_id: firm,
      capability: "resume_book",
      granted: true,
    });
    if (ovErr) throw new Error(ovErr.message);

    const recruiter = await asUser("none@firm.dev");
    const { data, error } = await recruiter.rpc("resume_book_list");
    expect(error).toBeNull();
    expect((data ?? []).map((r: { id: string }) => r.id)).toContain(memberId);
  });

  it("an admin override can take the resume book away from a principal firm", async () => {
    const firm = await seedCompany("Principal Co", { tierKey: "principal" });
    await seedCompanyUser("principal@firm.dev", firm);
    await memberWithBook("opted@club.dev");

    const { error: ovErr } = await asService().from("company_capability_overrides").insert({
      company_id: firm,
      capability: "resume_book",
      granted: false,
    });
    if (ovErr) throw new Error(ovErr.message);

    const recruiter = await asUser("principal@firm.dev");
    const { data, error } = await recruiter.rpc("resume_book_list");
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("an inactive firm has no resume book even on principal", async () => {
    const firm = await seedCompany("Principal Co", { tierKey: "principal" });
    await seedCompanyUser("principal@firm.dev", firm);
    await memberWithBook("opted@club.dev");

    const { error: stErr } = await asService()
      .from("companies")
      .update({ status: "inactive" })
      .eq("id", firm);
    if (stErr) throw new Error(stErr.message);

    const recruiter = await asUser("principal@firm.dev");
    const { data, error } = await recruiter.rpc("resume_book_list");
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});
