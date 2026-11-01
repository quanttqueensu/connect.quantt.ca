import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rpc: vi.fn(), source: "192.0.2.1" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(state.source ? { "cf-connecting-ip": state.source } : {}),
  cookies: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: state.rpc }) }));
import { submitCompanyRequest } from "../lib/actions/admin";

function form(email = "pat@example.com") {
  const data = new FormData();
  for (const [key, value] of Object.entries({ company_name: "Co", contact_name: "Pat", contact_email: email })) data.set(key, value);
  return data;
}

describe("public join action", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-service-secret");
    state.rpc.mockReset().mockResolvedValue({ data: null, error: null });
    state.source = "192.0.2.1";
  });

  it("uses one response for new, duplicate, and throttled valid submissions", async () => {
    // The service-only RPC deliberately returns no admission/existence signal.
    for (const email of ["pat@example.com", " PAT@EXAMPLE.COM ", "pat@example.com"]) {
      await expect(submitCompanyRequest(form(email))).rejects.toThrow("/join?sent=1");
    }
    expect(state.rpc).toHaveBeenCalledTimes(3);
    const args = state.rpc.mock.calls[0][1];
    expect(args.p_contact_email).toBe("pat@example.com");
    expect(args.p_source).toMatch(/^[a-f0-9]{64}$/);
    expect(args.p_source).not.toContain("192.0.2.1");
    expect(state.rpc.mock.calls[1][1]).toEqual(args);
  });

  it("uses a stable fallback source and keeps input-only validation", async () => {
    state.source = "";
    await expect(submitCompanyRequest(form())).rejects.toThrow("/join?sent=1");
    const source = state.rpc.mock.calls[0][1].p_source;
    await expect(submitCompanyRequest(form("next@example.com"))).rejects.toThrow("/join?sent=1");
    expect(state.rpc.mock.calls[1][1].p_source).toBe(source);
    await expect(submitCompanyRequest(form("invalid"))).rejects.toThrow("/join?error=join_request_failed");
    expect(state.rpc).toHaveBeenCalledTimes(2);
  });
});
