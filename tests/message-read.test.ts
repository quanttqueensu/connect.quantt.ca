import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { markConversationRead } from "../lib/message-read";

afterEach(() => vi.restoreAllMocks());

function client(fetcher: typeof fetch) {
  return createClient("http://127.0.0.1:54321", "test-anon-key", {
    global: { fetch: fetcher },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

describe("conversation read markers", () => {
  it.each(["member", "company_user"] as const)(
    "updates only the %s read marker with the authenticated client",
    async (role) => {
      const requests: Request[] = [];
      const supabase = client(async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json([{ id: "thread-1" }]);
      });

      await markConversationRead(supabase, { id: "profile-1", role }, "thread-1");

      expect(requests).toHaveLength(1);
      const request = requests[0];
      const url = new URL(request.url);
      expect(request.method).toBe("PATCH");
      expect(url.pathname).toBe("/rest/v1/conversations");
      expect(url.searchParams.get("id")).toBe("eq.thread-1");
      expect(url.searchParams.get("member_id")).toBe(role === "member" ? "eq.profile-1" : null);
      const body = await request.json() as Record<string, string>;
      const column = role === "member" ? "member_last_read_at" : "company_last_read_at";
      expect(Object.keys(body)).toEqual([column]);
      expect(Number.isFinite(Date.parse(body[column]))).toBe(true);
      expect(request.headers.get("authorization")).toBe("Bearer test-anon-key");
    },
  );

  it("keeps its promise pending until the update completes", async () => {
    let finish!: (response: Response) => void;
    let started!: () => void;
    const requested = new Promise<void>((resolve) => { started = resolve; });
    const supabase = client(() => {
      started();
      return new Promise<Response>((resolve) => { finish = resolve; });
    });
    let settled = false;
    const task = markConversationRead(supabase, { id: "profile-1", role: "member" }, "thread-1")
      .then(() => { settled = true; });
    await requested;
    expect(settled).toBe(false);
    finish(Response.json([{ id: "thread-1" }]));
    await task;
    expect(settled).toBe(true);
  });

  it("surfaces database errors to the after callback", async () => {
    const supabase = client(async () => Response.json({ message: "Denied" }, { status: 403 }));
    await expect(markConversationRead(supabase, { id: "profile-1", role: "member" }, "thread-1"))
      .rejects.toThrow("Could not update conversation");
  });

  it("logs a silent RLS refusal without throwing or redirecting", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const supabase = client(async () => Response.json([]));
    await markConversationRead(supabase, { id: "profile-1", role: "member" }, "thread-1");
    expect(warn).toHaveBeenCalledWith("markRead: conversation thread-1 refused for profile profile-1");
  });
});
