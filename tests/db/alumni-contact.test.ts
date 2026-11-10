import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { requestAlumniCode, verifyAlumniCode } from "@/lib/alumni/auth";
import { getAlumnus, inviteAlumnus, listAlumni, updateAlumnus } from "@/lib/alumni/data";
import { ALUMNI_ADDED_COLUMNS } from "@/lib/alumni/schema";

import { addMember, asD1, freshDb, NOW } from "./sqlite";

describe("alumni contact details", () => {
  it("matches db/migrations/0013_alumni_contact.sql", () => {
    const sql = readFileSync(resolve(__dirname, "../../db/migrations/0013_alumni_contact.sql"), "utf8");
    for (const stmt of ALUMNI_ADDED_COLUMNS) expect(sql).toContain(`${stmt};`);
  });

  it("keeps existing alumni, saves phone and other social, and never lists the phone to members", async () => {
    const raw = freshDb();
    const db = asD1(raw);
    const adminId = addMember(raw, { admin: true });
    await inviteAlumnus(db, "alum@example.com", "Alex Alum", adminId, NOW);
    let code = "";
    await requestAlumniCode(db, "alum@example.com", async (_to, c) => void (code = c), NOW);
    const res = await verifyAlumniCode(db, "alum@example.com", code, NOW);
    if (!res.ok) throw new Error(res.code);

    const before = await getAlumnus(db, res.alumniId);
    expect(before?.full_name).toBe("Alex Alum");
    expect(before?.phone).toBeNull();

    await updateAlumnus(db, { kind: "alumni", id: res.alumniId }, {
      full_name: "Alex Alum", grad_year: 2024, program: null, firm: "Example", title: null, location: null,
      linkedin_url: "https://www.linkedin.com/in/alex", other_social_url: "https://github.com/alex",
      phone: "+1 613 555 0100", bio: "Quant at Example.",
    });
    const after = await getAlumnus(db, res.alumniId);
    expect(after?.phone).toBe("+1 613 555 0100");

    const listed = (await listAlumni(db))[0] as Record<string, unknown>;
    expect(listed.other_social_url).toBe("https://github.com/alex");
    expect("phone" in listed).toBe(false);
  });
});
