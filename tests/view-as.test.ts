/**
 * The admin "View as" switch and alumni mode: only admins can preview an alum,
 * the preview is read-only, and switching view clears both preview cookies.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSession } from "@/lib/cf-auth/sessions";
import { addMember, asD1, freshDb, NOW, type Db } from "./db/sqlite";

const state = vi.hoisted(() => ({
  raw: null as unknown as Db,
  env: {} as Record<string, unknown>,
  jar: new Map<string, string>(),
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
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`redirect:${url}`); },
  notFound: () => { throw new Error("not-found"); },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { enterAlumniMode, viewAs } from "../lib/actions/view-as";
import { currentAlumnus, requireAlumnusForWrite } from "../lib/alumni/current";
import { ALUMNI_MODE_COOKIE } from "../lib/alumni-mode-cookie";
import { inviteAlumnus } from "../lib/alumni/data";
import { requestAlumniCode, verifyAlumniCode } from "../lib/alumni/auth";
import { SPONSOR_MODE_COOKIE } from "../lib/sponsor-mode-cookie";

let admin = "";
let member = "";
let alumId = "";

async function signIn(profileId: string) {
  const { token } = await createSession(asD1(state.raw), profileId);
  state.jar = new Map([["connect_session", token]]);
}
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

beforeEach(async () => {
  state.raw = freshDb();
  state.env = { DB: asD1(state.raw) };
  admin = addMember(state.raw, { admin: true });
  member = addMember(state.raw);
  const db = asD1(state.raw);
  await inviteAlumnus(db, "alum@example.com", "Alex Alum", admin, NOW);
  let code = "";
  await requestAlumniCode(db, "alum@example.com", async (_to, c) => void (code = c), NOW);
  const res = await verifyAlumniCode(db, "alum@example.com", code, NOW);
  if (!res.ok) throw new Error(res.code);
  alumId = res.alumniId;
});

describe("View as", () => {
  it("lets an admin view the alumni area as an alum, read-only", async () => {
    await signIn(admin);
    await expect(enterAlumniMode(form({ alumni_id: "nope" }))).rejects.toThrow("redirect:/admin/alumni-mode");
    await expect(enterAlumniMode(form({ alumni_id: alumId }))).rejects.toThrow("redirect:/alumni");
    expect(state.jar.get(ALUMNI_MODE_COOKIE)).toBe(`${admin}:${alumId}`);
    expect(await currentAlumnus()).toMatchObject({ id: alumId, full_name: "Alex Alum", preview: true });
    await expect(requireAlumnusForWrite()).rejects.toThrow("read-only");
  });

  it("ignores the alumni mode cookie for non-admins and for another admin's cookie", async () => {
    await signIn(member);
    await expect(enterAlumniMode(form({ alumni_id: alumId }))).rejects.toThrow("redirect:/feed");
    state.jar.set(ALUMNI_MODE_COOKIE, `${member}:${alumId}`);
    expect(await currentAlumnus()).toBeNull();

    await signIn(admin);
    state.jar.set(ALUMNI_MODE_COOKIE, `${member}:${alumId}`);
    expect(await currentAlumnus()).toBeNull();
  });

  it("clears both previews when switching view", async () => {
    await signIn(admin);
    state.jar.set(ALUMNI_MODE_COOKIE, `${admin}:${alumId}`);
    state.jar.set(SPONSOR_MODE_COOKIE, `${admin}:x`);
    await expect(viewAs(form({ target: "member" }))).rejects.toThrow("redirect:/feed");
    expect(state.jar.has(ALUMNI_MODE_COOKIE)).toBe(false);
    expect(state.jar.has(SPONSOR_MODE_COOKIE)).toBe(false);
    await expect(viewAs(form({ target: "sponsor" }))).rejects.toThrow("redirect:/admin/sponsor-mode");
    await expect(viewAs(form({ target: "alum" }))).rejects.toThrow("redirect:/admin/alumni-mode");
    await expect(viewAs(form({ target: "bogus" }))).rejects.toThrow("redirect:/admin");
  });
});
