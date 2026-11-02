/**
 * The Supabase-shaped query layer on D1, driven with the same calls the
 * app's pages and actions make today.
 */
import { describe, expect, it } from "vitest";

import { createHubClient } from "@/lib/db/client";
import type { Principal } from "@/lib/db/rest";
import { TABLES } from "@/lib/db/schema";
import { verifyFileLink, type R2BucketLike } from "@/lib/db/storage";

import {
  addApplication,
  addCompany,
  addMember,
  addPost,
  addResume,
  all,
  asD1,
  freshDb,
  hoursAgo,
  run,
  TIER,
  uuid,
  viewer,
} from "./sqlite";

function memoryR2(): R2BucketLike & { keys(): string[] } {
  const store = new Map<string, { bytes: ArrayBuffer; type?: string }>();
  return {
    keys: () => [...store.keys()].sort(),
    async get(key) {
      const o = store.get(key);
      if (!o) return null;
      return {
        arrayBuffer: async () => o.bytes,
        body: new Blob([o.bytes]).stream(),
        httpMetadata: { contentType: o.type },
        size: o.bytes.byteLength,
      };
    },
    async head(key) {
      const o = store.get(key);
      return o ? { size: o.bytes.byteLength } : null;
    },
    async put(key, value, options) {
      const bytes = value instanceof ArrayBuffer ? value : await new Response(value as BodyInit).arrayBuffer();
      store.set(key, { bytes, type: options?.httpMetadata?.contentType });
    },
    async delete(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    },
  };
}

function setup() {
  const raw = freshDb();
  const db = asD1(raw);
  const files = memoryR2();
  const as = (principal: Principal) =>
    createHubClient({ db, files, principal, fileLinks: { secret: "test-secret", siteUrl: "https://connect.test" } });
  const user = (id: string) => as({ kind: "user", viewer: viewer(raw, id, new Date()) });
  return { raw, db, files, as, user, service: as({ kind: "service" }), anon: as({ kind: "anon" }) };
}

describe("schema metadata", () => {
  it("matches the D1 tables column for column", () => {
    const raw = freshDb();
    for (const [table, info] of Object.entries(TABLES)) {
      const cols = all<{ name: string }>(raw, `PRAGMA table_info(${table})`).map((c) => c.name);
      expect(cols.sort(), table).toEqual([...info.columns].sort());
    }
  });
});

describe("reads", () => {
  it("returns booleans and JSON as the app expects", async () => {
    const { raw, user, service } = setup();
    const admin = addMember(raw, { admin: true });
    run(raw, `INSERT INTO sponsor_tier_events (id, kind, detail) VALUES (?, 'tier_created', '{"a":1}')`, uuid());
    const { data: me } = await user(admin).from("profiles").select("*").eq("id", admin).maybeSingle();
    expect(me).toMatchObject({ id: admin, is_admin: true, resume_book_opt_in: false });
    const { data: events } = await service.from("sponsor_tier_events").select("kind, detail");
    expect(events).toEqual([{ kind: "tier_created", detail: { a: 1 } }]);
  });

  it("embeds to-one and to-many rows, with nested hints", async () => {
    const { raw, user } = setup();
    const member = addMember(raw);
    const firm = addCompany(raw, "partner");
    const post = addPost(raw, firm.companyId, firm.userId, { kind: "announcement" });
    const { data } = await user(member)
      .from("posts")
      .select("*, companies(*, sponsor_tiers!sponsor_tier_id(id, name, rank, key))")
      .eq("id", post)
      .maybeSingle();
    const row = data as { companies: { id: string; sponsor_tiers: { key: string; rank: number } } };
    expect(row.companies.id).toBe(firm.companyId);
    expect(row.companies.sponsor_tiers).toEqual({ id: TIER.partner, name: "Partner", rank: 20, key: "partner" });

    const { data: tiers } = await user(member).from("sponsor_tiers").select("*, sponsor_tier_capabilities(*)").eq("key", "supporter");
    expect((tiers as { sponsor_tier_capabilities: unknown[] }[])[0].sponsor_tier_capabilities).toHaveLength(4);
  });

  it("filters through an inner embed before paging (sponsor-only feed)", async () => {
    const { raw, user } = setup();
    const member = addMember(raw);
    const none = addCompany(raw, "none");
    const partner = addCompany(raw, "partner");
    addPost(raw, none.companyId, none.userId, { kind: "announcement" });
    const sponsored = addPost(raw, partner.companyId, partner.userId, { kind: "announcement" });
    const { data, error } = await user(member)
      .from("posts")
      .select("*, companies!inner(*, sponsor_tiers!sponsor_tier_id!inner(id, name, rank, key))")
      .eq("published", true)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .range(0, 0)
      .gt("companies.sponsor_tiers!sponsor_tier_id.rank", 0);
    expect(error).toBeNull();
    expect((data as { id: string }[]).map((p) => p.id)).toEqual([sponsored]);
  });

  it("orders and limits an embedded table (latest message per conversation)", async () => {
    const { raw, user } = setup();
    const member = addMember(raw);
    const firm = addCompany(raw, "partner");
    const conv = uuid();
    run(raw, `INSERT INTO conversations (id, member_id, company_id) VALUES (?, ?, ?)`, conv, member, firm.companyId);
    run(raw, `INSERT INTO messages (id, conversation_id, sender_id, body, created_at) VALUES (?, ?, ?, 'old', ?)`, uuid(), conv, member, hoursAgo(5));
    run(raw, `INSERT INTO messages (id, conversation_id, sender_id, body, created_at) VALUES (?, ?, ?, 'new', ?)`, uuid(), conv, member, hoursAgo(1));
    const { data } = await user(member)
      .from("conversations")
      .select("*, companies(name), messages(created_at)")
      .eq("member_id", member)
      .order("created_at", { referencedTable: "messages", ascending: false })
      .limit(1, { referencedTable: "messages" });
    const row = (data as { messages: { created_at: string }[]; companies: { name: string } }[])[0];
    expect(row.messages).toEqual([{ created_at: hoursAgo(1) }]);
    expect(row.companies.name).toMatch(/^Firm/);
  });

  it("hides embedded rows the viewer may not see", async () => {
    const { raw, user } = setup();
    const member = addMember(raw);
    const firm = addCompany(raw, "partner");
    const other = addCompany(raw, "partner");
    const post = addPost(raw, firm.companyId, firm.userId);
    addApplication(raw, member, post, hoursAgo(1));
    const { data } = await user(member).from("applications").select("*, posts(title), profiles(full_name)");
    expect((data as { profiles: unknown }[])[0].profiles).not.toBeNull();
    const otherApps = await user(other.userId).from("applications").select("*");
    expect(otherApps.data).toEqual([]);
    const otherView = await user(other.userId).from("posts").select("*").eq("id", post);
    expect(otherView.data).toEqual([]);
  });

  it("counts with head, and supports or/ilike/is/in", async () => {
    const { raw, user } = setup();
    const a = addMember(raw);
    addMember(raw);
    run(raw, `UPDATE profiles SET program = 'Commerce' WHERE id = ?`, a);
    const c = user(a);
    const { count, data } = await c.from("profiles").select("*", { count: "exact", head: true }).eq("role", "member");
    expect(count).toBe(2);
    expect(data).toBeNull();
    const term = "comm";
    const { data: found } = await c.from("profiles").select("id").or(`full_name.ilike.*${term}*,program.ilike.*${term}*`);
    expect(found).toEqual([{ id: a }]);
    expect((await c.from("profiles").select("id").ilike("program", "%MERCE")).data).toEqual([{ id: a }]);
    expect((await c.from("profiles").select("id").is("photo_path", null)).data).toHaveLength(2);
    expect((await c.from("profiles").select("id").in("id", [a])).data).toEqual([{ id: a }]);
  });

  it("single() errors on no rows; maybeSingle() returns null", async () => {
    const { raw, user } = setup();
    const m = addMember(raw);
    const none = await user(m).from("posts").select("*").eq("id", uuid()).single();
    expect(none.error?.code).toBe("PGRST116");
    const maybe = await user(m).from("posts").select("*").eq("id", uuid()).maybeSingle();
    expect(maybe).toMatchObject({ data: null, error: null });
  });

  it("rejects unknown columns instead of guessing", async () => {
    const { raw, user } = setup();
    const m = addMember(raw);
    const { error } = await user(m).from("profiles").select("nope");
    expect(error?.code).toBe("PGRST100");
  });

  it("a signed-out visitor reads nothing", async () => {
    const { raw, anon } = setup();
    const firm = addCompany(raw, "partner");
    addPost(raw, firm.companyId, firm.userId, { kind: "announcement" });
    expect((await anon.from("posts").select("*")).data).toEqual([]);
  });
});

describe("writes", () => {
  it("inserts and returns the row", async () => {
    const { raw, user } = setup();
    const firm = addCompany(raw, "partner");
    const { data, error } = await user(firm.userId)
      .from("posts")
      .insert({ author_id: firm.userId, company_id: firm.companyId, kind: "announcement", title: "Hi", body: "x" })
      .select("id, kind, published")
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ kind: "announcement", published: true });
  });

  it("refuses an insert the policies forbid with 42501", async () => {
    const { raw, user } = setup();
    const firm = addCompany(raw, "partner");
    const { error } = await user(firm.userId)
      .from("posts")
      .insert({ author_id: firm.userId, company_id: firm.companyId, kind: "event", title: "Event", body: "" });
    expect(error?.code).toBe("42501");
    expect(all(raw, `SELECT count(*) AS n FROM posts`)[0].n).toBe(0);
  });

  it("enforces the in-app job quota through the query layer", async () => {
    const { raw, user } = setup();
    const firm = addCompany(raw, "supporter");
    const job = { author_id: firm.userId, company_id: firm.companyId, kind: "job", title: "Analyst", role_type: "internship", term_season: "summer", term_year: 2027 };
    expect((await user(firm.userId).from("posts").insert(job)).error).toBeNull();
    const second = await user(firm.userId).from("posts").insert(job);
    expect(second.error?.message).toMatch(/open in-app job limit/);
  });

  it("silently skips rows outside the update scope", async () => {
    const { raw, user } = setup();
    const a = addMember(raw);
    const b = addMember(raw);
    const { error, data } = await user(a).from("profiles").update({ bio: "hacked" }).eq("id", b).select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(all(raw, `SELECT bio FROM profiles WHERE id = ?`, b)[0].bio).toBeNull();
  });

  it("strips privileged fields on a member's own update", async () => {
    const { raw, user } = setup();
    const a = addMember(raw);
    await user(a).from("profiles").update({ is_admin: true, full_name: "New" }).eq("id", a);
    expect(all(raw, `SELECT is_admin, full_name FROM profiles WHERE id = ?`, a)[0]).toEqual({ is_admin: 0, full_name: "New" });
  });

  it("upserts member documents on member_id", async () => {
    const { raw, user } = setup();
    const m = addMember(raw);
    const path = `${m}/packages/${"a".repeat(8)}/resume.pdf`;
    const first = await user(m).from("member_documents").upsert({ member_id: m, resume_path: path }, { onConflict: "member_id" }).select("member_id");
    expect(first.error).toBeNull();
    expect(first.data).toEqual([{ member_id: m }]);
    const cover = `${m}/packages/${"b".repeat(8)}/cover.pdf`;
    await user(m).from("member_documents").upsert({ member_id: m, cover_letter_path: cover }, { onConflict: "member_id" });
    expect(all(raw, `SELECT resume_path, cover_letter_path FROM member_documents`)).toEqual([{ resume_path: path, cover_letter_path: cover }]);
    const bad = await user(m).from("member_documents").upsert({ member_id: m, resume_path: `${uuid()}/x.pdf` }, { onConflict: "member_id" });
    expect(bad.error?.code).toBe("42501");
  });

  it("lets a firm move a visible applicant's stage, and nothing else", async () => {
    const { raw, user } = setup();
    const member = addMember(raw);
    const firm = addCompany(raw, "principal");
    const app = addApplication(raw, member, addPost(raw, firm.companyId, firm.userId), hoursAgo(1));
    const moved = await user(firm.userId).from("applications").update({ stage: "interviewing" }).eq("id", app).select("stage");
    expect(moved.data).toEqual([{ stage: "interviewing" }]);
    const notes = await user(firm.userId).from("applications").update({ notes: "x" }).eq("id", app);
    expect(notes.error?.code).toBe("42501");
  });

  it("deletes only what the policies allow", async () => {
    const { raw, user } = setup();
    const m = addMember(raw);
    const other = addMember(raw);
    const firm = addCompany(raw, "partner");
    const post = addPost(raw, firm.companyId, firm.userId, { kind: "announcement" });
    const mine = uuid();
    const theirs = uuid();
    run(raw, `INSERT INTO post_comments (id, post_id, author_id, body) VALUES (?, ?, ?, 'a')`, mine, post, m);
    run(raw, `INSERT INTO post_comments (id, post_id, author_id, body) VALUES (?, ?, ?, 'b')`, theirs, post, other);
    await user(m).from("post_comments").delete().eq("post_id", post);
    expect(all(raw, `SELECT id FROM post_comments`).map((r) => r.id)).toEqual([theirs]);
    await user(firm.userId).from("posts").delete().eq("id", post);
    expect(all(raw, `SELECT count(*) AS n FROM posts`)[0].n).toBe(1);
  });

  it("applies through the query layer with the job and snapshot checks", async () => {
    const { raw, user } = setup();
    const member = addMember(raw);
    const firm = addCompany(raw, "partner");
    const post = addPost(raw, firm.companyId, firm.userId);
    const id = uuid();
    const { error } = await user(member).from("applications").insert({
      id, member_id: member, kind: "in_app", post_id: post, resume_path: `snapshots/${id}/resume.pdf`, stage: "submitted",
    });
    expect(error).toBeNull();
    expect(all(raw, `SELECT company_id FROM applications WHERE id = ?`, id)[0].company_id).toBe(firm.companyId);
    const dup = await user(member).from("applications").insert({
      id: uuid(), member_id: member, kind: "in_app", post_id: post, resume_path: `snapshots/x/resume.pdf`,
    });
    expect(dup.error).not.toBeNull();
  });

  it("maps unique violations to 23505", async () => {
    const { raw, service } = setup();
    addMember(raw);
    const { error } = await service.from("sponsor_tiers").insert({ key: "partner", name: "Dup", rank: 99 });
    expect(error?.code).toBe("23505");
    expect(error?.message).toMatch(/key/);
  });
});

describe("rpc", () => {
  it("lists the resume book for a firm that has it", async () => {
    const { raw, user } = setup();
    const firm = addCompany(raw, "principal");
    const m = addMember(raw, { optInAt: hoursAgo(1) });
    addResume(raw, m);
    const { data } = await user(firm.userId).rpc("resume_book_list", { p_program: null, p_grad_year: null });
    expect((data as { id: string }[]).map((r) => r.id)).toEqual([m]);
    const path = await user(firm.userId).rpc("talent_resume_path", { p_member: m });
    expect(path.data).toBe(`${m}/packages/main/resume.pdf`);
    const none = addCompany(raw, "none");
    expect((await user(none.userId).rpc("talent_resume_path", { p_member: m })).data).toBeNull();
  });

  it("closes only your own post", async () => {
    const { raw, user } = setup();
    const a = addCompany(raw, "partner");
    const b = addCompany(raw, "partner");
    const post = addPost(raw, a.companyId, a.userId, { kind: "announcement" });
    expect((await user(b.userId).rpc("close_own_post", { p_post: post })).data).toBeNull();
    expect((await user(a.userId).rpc("close_own_post", { p_post: post })).data).toBe(post);
    expect(all(raw, `SELECT status FROM posts`)[0].status).toBe("closed");
  });

  it("takes join requests, rate-limited per source", async () => {
    const { raw, service } = setup();
    const source = "a".repeat(64);
    for (let i = 0; i < 7; i++) {
      const r = await service.rpc("submit_join_request", {
        p_company_name: `Firm ${i}`, p_website: null, p_contact_name: "Ann", p_contact_email: `ann${i}@firm${i}.com`, p_note: null, p_source: source,
      });
      expect(r.error).toBeNull();
    }
    expect(all(raw, `SELECT count(*) AS n FROM company_join_requests`)[0].n).toBe(5);
    const bad = await service.rpc("submit_join_request", { p_company_name: "", p_contact_name: "A", p_contact_email: "a@b.co", p_source: source });
    expect(bad.error).not.toBeNull();
  });
});

describe("storage", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7 test");

  it("members upload under their own folder only", async () => {
    const { raw, user, files } = setup();
    const m = addMember(raw);
    const ok = await user(m).storage.from("resumes").upload(`${m}/packages/main/resume.pdf`, pdf, { contentType: "application/pdf" });
    expect(ok.error).toBeNull();
    const bad = await user(m).storage.from("resumes").upload(`${uuid()}/packages/main/resume.pdf`, pdf, { contentType: "application/pdf" });
    expect(bad.error).not.toBeNull();
    const wrongType = await user(m).storage.from("resumes").upload(`${m}/packages/b/resume.pdf`, pdf, { contentType: "text/html" });
    expect(wrongType.error).not.toBeNull();
    expect(files.keys()).toEqual([`resumes/${m}/packages/main/resume.pdf`]);
  });

  it("refuses to overwrite without upsert", async () => {
    const { raw, user } = setup();
    const m = addMember(raw);
    const path = `${m}/photo.png`;
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    await user(m).storage.from("photos").upload(path, png, { contentType: "image/png" });
    expect((await user(m).storage.from("photos").upload(path, png, { contentType: "image/png" })).error?.statusCode).toBe("409");
    expect((await user(m).storage.from("photos").upload(path, png, { contentType: "image/png", upsert: true })).error).toBeNull();
  });

  it("signs links that verify, expire and can't be altered", async () => {
    const { raw, service } = setup();
    const m = addMember(raw);
    const path = `${m}/packages/main/resume.pdf`;
    await service.storage.from("resumes").upload(path, pdf, { contentType: "application/pdf" });
    const { data } = await service.storage.from("resumes").createSignedUrl(path, 60, { download: true });
    const url = new URL(data!.signedUrl);
    expect(url.origin).toBe("https://connect.test");
    expect(await verifyFileLink("test-secret", url)).toMatchObject({ key: `resumes/${path}`, download: true });
    expect(await verifyFileLink("other-secret", url)).toBeNull();
    const tampered = new URL(url);
    tampered.pathname = tampered.pathname.replace("resume.pdf", "cover.pdf");
    expect(await verifyFileLink("test-secret", tampered)).toBeNull();
    expect(await verifyFileLink("test-secret", url, new Date(Date.now() + 120_000))).toBeNull();
  });

  it("downloads and removes with the service key", async () => {
    const { raw, service, files } = setup();
    const m = addMember(raw);
    const path = `${m}/packages/main/resume.pdf`;
    await service.storage.from("resumes").upload(path, pdf, { contentType: "application/pdf" });
    const { data } = await service.storage.from("resumes").download(path);
    expect(new TextDecoder().decode(await data!.arrayBuffer())).toBe("%PDF-1.7 test");
    await service.storage.from("resumes").remove([path]);
    expect(files.keys()).toEqual([]);
  });
});

