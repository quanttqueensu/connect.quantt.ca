/**
 * Sends Connect's own alumni to auth.quantt.ca so its Alumni tab lists every
 * alum, not only members who graduated from its roster.
 *
 * "Own" means alumni accounts made here (an admin invited them under Admin ->
 * Alumni and they signed in) plus invites not accepted yet. Graduates
 * (alumni_graduation, including suspended ones) are left out: auth already
 * has them. Each send is the whole list, so a removal here shows up there too.
 * Runs from the hourly cron (worker.js) and right after an admin invites or
 * removes someone. Older auth Workers without setConnectAlumni are skipped.
 */
import type { D1Database } from "@/lib/db/d1";
import { ensureAlumniTables } from "@/lib/alumni/schema";

export type ConnectAlum = {
  id: string;
  email: string;
  name: string;
  status: "joined" | "invited";
  gradYear: number | null;
  firm: string | null;
  title: string | null;
  location: string | null;
  linkedin: string | null;
  discord: boolean;
  since: string;
};

export type AlumniPushAuth = { setConnectAlumni?(list: ConnectAlum[]): Promise<{ count: number }> };

export async function connectOnlyAlumni(db: D1Database): Promise<ConnectAlum[]> {
  await ensureAlumniTables(db);
  const joined = (
    await db
      .prepare(
        `SELECT a.id, a.email, a.full_name, a.grad_year, a.firm, a.title, a.location, a.linkedin_url, a.created_at,
                (SELECT 1 FROM alumni_discord d WHERE d.alumni_id = a.id) AS discord
           FROM alumni a
          WHERE NOT EXISTS (SELECT 1 FROM alumni_graduation g WHERE g.alumni_id = a.id)
          ORDER BY a.full_name`,
      )
      .all<{ id: string; email: string; full_name: string; grad_year: number | null; firm: string | null; title: string | null; location: string | null; linkedin_url: string | null; created_at: string; discord: number | null }>()
  ).results ?? [];
  const invited = (
    await db
      .prepare(
        `SELECT i.id, i.email, i.full_name, i.created_at FROM alumni_invites i
          WHERE i.accepted_at IS NULL AND NOT EXISTS (SELECT 1 FROM alumni a WHERE a.email = i.email)
          ORDER BY i.created_at DESC`,
      )
      .all<{ id: string; email: string; full_name: string; created_at: string }>()
  ).results ?? [];
  const out: ConnectAlum[] = joined.map((a) => ({
    id: a.id, email: a.email.toLowerCase(), name: a.full_name, status: "joined", gradYear: a.grad_year, firm: a.firm, title: a.title,
    location: a.location, linkedin: a.linkedin_url, discord: !!a.discord, since: a.created_at,
  }));
  const seen = new Set(out.map((a) => a.email));
  for (const i of invited) {
    const email = i.email.toLowerCase();
    if (seen.has(email)) continue; // invited twice: newest invite only
    seen.add(email);
    out.push({ id: i.id, email, name: i.full_name, status: "invited", gradYear: null, firm: null, title: null, location: null, linkedin: null, discord: false, since: i.created_at });
  }
  return out;
}

export async function pushConnectAlumni(db: D1Database, auth: AlumniPushAuth | undefined) {
  if (!auth?.setConnectAlumni) return null;
  return auth.setConnectAlumni(await connectOnlyAlumni(db));
}
