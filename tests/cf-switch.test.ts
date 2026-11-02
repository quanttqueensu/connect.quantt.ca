/**
 * The switch-over pieces end to end on SQLite: emailed-code sign-in and
 * sign-out, the middleware's session check, and the signed /files route.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import type { R2BucketLike } from "@/lib/db/storage";
import { signFileLink } from "@/lib/db/storage";

import { addMember, all, asD1, freshDb, type Db } from "./db/sqlite";

const state = vi.hoisted(() => ({
  raw: null as unknown as Db,
  env: {} as Record<string, unknown>,
  jar: new Map<string, string>(),
  sent: [] as { to: string; text: string }[],
}));

vi.mock("@/lib/hub/env", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/hub/env")>(),
  hubEnv: async () => state.env,
  hubEnvSync: () => state.env,
}));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: state.env }) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.jar.has(name) ? { value: state.jar.get(name) } : undefined),
    set: (name: string, value: string) => void state.jar.set(name, value),
    delete: (name: string | { name: string }) => void state.jar.delete(typeof name === "string" ? name : name.name),
  }),
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { logout, requestCode, verifyCode } from "../lib/actions/auth";
import { GET as fileRoute } from "../app/files/[...path]/route";
import { middleware } from "../middleware";

function memoryR2(): R2BucketLike {
  const store = new Map<string, Uint8Array>();
  store.set("resumes/m1/resume.pdf", new TextEncoder().encode("%PDF-1.7 test"));
  return {
    async get(key) {
      const bytes = store.get(key);
      if (!bytes) return null;
      return {
        arrayBuffer: async () => bytes.buffer as ArrayBuffer,
        body: new Blob([bytes as BlobPart]).stream(),
        httpMetadata: { contentType: "application/pdf" },
        size: bytes.byteLength,
      };
    },
    async head() { return null; },
    async put() {},
    async delete() {},
  };
}

function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  state.raw = freshDb();
  state.env = { DB: asD1(state.raw), FILES: memoryR2(), RESEND_API_KEY: "test", FILES_SIGNING_KEY: "test-signing-key" };
  state.jar = new Map();
  state.sent = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { to: string[]; text: string };
    state.sent.push({ to: body.to[0], text: body.text });
    return new Response("{}", { status: 200 });
  });
});

describe("emailed-code sign-in", () => {
  it("signs a member in with the emailed code and out again", async () => {
    const member = addMember(state.raw, { email: "Jane@QueensU.ca" });
    await expect(requestCode(form({ email: " jane@queensu.ca " }))).rejects.toThrow("redirect:/login?step=code");
    expect(state.sent).toHaveLength(1);
    const code = /\b(\d{6})\b/.exec(state.sent[0].text)![1];

    await expect(verifyCode(form({ code: "000000" === code ? "111111" : "000000" }))).rejects.toThrow(
      "redirect:/login?step=code&error=login_code_invalid",
    );
    await expect(verifyCode(form({ code }))).rejects.toThrow("redirect:/feed");
    const token = state.jar.get("connect_session")!;
    expect(token).toMatch(/^[\w-]{40,}$/);
    expect(state.jar.has("connect_login_email")).toBe(false);
    expect(all(state.raw, `SELECT profile_id FROM sessions`)).toEqual([{ profile_id: member }]);

    const signedIn = await middleware(new NextRequest("https://connect.test/login", { headers: { cookie: `connect_session=${token}` } }));
    expect(signedIn.headers.get("location")).toBe("https://connect.test/feed");

    await expect(logout()).rejects.toThrow("redirect:/login");
    expect(all(state.raw, `SELECT count(*) AS n FROM sessions`)[0].n).toBe(0);
  });

  it("answers the same way for an unknown email and sends nothing", async () => {
    await expect(requestCode(form({ email: "nobody@example.com" }))).rejects.toThrow("redirect:/login?step=code");
    expect(state.sent).toHaveLength(0);
  });
});

describe("middleware", () => {
  it("sends signed-out visitors to /login but leaves public pages and file links alone", async () => {
    const go = (path: string, cookie = "") =>
      middleware(new NextRequest(`https://connect.test${path}`, { headers: cookie ? { cookie } : {} }));
    expect((await go("/feed")).headers.get("location")).toBe("https://connect.test/login");
    expect((await go("/")).headers.get("location")).toBe("https://connect.test/login");
    expect((await go("/join")).status).toBe(200);
    expect((await go("/files/resumes/m1/resume.pdf")).status).toBe(200);

    const stale = await go("/feed", `connect_session=${"x".repeat(43)}`);
    expect(stale.headers.get("location")).toBe("https://connect.test/login");
    expect(stale.headers.get("set-cookie")).toMatch(/connect_session=;/);
  });
});

describe("/files route", () => {
  it("streams a signed file and refuses a tampered or unsigned link", async () => {
    const key = { secret: "test-signing-key", siteUrl: "https://connect.test" };
    const url = await signFileLink(key, "resumes", "m1/resume.pdf", 60);
    const res = await fileRoute(new NextRequest(url));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(await res.text()).toBe("%PDF-1.7 test");

    const tampered = url.replace("m1/resume.pdf", "m2/resume.pdf");
    expect((await fileRoute(new NextRequest(tampered))).status).toBe(404);
    expect((await fileRoute(new NextRequest("https://connect.test/files/resumes/m1/resume.pdf"))).status).toBe(404);
  });
});
