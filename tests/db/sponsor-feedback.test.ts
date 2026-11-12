import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { Email } from "@/lib/notifications";
import {
  countOpenFeedback,
  listAllFeedback,
  listCompanyFeedback,
  MAX_FEEDBACK_PER_DAY,
  notifyNewFeedback,
  setFeedbackStatus,
  setWatchingFeedback,
  SPONSOR_FEEDBACK_SCHEMA,
  ALUMNI_FEEDBACK_SCHEMA,
  listAlumniFeedback,
  submitAlumniFeedback,
  submitFeedback,
} from "@/lib/sponsor-feedback";

import { addCompany, addMember, asD1, freshDb, NOW, run } from "./sqlite";

function setup() {
  const raw = freshDb();
  const db = asD1(raw);
  const sent: Email[] = [];
  const send = async (emails: Email[]) => void sent.push(...emails);
  const a = addCompany(raw, "partner");
  const b = addCompany(raw, "leader");
  const admin = addMember(raw, { admin: true, email: "exec@queensu.ca" });
  const member = addMember(raw, { email: "ann@queensu.ca" });
  return { raw, db, sent, send, a, b, admin, member };
}

describe("sponsor feedback", () => {
  it("matches db/migrations/0015_sponsor_feedback.sql", () => {
    const sql = readFileSync(resolve(__dirname, "../../db/migrations/0015_sponsor_feedback.sql"), "utf8");
    for (const stmt of SPONSOR_FEEDBACK_SCHEMA) expect(sql).toContain(stmt.trim());
  });

  it("each firm sees only its own; admins see all, open first", async () => {
    const { db, a, b } = setup();
    const r1 = await submitFeedback(db, { companyId: a.companyId, profileId: a.userId, kind: "request", body: " More resumes " }, NOW);
    await submitFeedback(db, { companyId: b.companyId, profileId: b.userId, kind: "problem", body: "Login slow" }, NOW);
    expect(r1.ok).toBe(true);
    const mine = await listCompanyFeedback(db, a.companyId);
    expect(mine.map((f) => f.body)).toEqual(["More resumes"]);
    expect(await countOpenFeedback(db)).toBe(2);
    expect((await listAllFeedback(db, "open")).map((f) => f.body)).toEqual(["More resumes", "Login slow"]);
  });

  it("refuses empty text and caps a firm per day", async () => {
    const { db, a } = setup();
    expect(await submitFeedback(db, { companyId: a.companyId, profileId: a.userId, kind: "feedback", body: "  " }, NOW)).toEqual({
      ok: false,
      code: "feedback_empty",
    });
    for (let i = 0; i < MAX_FEEDBACK_PER_DAY; i++)
      await submitFeedback(db, { companyId: a.companyId, profileId: a.userId, kind: "feedback", body: `n${i}` }, NOW);
    expect(await submitFeedback(db, { companyId: a.companyId, profileId: a.userId, kind: "feedback", body: "one more" }, NOW)).toEqual({
      ok: false,
      code: "feedback_limit",
    });
  });

  it("mark done and reopen", async () => {
    const { db, a, admin } = setup();
    const r = await submitFeedback(db, { companyId: a.companyId, profileId: a.userId, kind: "request", body: "x" }, NOW);
    if (!r.ok) throw new Error();
    await setFeedbackStatus(db, r.id, "done", admin, NOW);
    expect(await countOpenFeedback(db)).toBe(0);
    const [done] = await listAllFeedback(db, "done");
    expect(done.resolved_by_name).toBeTruthy();
    await setFeedbackStatus(db, r.id, "open", admin, NOW);
    expect(await countOpenFeedback(db)).toBe(1);
  });

  it("emails only admins who turned it on, never members or sponsors", async () => {
    const { raw, db, sent, send, a, admin, member } = setup();
    const r = await submitFeedback(db, { companyId: a.companyId, profileId: a.userId, kind: "request", body: "Please add <b>x</b>" }, NOW);
    if (!r.ok) throw new Error();
    await notifyNewFeedback(db, send, r.id);
    expect(sent).toHaveLength(0);

    await setWatchingFeedback(db, admin, true);
    await setWatchingFeedback(db, member, true); // not an admin: ignored
    await setWatchingFeedback(db, a.userId, true); // a sponsor: ignored
    await notifyNewFeedback(db, send, r.id);
    expect(sent.map((e) => e.to)).toEqual(["exec@queensu.ca"]);
    expect(sent[0].text).toContain("Please add <b>x</b>");
    expect(sent[0].html).not.toContain("<b>x</b>");

    sent.length = 0;
    run(raw, `UPDATE profiles SET is_admin = 0 WHERE id = ?`, admin);
    await notifyNewFeedback(db, send, r.id);
    expect(sent).toHaveLength(0);

    run(raw, `UPDATE profiles SET is_admin = 1 WHERE id = ?`, admin);
    await setWatchingFeedback(db, admin, false);
    await notifyNewFeedback(db, send, r.id);
    expect(sent).toHaveLength(0);
  });

  it("matches db/migrations/0016_alumni_feedback.sql", () => {
    const sql = readFileSync(resolve(__dirname, "../../db/migrations/0016_alumni_feedback.sql"), "utf8");
    for (const stmt of ALUMNI_FEEDBACK_SCHEMA) expect(sql).toContain(stmt.trim());
  });

  it("alumni feedback lands in the same admin inbox, and only the alum sees their own", async () => {
    const { raw, db, sent, send, a, admin } = setup();
    run(raw, `INSERT INTO alumni (id, email, full_name, firm) VALUES ('al1', 'sam@gmail.com', 'Sam Lee', 'Jane Street')`);
    run(raw, `INSERT INTO alumni (id, email, full_name) VALUES ('al2', 'kim@gmail.com', 'Kim Park')`);
    await submitFeedback(db, { companyId: a.companyId, profileId: a.userId, kind: "request", body: "sponsor ask" }, NOW);
    const r = await submitAlumniFeedback(db, { alumniId: "al1", kind: "feedback", body: "alum note" }, new Date(NOW.getTime() + 1000));
    if (!r.ok) throw new Error();
    expect((await listAlumniFeedback(db, "al1")).map((f) => f.body)).toEqual(["alum note"]);
    expect(await listAlumniFeedback(db, "al2")).toEqual([]);
    const open = await listAllFeedback(db, "open");
    expect(open.map((f) => [f.source, f.company_name, f.body])).toEqual([
      ["sponsor", expect.any(String), "sponsor ask"],
      ["alum", "Alumni · Jane Street", "alum note"],
    ]);
    expect(await countOpenFeedback(db)).toBe(2);
    await setFeedbackStatus(db, r.id, "done", admin, NOW);
    expect(await countOpenFeedback(db)).toBe(1);

    await setWatchingFeedback(db, admin, true);
    await notifyNewFeedback(db, send, r.id, "alum");
    expect(sent.map((e) => e.to)).toEqual(["exec@queensu.ca"]);
    expect(sent[0].subject).toBe("Alum feedback from Sam Lee");
  });
});
