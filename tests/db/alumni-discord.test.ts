import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { getAlumniDiscord, linkAlumnusDiscord, removeAlumnusFromDiscord } from "@/lib/alumni/discord";
import { ALUMNI_DISCORD_SCHEMA } from "@/lib/alumni/schema";
import { inviteAlumnus, removeAlumnus } from "@/lib/alumni/data";

import { addMember, asD1, freshDb, NOW } from "./sqlite";

const ENV = { DISCORD_CLIENT_ID: "cid", DISCORD_CLIENT_SECRET: "sec", DISCORD_BOT_TOKEN: "tok", DISCORD_GUILD_ID: "g1" };
const ROLE = "r-alumni";

/** A fake Discord: records every call, knows which users are already in the server. */
function fakeDiscord(inServer: Record<string, { roles: string[]; nick?: string | null }> = {}) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init.body;
    calls.push({ method, url, body });
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
    if (url.endsWith("/oauth2/token")) return json({ access_token: "user-token" });
    if (url.endsWith("/users/@me")) return json({ id: "d42", username: "alexalum" });
    if (url.endsWith("/guilds/g1/roles")) return json([{ id: "r-member", name: "Member" }, { id: ROLE, name: "Alumni" }]);
    const m = /\/guilds\/g1\/members\/([\w-]+)(\/roles\/[\w-]+)?$/.exec(url);
    if (m) {
      if (method === "GET") return inServer[m[1]] ? json(inServer[m[1]]) : new Response("", { status: 404 });
      return new Response(null, { status: 204 });
    }
    return new Response("", { status: 500 });
  }) as typeof fetch;
  return { f, calls };
}

async function setup() {
  const raw = freshDb();
  const admin = addMember(raw, { admin: true });
  const db = asD1(raw);
  await inviteAlumnus(db, "alex@firm.com", "Alex Alum", admin, NOW);
  return { raw, db };
}

describe("alumni discord schema", () => {
  it("matches db/migrations/0007_alumni_discord.sql", () => {
    const sql = readFileSync(resolve(__dirname, "../../db/migrations/0007_alumni_discord.sql"), "utf8");
    const norm = (s: string) => s.replace(/\$\{NOW\}|\(strftime\('%Y-%m-%dT%H:%M:%fZ', 'now'\)\)/g, "NOW");
    for (const stmt of ALUMNI_DISCORD_SCHEMA) expect(norm(sql)).toContain(norm(stmt.trim()));
  });
});

describe("alumni join the Discord", () => {
  it("adds a new alumnus to the server with only the Alumni role and their name", async () => {
    const { raw, db } = await setup();
    raw.prepare(`INSERT INTO alumni (id, email, full_name) VALUES ('a1', 'alex@firm.com', 'Alex Alum')`).run();
    const { f, calls } = fakeDiscord();
    const r = await linkAlumnusDiscord(db, ENV, { id: "a1", full_name: "Alex Alum" }, "code", "https://connect.quantt.ca", f);
    expect(r).toEqual({ ok: true, outcome: "added", username: "alexalum" });
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toMatch(/\/guilds\/g1\/members\/d42$/);
    expect(put.body).toEqual({ access_token: "user-token", roles: [ROLE], nick: "Alex Alum" });
    const token = calls.find((c) => c.url.endsWith("/oauth2/token"))!;
    expect(String(token.body)).toContain("redirect_uri=https%3A%2F%2Fconnect.quantt.ca%2Falumni%2Fdiscord%2Fcallback");
    expect((await getAlumniDiscord(db, "a1"))?.discord_id).toBe("d42");
  });

  it("only adds the Alumni role to someone already in the server, keeping their roles and nickname", async () => {
    const { raw, db } = await setup();
    raw.prepare(`INSERT INTO alumni (id, email, full_name) VALUES ('a1', 'alex@firm.com', 'Alex Alum')`).run();
    const { f, calls } = fakeDiscord({ d42: { roles: ["r-member"], nick: "Alex A." } });
    const r = await linkAlumnusDiscord(db, ENV, { id: "a1", full_name: "Alex Alum" }, "code", "https://x", f);
    expect(r.ok).toBe(true);
    const writes = calls.filter((c) => c.method !== "GET" && !c.url.includes("oauth2"));
    expect(writes.map((c) => `${c.method} ${c.url.replace("https://discord.com/api/v10", "")}`)).toEqual([
      `PUT /guilds/g1/members/d42/roles/${ROLE}`,
    ]);
  });

  it("removing an alumnus takes the Alumni role away and the link goes with the account", async () => {
    const { raw, db } = await setup();
    raw.prepare(`INSERT INTO alumni (id, email, full_name) VALUES ('a1', 'alex@firm.com', 'Alex Alum')`).run();
    const { f, calls } = fakeDiscord();
    await linkAlumnusDiscord(db, ENV, { id: "a1", full_name: "Alex Alum" }, "code", "https://x", f);
    calls.length = 0;
    expect(await removeAlumnusFromDiscord(db, ENV, "a1", f)).toBe("removed");
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", url: `https://discord.com/api/v10/guilds/g1/members/d42/roles/${ROLE}` });
    await removeAlumnus(db, "a1");
    expect(await getAlumniDiscord(db, "a1")).toBeNull();
    expect(await removeAlumnusFromDiscord(db, ENV, "a1", f)).toBe("not linked");
  });

  it("one Discord account belongs to one alumnus", async () => {
    const { raw, db } = await setup();
    raw.prepare(`INSERT INTO alumni (id, email, full_name) VALUES ('a1', 'a@x.com', 'A'), ('a2', 'b@x.com', 'B')`).run();
    const { f } = fakeDiscord();
    await linkAlumnusDiscord(db, ENV, { id: "a1", full_name: "A" }, "c", "https://x", f);
    await linkAlumnusDiscord(db, ENV, { id: "a2", full_name: "B" }, "c", "https://x", f);
    expect(await getAlumniDiscord(db, "a1")).toBeNull();
    expect((await getAlumniDiscord(db, "a2"))?.discord_id).toBe("d42");
  });
});
