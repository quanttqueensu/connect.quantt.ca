/**
 * Approving a company join request (Admin → Companies), in three steps so a
 * double click or two admins at once make one firm, not two:
 *
 *  1. Claim the pending request: one UPDATE that only succeeds while it is
 *     still pending and unclaimed (reviewed_at is the claim; a pending row
 *     otherwise never has one). A claim older than CLAIM_MINUTES is treated as
 *     abandoned.
 *  2. One batch: the company, the contact's invite (skipped when they already
 *     have an account or a pending invite), and status = 'approved'.
 *  3. If the batch fails, the claim is released so the request can be tried again.
 *
 * The invite email is sent by the caller afterwards (lib/actions/admin.ts).
 */
import type { D1Database } from "@/lib/db/d1";

const CLAIM_MINUTES = 10;

export type JoinApproval =
  | { ok: true; email: string; name: string; companyId: string; registered: boolean }
  | { ok: false; code: "join_request_review_race" | "join_request_review_failed" };

/** Same as slugify in lib/actions/admin.ts. */
function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48) || "company";
}

export async function approveJoinRequest(
  db: D1Database,
  opts: { id: string; adminId: string; tierId: string; now?: Date },
): Promise<JoinApproval> {
  const now = opts.now ?? new Date();
  const at = now.toISOString();
  const stale = new Date(now.getTime() - CLAIM_MINUTES * 60_000).toISOString();
  const req = await db
    .prepare(
      `UPDATE company_join_requests SET reviewed_by = ?, reviewed_at = ?
        WHERE id = ? AND status = 'pending' AND (reviewed_at IS NULL OR reviewed_at < ?)
       RETURNING company_name, contact_name, contact_email, website`,
    )
    .bind(opts.adminId, at, opts.id, stale)
    .first<{ company_name: string; contact_name: string; contact_email: string; website: string | null }>();
  if (!req) return { ok: false, code: "join_request_review_race" };

  const ours = `id = ? AND status = 'pending' AND reviewed_by = ? AND reviewed_at = ?`;
  let approved: JoinApproval;
  try {
    const registered = Boolean(
      await db.prepare(`SELECT 1 AS x FROM profiles WHERE lower(email) = lower(?)`).bind(req.contact_email).first(),
    );
    const companyId = crypto.randomUUID();
    const slug = `${slugify(req.company_name)}-${crypto.randomUUID().slice(0, 4)}`;
    const results = await db.batch([
      db
        .prepare(`INSERT INTO companies (id, name, slug, sponsor_tier_id, website, status) VALUES (?, ?, ?, ?, ?, 'active')`)
        .bind(companyId, req.company_name, slug, opts.tierId, req.website),
      ...(registered
        ? []
        : [
            // A pending invite for this email already exists: keep it (ON CONFLICT DO NOTHING).
            db
              .prepare(
                `INSERT INTO invites (id, email, full_name, role, company_id, invited_by) VALUES (?, ?, ?, 'company_user', ?, ?)
                 ON CONFLICT DO NOTHING`,
              )
              .bind(crypto.randomUUID(), req.contact_email, req.contact_name, companyId, opts.adminId),
          ]),
      db.prepare(`UPDATE company_join_requests SET status = 'approved', company_id = ? WHERE ${ours}`).bind(companyId, opts.id, opts.adminId, at),
    ]);
    approved = { ok: true, email: req.contact_email, name: req.contact_name, companyId, registered };
    // Only if our claim went stale and another admin took over mid-way; the firm was still made.
    if (results[results.length - 1]?.meta.changes !== 1) return { ok: false, code: "join_request_review_race" };
  } catch (e) {
    console.error("join request approval failed", e);
    await db
      .prepare(`UPDATE company_join_requests SET reviewed_by = NULL, reviewed_at = NULL WHERE ${ours}`)
      .bind(opts.id, opts.adminId, at)
      .run()
      .catch((err) => console.error("join request claim not released", err));
    return { ok: false, code: "join_request_review_failed" };
  }
  return approved;
}
