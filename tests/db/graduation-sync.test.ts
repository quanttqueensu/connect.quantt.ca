import { describe, expect, it } from "vitest";

import { syncAllGradYears, syncGradYear, type Graduation } from "@/lib/graduation-sync";

import { addMember, all, asD1, freshDb, run } from "./sqlite";

function fakeAuth(start: Record<string, Graduation>) {
  const store = { ...start };
  return {
    store,
    async graduation(email: string) { return store[email] ?? null; },
    async setGraduation(email: string, f: { gradYear?: number | null; personal?: string | null }) {
      const g = store[email]; if (!g) return null;
      store[email] = { ...g, ...("gradYear" in f ? { gradYear: f.gradYear ?? null } : {}), ...("personal" in f ? { personal: f.personal ?? null } : {}) };
      return store[email];
    },
  };
}

describe("grad year sync with auth.quantt.ca", () => {
  it("copies auth's grad year here, and sends a grad year only Connect has to auth", async () => {
    const raw = freshDb();
    const db = asD1(raw);
    const a = addMember(raw, { email: "a@queensu.ca" });
    const b = addMember(raw, { email: "b@queensu.ca" });
    run(raw, `UPDATE profiles SET grad_year = 2026 WHERE id = ?`, a);
    run(raw, `UPDATE profiles SET grad_year = 2027 WHERE id = ?`, b);
    const auth = fakeAuth({
      "a@queensu.ca": { id: "m_a", gradYear: 2028, personal: "a@gmail.com" },
      "b@queensu.ca": { id: "m_b", gradYear: null, personal: null },
    });
    const g = await syncGradYear(db, auth, a, "a@queensu.ca", 2026);
    expect(g?.personal).toBe("a@gmail.com");
    expect(all(raw, `SELECT grad_year FROM profiles WHERE id = ?`, a)[0]).toEqual({ grad_year: 2028 });
    expect(await syncAllGradYears(db, auth)).toMatchObject({ failed: 0 });
    expect(auth.store["b@queensu.ca"].gradYear).toBe(2027);
    // Someone not on auth's roster (e.g. already an alum) is left alone.
    expect(await syncGradYear(db, auth, a, "gone@queensu.ca", 2026)).toBeNull();
  });
});
