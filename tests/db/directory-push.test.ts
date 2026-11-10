import { describe, expect, it } from "vitest";

import { connectOnlyAlumni, pushConnectAlumni, type ConnectAlum } from "@/lib/alumni/directory-push";
import { syncGraduates, type AuthAlum } from "@/lib/alumni/graduates";

import { asD1, freshDb, NOW, run } from "./sqlite";

const files = { async get() { return null; }, async head() { return null; }, async put() {}, async delete() {} };

describe("connect alumni sent to auth.quantt.ca", () => {
  it("lists joined and invited alumni, never graduates, and replaces the list each time", async () => {
    const raw = freshDb();
    const db = asD1(raw);
    // A graduate from auth's roster (auth already lists them).
    const grad: AuthAlum = { id: "m_ann", name: "Ann Lee", team: null, gradYear: 2027, personal: "ann@gmail.com", emails: ["ann@queensu.ca"], graduated: NOW.toISOString(), discord: null, files: { photo: null, resume: null } };
    await syncGraduates(db, files, { async alumni() { return [grad]; } }, async () => {}, NOW);
    // Invited on Connect and joined.
    run(raw, `INSERT INTO alumni (id, email, full_name, grad_year, firm, title, linkedin_url, created_at) VALUES ('11111111-1111-4111-8111-111111111111', 'Jan@Gmail.com', 'Jan Karcz', 2024, 'Citadel', 'Quant', 'https://linkedin.com/in/jan', '2026-11-10T01:00:00Z')`);
    run(raw, `INSERT INTO alumni_invites (id, email, full_name, accepted_at, created_at) VALUES ('i-jan', 'jan@gmail.com', 'Jan Karcz', '2026-11-10T01:00:00Z', '2026-11-09T00:00:00Z')`);
    run(raw, `INSERT INTO alumni_discord (alumni_id, discord_id, username) VALUES ('11111111-1111-4111-8111-111111111111', '42', 'jan')`);
    // Invited, not joined yet (twice).
    run(raw, `INSERT INTO alumni_invites (id, email, full_name, created_at) VALUES ('i-ben1', 'ben@gmail.com', 'Ben', '2026-11-08T00:00:00Z')`);
    run(raw, `INSERT INTO alumni_invites (id, email, full_name, created_at) VALUES ('i-ben2', 'ben@gmail.com', 'Ben McKeon', '2026-11-09T00:00:00Z')`);

    const list = await connectOnlyAlumni(db);
    expect(list.map((a) => [a.name, a.email, a.status, a.discord])).toEqual([
      ["Jan Karcz", "jan@gmail.com", "joined", true],
      ["Ben McKeon", "ben@gmail.com", "invited", false],
    ]);
    expect(list[0]).toMatchObject({ gradYear: 2024, firm: "Citadel", title: "Quant", linkedin: "https://linkedin.com/in/jan" });

    let sent: ConnectAlum[] = [];
    const auth = { async setConnectAlumni(l: ConnectAlum[]) { sent = l; return { count: l.length }; } };
    expect(await pushConnectAlumni(db, auth)).toEqual({ count: 2 });
    expect(sent.map((a) => a.name)).toEqual(["Jan Karcz", "Ben McKeon"]);
    run(raw, `DELETE FROM alumni_invites WHERE email = 'ben@gmail.com'`);
    await pushConnectAlumni(db, auth);
    expect(sent.map((a) => a.name)).toEqual(["Jan Karcz"]);
    // An older auth Worker without the call: nothing sent, no error.
    expect(await pushConnectAlumni(db, {})).toBeNull();
    expect(await pushConnectAlumni(db, undefined)).toBeNull();
  });
});
