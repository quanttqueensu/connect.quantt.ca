import { describe, expect, it } from "vitest";

import {
  getPrefs,
  MESSAGE_QUIET_MINUTES,
  notifyApplicationStage,
  notifyNewApplication,
  notifyNewJob,
  notifyNewMessage,
  hasChosenPrefs,
  savePrefs,
  type Email,
} from "@/lib/notifications";

import { addCompany, addMember, all, asD1, freshDb, NOW, run, uuid } from "./sqlite";

function setup() {
  const raw = freshDb();
  const db = asD1(raw);
  const sent: Email[] = [];
  const send = async (emails: Email[]) => void sent.push(...emails);
  const member = addMember(raw, { email: "ann@queensu.ca" });
  const firm = addCompany(raw, "partner");
  const recruiter = all<{ email: string }>(raw, `SELECT email FROM profiles WHERE id = ?`, firm.userId)[0].email;
  const convo = uuid();
  run(raw, `INSERT INTO conversations (id, member_id, company_id) VALUES (?, ?, ?)`, convo, member, firm.companyId);
  const allOn = { messages: true, applications: true, application_updates: true, new_jobs: true };
  return { raw, db, sent, send, member, firm, recruiter, convo, allOn };
}

describe("notification settings", () => {
  it("defaults to everything off, and saves changes", async () => {
    const { db, member } = setup();
    expect(await getPrefs(db, member)).toEqual({ messages: false, applications: false, application_updates: false, new_jobs: false });
    await savePrefs(db, member, { messages: false, applications: true, application_updates: true, new_jobs: true });
    expect(await getPrefs(db, member)).toMatchObject({ messages: false, new_jobs: true });
  });
});

describe("message emails", () => {
  it("sends nothing until someone turns emails on", async () => {
    const { db, sent, send, member, firm, convo } = setup();
    await notifyNewMessage(db, send, convo, member, NOW);
    await notifyNewMessage(db, send, convo, firm.userId, NOW);
    expect(sent).toHaveLength(0);
  });

  it("emails the other side, without the message text, at most once per quiet period", async () => {
    const { db, sent, send, member, firm, recruiter, convo, allOn } = setup();
    await savePrefs(db, member, allOn);
    await savePrefs(db, firm.userId, allOn);
    await notifyNewMessage(db, send, convo, member, NOW);
    expect(sent.map((e) => e.to)).toEqual([recruiter]);
    expect(sent[0].text).toContain(`/company/messages/${convo}`);

    await notifyNewMessage(db, send, convo, member, new Date(NOW.getTime() + 60_000));
    expect(sent).toHaveLength(1);
    await notifyNewMessage(db, send, convo, member, new Date(NOW.getTime() + (MESSAGE_QUIET_MINUTES + 1) * 60_000));
    expect(sent).toHaveLength(2);

    await notifyNewMessage(db, send, convo, firm.userId, NOW);
    expect(sent[2]).toMatchObject({ to: "ann@queensu.ca" });
    expect(sent[2].text).toContain(`/messages/${convo}`);
  });

  it("sends nothing to someone who turned message emails off", async () => {
    const { db, sent, send, member, firm, convo, allOn } = setup();
    await savePrefs(db, member, { ...allOn, messages: false });
    await notifyNewMessage(db, send, convo, firm.userId, NOW);
    expect(sent).toHaveLength(0);
  });
});

describe("application and job emails", () => {
  it("tells the firm about an application and the member about a stage change", async () => {
    const { raw, db, sent, send, member, firm, recruiter, allOn } = setup();
    await savePrefs(db, member, allOn);
    await savePrefs(db, firm.userId, allOn);
    const post = uuid();
    run(raw, `INSERT INTO posts (id, author_id, company_id, kind, title, role_type, term_season, term_year) VALUES (?, ?, ?, 'job', 'Quant Intern', 'internship', 'summer', 2027)`, post, firm.userId, firm.companyId);
    await notifyNewApplication(db, send, post, "Ann");
    expect(sent[0]).toMatchObject({ to: recruiter, subject: "New application: Quant Intern" });

    const app = uuid();
    run(raw, `INSERT INTO applications (id, member_id, kind, post_id) VALUES (?, ?, 'in_app', ?)`, app, member, post);
    await notifyApplicationStage(db, send, app, "interviewing");
    expect(sent[1].to).toBe("ann@queensu.ca");
    expect(sent[1].text).toContain("Interviewing");
  });

  it("emails new jobs only to members who opted in", async () => {
    const { raw, db, sent, send, member, firm } = setup();
    addMember(raw, { email: "bob@queensu.ca" });
    const post = uuid();
    run(raw, `INSERT INTO posts (id, author_id, company_id, kind, title, external_url) VALUES (?, ?, ?, 'job_link', 'Analyst', 'https://x.test')`, post, firm.userId, firm.companyId);
    await notifyNewJob(db, send, post);
    expect(sent).toHaveLength(0);
    await savePrefs(db, member, { messages: true, applications: true, application_updates: true, new_jobs: true });
    await notifyNewJob(db, send, post);
    expect(sent.map((e) => e.to)).toEqual(["ann@queensu.ca"]);
  });
});

describe("notification setup step", () => {
  it("counts as chosen only once the person saves their settings, even all off", async () => {
    const raw = freshDb();
    const db = asD1(raw);
    const member = addMember(raw);
    expect(await hasChosenPrefs(db, member)).toBe(false);
    await savePrefs(db, member, { messages: false, applications: false, application_updates: false, new_jobs: false });
    expect(await hasChosenPrefs(db, member)).toBe(true);
  });
});
