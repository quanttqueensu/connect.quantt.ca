import { beforeEach, describe, expect, it } from "vitest";
import {
  asAnon,
  asService,
  asUser,
  resetDb,
  seedCompany,
  seedCompanyUser,
  seedProfileDocuments,
  seedInAppJob,
  seedMember,
} from "../helpers/db";

describe("privileged profile columns", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("a member cannot change their own role, is_admin, or email", async () => {
    const id = await seedMember("member@test.dev");
    const member = await asUser("member@test.dev");
    await member
      .from("profiles")
      .update({ role: "company_user", is_admin: true, email: "evil@test.dev" })
      .eq("id", id);

    const { data } = await asService()
      .from("profiles")
      .select("role, is_admin, email")
      .eq("id", id)
      .single();
    expect(data).toMatchObject({
      role: "member",
      is_admin: false,
      email: "member@test.dev",
    });
  });

  it("a company user cannot opt into the resume book", async () => {
    const firm = await seedCompany("Acme Capital", { tierKey: "partner" });
    const id = await seedCompanyUser("recruiter@acme.dev", firm);
    const recruiter = await asUser("recruiter@acme.dev");
    const { error } = await recruiter
      .from("profiles")
      .update({ resume_book_opt_in: true })
      .eq("id", id);
    expect(error?.message).toMatch(/resume_book_opt_in_is_member/);
  });
});

describe("hiring package path ownership", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("rejects a resume_path whose first segment is another member", async () => {
    const aId = await seedMember("a@test.dev");
    const bId = await seedMember("b@test.dev");
    const a = await asUser("a@test.dev");
    const { error } = await a.from("hiring_packages").insert({
      member_id: aId,
      name: "Stolen",
      linkedin_url: "https://linkedin.com/in/a",
      resume_path: `${bId}/packages/x/resume.pdf`,
    });
    expect(error?.message).toMatch(/Invalid resume path/);
  });
});

describe("join requests are not an auth bypass", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("direct public inserts are denied, including pending requests", async () => {
    const firm = await seedCompany("Acme Capital", { tierKey: "partner" });
    const ok = await asAnon().from("company_join_requests").insert({
      company_name: "New Co",
      contact_name: "Pat",
      contact_email: "pat@new.co",
      status: "pending",
    });
    expect(ok.error).toBeTruthy();

    const approved = await asAnon().from("company_join_requests").insert({
      company_name: "New Co 2",
      contact_name: "Pat",
      contact_email: "pat2@new.co",
      status: "approved",
    });
    expect(approved.error).toBeTruthy();

    const linked = await asAnon().from("company_join_requests").insert({
      company_name: "New Co 3",
      contact_name: "Pat",
      contact_email: "pat3@new.co",
      status: "pending",
      company_id: firm,
    });
    expect(linked.error).toBeTruthy();

    await seedMember("member@test.dev");
    const member = await asUser("member@test.dev");
    const direct = await member.from("company_join_requests").insert({
      company_name: "New Co", contact_name: "Pat", contact_email: "pat@new.co",
    });
    expect(direct.error).toBeTruthy();
    const rpc = await member.rpc("submit_join_request", {
      p_company_name: "New Co", p_website: null, p_contact_name: "Pat",
      p_contact_email: "pat@new.co", p_note: null, p_source: "a".repeat(64),
    });
    expect(rpc.error).toBeTruthy();

    const { data } = await asAnon().from("company_join_requests").select("id");
    expect(data ?? []).toHaveLength(0);
  });
});

describe("service-role RPCs and helper leaks", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("anon and a member cannot execute test_reset", async () => {
    const anon = await asAnon().rpc("test_reset");
    expect(anon.error).toBeTruthy();

    await seedMember("member@test.dev");
    const member = await asUser("member@test.dev");
    const asMember = await member.rpc("test_reset");
    expect(asMember.error).toBeTruthy();
  });

  it("a rival firm cannot probe member_applied_to_company for another company", async () => {
    const acme = await seedCompany("Acme Capital", { tierKey: "partner" });
    const rival = await seedCompany("Rival Partners", { tierKey: "partner" });
    const author = await seedCompanyUser("recruiter@acme.dev", acme);
    await seedCompanyUser("owner@rival.dev", rival);
    const memberId = await seedMember("member@test.dev");
    const postId = await seedInAppJob(author, acme);
    const appId = crypto.randomUUID();
    const member = await asUser("member@test.dev");
    const inserted = await member.from("applications").insert({
      id: appId,
      member_id: memberId,
      kind: "in_app",
      post_id: postId,
      resume_path: `snapshots/${appId}/resume.pdf`,
    });
    expect(inserted.error).toBeNull();

    const rivalUser = await asUser("owner@rival.dev");
    const { data, error } = await rivalUser.rpc("member_applied_to_company", {
      p_member: memberId,
      p_company: acme,
    });
    expect(error).toBeNull();
    expect(data).toBe(false);

    const acmeUser = await asUser("recruiter@acme.dev");
    const own = await acmeUser.rpc("member_applied_to_company", {
      p_member: memberId,
      p_company: acme,
    });
    expect(own.error).toBeNull();
    expect(own.data).toBe(true);
  });

  it("a none-tier firm cannot learn opt-in via my_opted_in_member", async () => {
    const firm = await seedCompany("None Co", { tierKey: "none" });
    await seedCompanyUser("none@firm.dev", firm);
    const memberId = await seedMember("opted@club.dev");
    await seedProfileDocuments("opted@club.dev", memberId);
    const member = await asUser("opted@club.dev");
    await member.from("profiles").update({ resume_book_opt_in: true }).eq("id", memberId);

    const recruiter = await asUser("none@firm.dev");
    const { data, error } = await recruiter.rpc("my_opted_in_member", {
      p_member: memberId,
    });
    expect(error).toBeNull();
    expect(data).toBe(false);
  });
});

describe("storage writes", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("a company user cannot upload a photo or a snapshot-prefix resume", async () => {
    const firm = await seedCompany("Acme Capital", { tierKey: "partner" });
    const id = await seedCompanyUser("recruiter@acme.dev", firm);
    const recruiter = await asUser("recruiter@acme.dev");
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff]);

    const photo = await recruiter.storage.from("photos").upload(`${id}/avatar.jpg`, jpeg, {
      contentType: "image/jpeg",
    });
    expect(photo.error).toBeTruthy();

    const snap = await recruiter.storage
      .from("resumes")
      .upload(`snapshots/${crypto.randomUUID()}/resume.pdf`, jpeg, {
        contentType: "application/pdf",
      });
    expect(snap.error).toBeTruthy();
  });

  it("a member cannot upload a resume under snapshots/ or another member's prefix", async () => {
    const aId = await seedMember("a@test.dev");
    const bId = await seedMember("b@test.dev");
    const a = await asUser("a@test.dev");
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

    const stolen = await a.storage.from("resumes").upload(`${bId}/packages/x/resume.pdf`, pdf, {
      contentType: "application/pdf",
    });
    expect(stolen.error).toBeTruthy();

    const snap = await a.storage
      .from("resumes")
      .upload(`snapshots/${crypto.randomUUID()}/resume.pdf`, pdf, {
        contentType: "application/pdf",
      });
    expect(snap.error).toBeTruthy();

    const own = await a.storage.from("resumes").upload(`${aId}/packages/x/resume.pdf`, pdf, {
      contentType: "application/pdf",
    });
    expect(own.error).toBeNull();
  });
});
