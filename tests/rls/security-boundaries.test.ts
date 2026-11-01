import { beforeEach, describe, expect, it } from "vitest";
import { asService, asUser, resetDb, seedCompany, seedCompanyUser } from "../helpers/db";

describe("atomic posting slots", () => {
  beforeEach(resetDb);

  it("rejects bulk and concurrent inserts beyond a finite override", async () => {
    const company = await seedCompany("Limited", { tierKey: "partner" });
    const author = await seedCompanyUser("limited@test.dev", company);
    const service = asService();
    const override = await service.from("company_capability_overrides").insert({
      company_id: company, capability: "post_in_app_job", granted: true, value: 1,
    });
    expect(override.error).toBeNull();
    const recruiter = await asUser("limited@test.dev");
    const row = () => ({
      author_id: author, company_id: company, kind: "job", title: "Intern",
      role_type: "internship", term_season: "summer", term_year: 2027,
      published: true, status: "open",
    });
    const bulk = await recruiter.from("posts").insert([row(), row()]);
    expect(bulk.error).toBeTruthy();
    const clients = await Promise.all(Array.from({ length: 5 }, () => asUser("limited@test.dev")));
    const results = await Promise.all(clients.map((client) => client.from("posts").insert(row())));
    expect(results.filter((result) => !result.error)).toHaveLength(1);
    const { data, error } = await service.from("posts").select("id").eq("company_id", company).eq("status", "open");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("rejects concurrent reopening beyond the remaining slot", async () => {
    const company = await seedCompany("Supporter", { tierKey: "supporter" });
    const author = await seedCompanyUser("supporter@test.dev", company);
    const recruiter = await asUser("supporter@test.dev");
    const { data, error } = await recruiter.from("posts").insert([1, 2].map((n) => ({
      author_id: author, company_id: company, kind: "job", title: `Intern ${n}`,
      role_type: "internship", term_season: "summer", term_year: 2027,
      published: true, status: "closed",
    }))).select("id");
    expect(error).toBeNull();
    const clients = await Promise.all([asUser("supporter@test.dev"), asUser("supporter@test.dev")]);
    const results = await Promise.all(clients.map((client, i) => client.from("posts")
      .update({ status: "open" }).eq("id", data![i].id)));
    expect(results.filter((result) => !result.error)).toHaveLength(1);
    const final = await asService().from("posts").select("id").eq("company_id", company).eq("status", "open");
    expect(final.error).toBeNull();
    expect(final.data).toHaveLength(1);
  });
});

describe("server-only access-request admission", () => {
  beforeEach(resetDb);
  it("gives duplicate requests no signal or overwrite, and bounds a source", async () => {
    const source = crypto.randomUUID().replaceAll("-", "").repeat(2);
    const args = {
      p_company_name: "Original", p_contact_name: "Pat", p_contact_email: "pat@co.dev",
      p_website: null, p_note: null, p_source: source,
    };
    const service = asService();
    const first = await service.rpc("submit_join_request", args);
    const duplicate = await service.rpc("submit_join_request", {
      ...args, p_company_name: "Replacement", p_contact_email: " PAT@CO.DEV ",
    });
    expect(first.error).toBeNull();
    expect(duplicate.error).toBeNull();
    expect(first.data).toEqual(duplicate.data);
    for (let n = 0; n < 8; n++) {
      const result = await service.rpc("submit_join_request", { ...args, p_contact_email: `pat${n}@co.dev` });
      expect(result.error).toBeNull();
      expect(result.data).toEqual(first.data);
    }
    const rows = await service.from("company_join_requests").select("contact_email,company_name");
    expect(rows.error).toBeNull();
    expect(rows.data).toHaveLength(4);
    expect(rows.data?.find((row) => row.contact_email === "pat@co.dev")?.company_name).toBe("Original");
  });
});
