import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  admin: true,
  existing: [] as { id: string; name: string }[],
  inserted: [] as { table: string; row: Record<string, unknown> }[],
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  requireProfile: async () => ({ id: "admin-1", is_admin: state.admin }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => ({
      select: async () => ({ data: state.existing }),
      insert: (row: Record<string, unknown>) => {
        state.inserted.push({ table, row });
        const result = { data: { id: "new-co" }, error: null };
        return Object.assign(Promise.resolve(result), { select: () => ({ single: async () => result }) });
      },
    }),
  }),
}));
import { addCompany } from "../lib/actions/admin";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("addCompany", () => {
  beforeEach(() => {
    state.admin = true;
    state.existing = [{ id: "c1", name: "Acme Capital" }];
    state.inserted = [];
  });

  it("creates an active firm on the chosen level with no invite", async () => {
    await expect(
      addCompany(form({ name: " Northwind ", sponsor_tier_id: "tier-p", website: "https://nw.example" })),
    ).rejects.toThrow("REDIRECT /admin/companies?added=1#company-new-co");
    const company = state.inserted.find((i) => i.table === "companies")!.row;
    expect(company).toMatchObject({
      name: "Northwind", sponsor_tier_id: "tier-p", status: "active",
      website: "https://nw.example/", logo_url: null,
    });
    expect(String(company.slug)).toMatch(/^northwind-[a-z0-9]+$/);
    expect(state.inserted.some((i) => i.table === "invites")).toBe(false);
  });

  it("refuses non-admins, duplicates, missing fields and bad links", async () => {
    state.admin = false;
    await expect(addCompany(form({ name: "X", sponsor_tier_id: "t" }))).rejects.toThrow("admins_only");
    state.admin = true;
    await expect(addCompany(form({ name: "acme capital", sponsor_tier_id: "t" }))).rejects.toThrow("company_exists");
    await expect(addCompany(form({ name: "", sponsor_tier_id: "t" }))).rejects.toThrow("company_name_required");
    await expect(addCompany(form({ name: "Y" }))).rejects.toThrow("invite_tier_required");
    await expect(addCompany(form({ name: "Y", sponsor_tier_id: "t", logo_url: "javascript:alert(1)" })))
      .rejects.toThrow("company_url_invalid");
    expect(state.inserted).toEqual([]);
  });
});
