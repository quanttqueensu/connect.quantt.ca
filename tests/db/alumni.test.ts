import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  canAlumniSignIn,
  createAlumniSession,
  endAlumniSession,
  readAlumniSession,
  requestAlumniCode,
  verifyAlumniCode,
} from "@/lib/alumni/auth";
import {
  closeAlumniPost,
  createAlumniPost,
  getThread,
  inviteAlumnus,
  listAlumniPosts,
  listConversations,
  markThreadRead,
  openConversation,
  removeAlumnus,
  sendThreadMessage,
  unreadCount,
} from "@/lib/alumni/data";
import { ALUMNI_SCHEMA } from "@/lib/alumni/schema";
import { readSession } from "@/lib/cf-auth/sessions";
import { notifyAlumniMessage, savePrefs, type Email } from "@/lib/notifications";

import { addCompany, addMember, all, asD1, freshDb, NOW } from "./sqlite";

const later = (min: number) => new Date(NOW.getTime() + min * 60_000);

let adminId = "";
function setupDb() {
  const raw = freshDb();
  adminId = addMember(raw, { admin: true });
  return { raw, db: asD1(raw) };
}

async function signIn(db: ReturnType<typeof asD1>, email: string, name = "Alex Alum") {
  await inviteAlumnus(db, email, name, adminId, NOW);
  let code = "";
  await requestAlumniCode(db, email, async (_to, c) => void (code = c), NOW);
  const res = await verifyAlumniCode(db, email, code, NOW);
  if (!res.ok) throw new Error(res.code);
  return res.alumniId;
}

describe("alumni schema", () => {
  it("matches db/migrations/0006_alumni.sql exactly", () => {
    const sql = readFileSync(resolve(__dirname, "../../db/migrations/0006_alumni.sql"), "utf8");
    for (const stmt of ALUMNI_SCHEMA) expect(sql).toContain(stmt.trim());
  });
});

describe("alumni sign-in", () => {
  it("only sends codes to invited or existing alumni, not members or sponsors", async () => {
    const { raw, db } = setupDb();
    addMember(raw, { email: "ann@queensu.ca" });
    const sent: string[] = [];
    const send = async (to: string) => void sent.push(to);
    await requestAlumniCode(db, "ann@queensu.ca", send, NOW);
    await requestAlumniCode(db, "nobody@firm.com", send, NOW);
    expect(sent).toEqual([]);
    await inviteAlumnus(db, "alex@firm.com", "Alex", adminId, NOW);
    expect(await canAlumniSignIn(db, "alex@firm.com")).toBe(true);
    await requestAlumniCode(db, "Alex@Firm.com", send, NOW);
    expect(sent).toEqual(["alex@firm.com"]);
  });

  it("creates the account from the invite and rejects a wrong or reused code", async () => {
    const { db } = setupDb();
    await inviteAlumnus(db, "alex@firm.com", "Alex Alum", adminId, NOW);
    let code = "";
    await requestAlumniCode(db, "alex@firm.com", async (_t, c) => void (code = c), NOW);
    const wrong = code === "000000" ? "111111" : "000000";
    expect(await verifyAlumniCode(db, "alex@firm.com", wrong, NOW)).toEqual({ ok: false, code: "login_code_invalid" });
    const ok = await verifyAlumniCode(db, "alex@firm.com", code, NOW);
    expect(ok.ok).toBe(true);
    expect(await verifyAlumniCode(db, "alex@firm.com", code, NOW)).toEqual({ ok: false, code: "login_code_invalid" });
    const rows = await db.prepare(`SELECT full_name FROM alumni WHERE email = ?`).bind("alex@firm.com").all<{ full_name: string }>();
    expect(rows.results).toEqual([{ full_name: "Alex Alum" }]);
  });

  it("uses its own session that the member/sponsor session never accepts", async () => {
    const { db } = setupDb();
    const id = await signIn(db, "alex@firm.com");
    const token = await createAlumniSession(db, id, NOW);
    expect((await readAlumniSession(db, token, NOW))?.id).toBe(id);
    expect(await readSession(db, token)).toBeNull();
    expect(await readAlumniSession(db, token, later(31 * 24 * 60))).toBeNull();
    const again = await createAlumniSession(db, id, NOW);
    await endAlumniSession(db, again);
    expect(await readAlumniSession(db, again, NOW)).toBeNull();
  });

  it("removing an alumnus ends their sessions", async () => {
    const { db } = setupDb();
    const id = await signIn(db, "alex@firm.com");
    const token = await createAlumniSession(db, id, NOW);
    await removeAlumnus(db, id);
    expect(await readAlumniSession(db, token, NOW)).toBeNull();
  });
});

describe("alumni posts", () => {
  it("lets alumni post and only the author close a post", async () => {
    const { raw, db } = setupDb();
    const a = await signIn(db, "a@firm.com", "A");
    const b = await signIn(db, "b@firm.com", "B");
    const post = { kind: "job" as const, title: "Analyst", body: "Apply by Friday", firm: "Firm", location: "Toronto", external_url: null };
    const id = await createAlumniPost(db, { kind: "alumni", id: a }, post, NOW);
    expect(id).toBeTruthy();
    await expect(createAlumniPost(db, { kind: "member", id: addMember(raw) }, post, NOW)).rejects.toThrow();
    expect(await closeAlumniPost(db, { kind: "alumni", id: b }, id as string)).toBe(false);
    expect((await listAlumniPosts(db)).map((p) => p.id)).toEqual([id]);
    expect(await closeAlumniPost(db, { kind: "alumni", id: a }, id as string)).toBe(true);
    expect(await listAlumniPosts(db)).toEqual([]);
  });
});

describe("alumni messages", () => {
  it("lets members and alumni message, and keeps others out of the thread", async () => {
    const { raw, db } = setupDb();
    const alum = await signIn(db, "alex@firm.com");
    const other = await signIn(db, "sam@firm.com", "Sam");
    const ann = addMember(raw, { email: "ann@queensu.ca" });
    const bob = addMember(raw, { email: "bob@queensu.ca" });
    const firm = addCompany(raw, "partner");

    expect(await openConversation(db, { kind: "alumni", id: alum }, firm.userId, NOW)).toBeNull();
    const convo = await openConversation(db, { kind: "member", id: ann }, alum, NOW);
    expect(convo).toBeTruthy();
    expect(await openConversation(db, { kind: "alumni", id: alum }, ann, NOW)).toBe(convo);

    expect(await sendThreadMessage(db, { kind: "member", id: ann }, convo!, "Hi Alex", NOW)).toBe(true);
    expect(await sendThreadMessage(db, { kind: "member", id: bob }, convo!, "sneaky", NOW)).toBe(false);
    expect(await sendThreadMessage(db, { kind: "alumni", id: other }, convo!, "sneaky", NOW)).toBe(false);
    expect(await getThread(db, { kind: "member", id: bob }, convo!)).toBeNull();
    expect(await getThread(db, { kind: "alumni", id: other }, convo!)).toBeNull();

    expect(await unreadCount(db, { kind: "alumni", id: alum })).toBe(1);
    expect(await unreadCount(db, { kind: "member", id: ann })).toBe(0);
    await markThreadRead(db, { kind: "alumni", id: alum }, convo!, later(1));
    expect(await unreadCount(db, { kind: "alumni", id: alum })).toBe(0);
    await sendThreadMessage(db, { kind: "alumni", id: alum }, convo!, "Hey Ann", later(2));
    const [summary] = await listConversations(db, { kind: "member", id: ann });
    expect(summary).toMatchObject({ id: convo, other_id: alum, unread: true });
    const thread = await getThread(db, { kind: "member", id: ann }, convo!);
    expect(thread?.messages.map((m) => [m.sender, m.body])).toEqual([["member", "Hi Alex"], ["alumni", "Hey Ann"]]);
    expect(all(raw, `SELECT count(*) AS n FROM messages`)).toEqual([{ n: 0 }]);
  });
});

describe("alumni message emails", () => {
  it("follows each side's setting and is off until turned on", async () => {
    const { raw, db } = setupDb();
    const alum = await signIn(db, "alex@firm.com");
    const ann = addMember(raw, { email: "ann@queensu.ca" });
    const convo = (await openConversation(db, { kind: "member", id: ann }, alum, NOW))!;
    const sent: Email[] = [];
    const send = async (e: Email[]) => void sent.push(...e);

    await notifyAlumniMessage(db, send, convo, "alumni", NOW);
    await notifyAlumniMessage(db, send, convo, "member", NOW);
    expect(sent).toHaveLength(0);

    await savePrefs(db, ann, { messages: true, applications: false, application_updates: false, new_jobs: false });
    await db.prepare(`UPDATE alumni SET email_messages = 1 WHERE id = ?`).bind(alum).run();
    await notifyAlumniMessage(db, send, convo, "alumni", NOW);
    await notifyAlumniMessage(db, send, convo, "member", NOW);
    await notifyAlumniMessage(db, send, convo, "member", later(1));
    expect(sent.map((e) => e.to)).toEqual(["ann@queensu.ca", "alex@firm.com"]);
  });
});
