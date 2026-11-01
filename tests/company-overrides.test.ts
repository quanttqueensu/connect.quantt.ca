import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanyCapabilityOverride } from "../lib/types";

const state = vi.hoisted(() => ({
  isAdmin: true,
  readError: false,
  rows: [] as CompanyCapabilityOverride[],
  writes: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireProfile: async () => ({ id: "admin", is_admin: state.isAdmin }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      const filters = new Map<string, string>();
      let operation = "select";
      let payload: CompanyCapabilityOverride;
      const query = {
        select: () => query,
        eq: (key: string, value: string) => { filters.set(key, value); return query; },
        maybeSingle: () => query,
        upsert: (row: CompanyCapabilityOverride) => { operation = "upsert"; payload = row; return query; },
        delete: () => { operation = "delete"; return query; },
        insert: () => { operation = "insert"; return query; },
        then(resolve: (result: unknown) => unknown) {
          const matches = (row: CompanyCapabilityOverride) => [...filters].every(([key, value]) => row[key as keyof CompanyCapabilityOverride] === value);
          if (operation !== "select") state.writes(table, operation);
          if (operation === "upsert") {
            state.rows = state.rows.filter((r) => r.company_id !== payload.company_id || r.capability !== payload.capability);
            state.rows.push(payload);
          }
          if (operation === "delete") state.rows = state.rows.filter((r) => !matches(r));
          const data = table === "companies" ? { id: "acme" }
            : table === "sponsor_capabilities" ? [
              { key: "resume_book", kind: "boolean" },
              { key: "post_in_app_job", kind: "quota" },
            ] : state.rows.filter(matches);
          return Promise.resolve(resolve({ data, error: state.readError && operation === "select" ? { message: "read failed" } : null }));
        },
      };
      return query;
    },
  }),
}));

import { resetCompanyAccess, setCompanyAccess } from "../lib/actions/admin";
import { can, capValue, resolveAccess, type TierWithCaps } from "../lib/tiers";
const BASE_TIER: TierWithCaps = {
  id: "test-tier",
  key: "test",
  name: "Test tier",
  rank: 1,
  price_cents: null,
  blurb: "",
  applicant_embargo_hours: 0,
  resume_book_embargo_hours: 0,
  is_active: true,
  is_system: false,
  created_at: "2026-11-01T00:00:00Z",
  sponsor_tier_capabilities: [],
};

function form(book = "inherit", jobs = "inherit", quota = "") {
  const data = new FormData();
  data.set("company_id", "acme");
  data.set("access_resume_book", book);
  data.set("access_post_in_app_job", jobs);
  data.set("value_post_in_app_job", quota);
  return data;
}

function tier(book: boolean, quota = 2): TierWithCaps {
  return {
    ...BASE_TIER,
    sponsor_tier_capabilities: [
      ...(book ? [{ tier_id: BASE_TIER.id, capability: "resume_book", value: null }] : []),
      { tier_id: BASE_TIER.id, capability: "post_in_app_job", value: quota },
    ],
  };
}

describe("company feature overrides", () => {
  beforeEach(() => {
    state.isAdmin = true;
    state.readError = false;
    state.rows = [];
    state.writes.mockClear();
  });

  it("gives just one of five companies on the same tier an extra feature", async () => {
    await setCompanyAccess(form("grant"));
    const shared = tier(false);
    for (const company of ["acme", "b", "c", "d", "e"]) {
      const access = resolveAccess(shared, shared, state.rows.filter((r) => r.company_id === company));
      expect(can(access, "resume_book")).toBe(company === "acme");
    }
    expect(state.writes.mock.calls.every(([table]) => table !== "sponsor_tier_capabilities")).toBe(true);
  });

  it("keeps explicit grants and revocations through tier changes and repeated saves", async () => {
    await setCompanyAccess(form("grant"));
    await setCompanyAccess(form("grant"));
    for (const shared of [tier(true), tier(false)]) {
      expect(can(resolveAccess(shared, shared, state.rows), "resume_book")).toBe(true);
    }
    await setCompanyAccess(form("revoke"));
    for (const shared of [tier(false), tier(true)]) {
      expect(can(resolveAccess(shared, shared, state.rows), "resume_book")).toBe(false);
    }
    expect(state.rows).toEqual([{ company_id: "acme", capability: "resume_book", granted: false, value: null }]);
  });

  it("follows later tier changes after a feature is reset without clearing other overrides", async () => {
    await setCompanyAccess(form("grant", "grant", "7"));
    await setCompanyAccess(form("inherit", "grant", "7"));
    for (const included of [false, true]) {
      const shared = tier(included);
      const access = resolveAccess(shared, shared, state.rows);
      expect(can(access, "resume_book")).toBe(included);
      expect(capValue(access, "post_in_app_job")).toBe(7);
    }
  });

  it.each(["", "0", "12"])("supports unlimited, zero and numeric company job limits (%s)", async (value) => {
    await setCompanyAccess(form("inherit", "grant", value));
    const shared = tier(false, 20);
    expect(capValue(resolveAccess(shared, shared, state.rows), "post_in_app_job")).toBe(value === "" ? null : Number(value));
  });

  it.each(["-1", "1.5", "NaN", "2147483648"])("rejects invalid quotas before changing access (%s)", async (value) => {
    await expect(setCompanyAccess(form("grant", "grant", value))).rejects.toThrow("company_capability_value_invalid");
    expect(state.writes).not.toHaveBeenCalled();
  });

  it("rejects stale, missing or invalid feature modes before any writes", async () => {
    for (const mode of ["", "on", "unexpected"]) {
      await expect(setCompanyAccess(form(mode))).rejects.toThrow("company_capability_mode_invalid");
    }
    const missing = form();
    missing.delete("access_post_in_app_job");
    await expect(setCompanyAccess(missing)).rejects.toThrow("company_capability_mode_invalid");
    expect(state.writes).not.toHaveBeenCalled();
  });

  it("preserves overrides if loading the form's reference data fails", async () => {
    await setCompanyAccess(form("grant"));
    state.writes.mockClear();
    state.readError = true;
    await expect(setCompanyAccess(form())).rejects.toThrow("company_access_save_failed");
    expect(state.writes).not.toHaveBeenCalled();
    expect(state.rows).toHaveLength(1);
  });

  it("resets all overrides for only the selected company", async () => {
    await setCompanyAccess(form("grant", "grant", "4"));
    state.rows.push({ company_id: "rival", capability: "resume_book", granted: true, value: null });
    await resetCompanyAccess(form());
    expect(state.rows).toEqual([{ company_id: "rival", capability: "resume_book", granted: true, value: null }]);
  });

  it("does not let company contacts grant or reset access", async () => {
    state.isAdmin = false;
    await expect(setCompanyAccess(form("grant"))).rejects.toThrow("admins_only");
    await expect(resetCompanyAccess(form())).rejects.toThrow("admins_only");
    expect(state.writes).not.toHaveBeenCalled();
  });

  it("applies revocations to grandfathered features too", () => {
    expect(can(resolveAccess(tier(false), tier(true), [{ capability: "resume_book", granted: false, value: null }]), "resume_book")).toBe(false);
  });
});
