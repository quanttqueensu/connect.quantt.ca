"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  ALUMNI_COOKIE,
  alumniCookieOptions,
  createAlumniSession,
  endAlumniSession,
  requestAlumniCode,
  verifyAlumniCode,
} from "@/lib/alumni/auth";
import { requireAlumnus } from "@/lib/alumni/current";
import { removeAlumnusFromDiscord } from "@/lib/alumni/discord";
import {
  cancelAlumniInvite,
  closeAlumniPost,
  createAlumniPost,
  inviteAlumnus,
  openConversation,
  removeAlumnus,
  sendThreadMessage,
  updateAlumnus,
  type AlumniViewer,
} from "@/lib/alumni/data";
import { requireProfile } from "@/lib/auth";
import { sendInviteEmail, sendLoginCodeEmail } from "@/lib/cf-auth/email";
import { looksLikeEmail, normalizeEmail } from "@/lib/cf-auth/tokens";
import { hubEnv } from "@/lib/hub/env";
import { notifyLater } from "@/lib/notify";
import { notifyAlumniMessage } from "@/lib/notifications";
import { siteUrl } from "@/lib/site-url";
import { denyRedirect } from "./deny";

/**
 * Alumni area actions. Alumni actions check the alumni session (their own
 * cookie); member actions check the hub session and role = member; admin
 * actions check is_admin. Nothing here trusts an id from the form for "who am I".
 */

const LOGIN_EMAIL_COOKIE = "connect_alumni_login_email";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function secure() {
  return siteUrl().startsWith("https://");
}

function text(formData: FormData, key: string, max: number) {
  const v = String(formData.get(key) ?? "").trim();
  return v ? v.slice(0, max) : null;
}

function httpsUrl(v: string | null) {
  if (!v) return { ok: true as const, url: null };
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? { ok: true as const, url: u.toString() } : { ok: false as const };
  } catch {
    return { ok: false as const };
  }
}

// ---- Alumni sign-in -------------------------------------------------------

export async function requestAlumniLoginCode(formData: FormData) {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!looksLikeEmail(email)) redirect("/alumni/login?error=login_email_required");
  const env = await hubEnv();
  try {
    await requestAlumniCode(env.DB, email, (to, code) => sendLoginCodeEmail(env, to, code));
  } catch (e) {
    console.error("alumni login code not sent", e);
  }
  (await cookies()).set(LOGIN_EMAIL_COOKIE, email, {
    httpOnly: true,
    secure: secure(),
    sameSite: "lax",
    path: "/alumni/login",
    maxAge: 15 * 60,
  });
  redirect("/alumni/login?step=code");
}

export async function verifyAlumniLoginCode(formData: FormData) {
  const jar = await cookies();
  const email = jar.get(LOGIN_EMAIL_COOKIE)?.value;
  if (!email) redirect("/alumni/login?error=login_code_expired");
  const { DB } = await hubEnv();
  const result = await verifyAlumniCode(DB, email, String(formData.get("code") ?? ""));
  if (!result.ok) {
    if (result.code === "alumni_account_missing") {
      jar.delete({ name: LOGIN_EMAIL_COOKIE, path: "/alumni/login" });
      redirect("/alumni/login?error=alumni_account_missing");
    }
    redirect("/alumni/login?step=code&error=login_code_invalid");
  }
  jar.set(ALUMNI_COOKIE, await createAlumniSession(DB, result.alumniId), alumniCookieOptions(secure()));
  jar.delete({ name: LOGIN_EMAIL_COOKIE, path: "/alumni/login" });
  redirect("/alumni");
}

export async function restartAlumniLogin() {
  (await cookies()).delete({ name: LOGIN_EMAIL_COOKIE, path: "/alumni/login" });
  redirect("/alumni/login");
}

export async function alumniLogout() {
  const jar = await cookies();
  await endAlumniSession((await hubEnv()).DB, jar.get(ALUMNI_COOKIE)?.value);
  jar.delete(ALUMNI_COOKIE);
  redirect("/alumni/login");
}

// ---- Alumni: profile, posts, messages ------------------------------------

export async function saveAlumniProfile(formData: FormData) {
  const me = await requireAlumnus();
  const fullName = text(formData, "full_name", 120);
  const link = httpsUrl(text(formData, "linkedin_url", 500));
  const yearRaw = text(formData, "grad_year", 4);
  const year = yearRaw ? Number(yearRaw) : null;
  if (!fullName || !link.ok || (year !== null && (!Number.isInteger(year) || year < 1950 || year > 2100))) {
    denyRedirect("/alumni/profile", "alumni_profile_invalid");
  }
  await updateAlumnus((await hubEnv()).DB, { kind: "alumni", id: me.id }, {
    full_name: fullName,
    grad_year: year,
    program: text(formData, "program", 120),
    firm: text(formData, "firm", 120),
    title: text(formData, "title", 120),
    location: text(formData, "location", 120),
    linkedin_url: link.url,
    bio: text(formData, "bio", 1000),
    email_messages: formData.get("email_messages") === "on",
  });
  revalidatePath("/alumni", "layout");
  redirect("/alumni/profile?saved=1");
}

export async function postAlumniOpportunity(formData: FormData) {
  const me = await requireAlumnus();
  const kind = formData.get("kind") === "mentorship" ? "mentorship" : "job";
  const title = text(formData, "title", 200);
  const link = httpsUrl(text(formData, "external_url", 500));
  if (!title || !link.ok) denyRedirect("/alumni", "alumni_post_invalid");
  await createAlumniPost((await hubEnv()).DB, { kind: "alumni", id: me.id }, {
    kind,
    title,
    body: text(formData, "body", 4000) ?? "",
    firm: text(formData, "firm", 120),
    location: text(formData, "location", 120),
    external_url: link.url,
  });
  revalidatePath("/alumni");
  revalidatePath("/alumni-network");
  redirect("/alumni?posted=1");
}

export async function closeAlumniOpportunity(formData: FormData) {
  const me = await requireAlumnus();
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id) || !(await closeAlumniPost((await hubEnv()).DB, { kind: "alumni", id: me.id }, id))) {
    denyRedirect("/alumni", "alumni_post_failed");
  }
  revalidatePath("/alumni");
  revalidatePath("/alumni-network");
}

async function memberViewer(): Promise<AlumniViewer> {
  const p = await requireProfile();
  if (p.role !== "member") throw new Error("Members only");
  return { kind: "member", id: p.id };
}

function threadPath(viewer: AlumniViewer, id: string) {
  return viewer.kind === "alumni" ? `/alumni/messages/${id}` : `/alumni-network/messages/${id}`;
}

/** Start (or reopen) a conversation. Alumni pass member_id; members pass alumni_id. */
export async function startAlumniConversation(formData: FormData) {
  const isAlumniSide = formData.get("side") === "alumni";
  const viewer: AlumniViewer = isAlumniSide ? { kind: "alumni", id: (await requireAlumnus()).id } : await memberViewer();
  const other = String(formData.get(isAlumniSide ? "member_id" : "alumni_id") ?? "");
  const back = isAlumniSide ? "/alumni/members" : "/alumni-network";
  if (!UUID_RE.test(other)) denyRedirect(back, "alumni_conversation_failed");
  const id = await openConversation((await hubEnv()).DB, viewer, other);
  if (!id) denyRedirect(back, "alumni_conversation_failed");
  redirect(threadPath(viewer, id));
}

export async function sendAlumniThreadMessage(formData: FormData) {
  const isAlumniSide = formData.get("side") === "alumni";
  const viewer: AlumniViewer = isAlumniSide ? { kind: "alumni", id: (await requireAlumnus()).id } : await memberViewer();
  const id = String(formData.get("conversation_id") ?? "");
  const back = threadPath(viewer, id);
  if (!UUID_RE.test(id)) denyRedirect(isAlumniSide ? "/alumni/messages" : "/alumni-network", "alumni_message_failed");
  const ok = await sendThreadMessage((await hubEnv()).DB, viewer, id, String(formData.get("body") ?? ""));
  if (!ok) denyRedirect(back, "alumni_message_failed");
  notifyLater("alumni message", (db, send) => notifyAlumniMessage(db, send, id, viewer.kind));
  revalidatePath(back);
}

// ---- Admin ----------------------------------------------------------------

async function requireAdmin() {
  const p = await requireProfile();
  if (!p.is_admin) redirect("/feed");
  return p;
}

export async function inviteAlumniAction(formData: FormData) {
  const admin = await requireAdmin();
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const fullName = String(formData.get("full_name") ?? "").trim().slice(0, 120);
  if (!looksLikeEmail(email) || !fullName) denyRedirect("/admin/alumni", "alumni_invite_invalid");
  const env = await hubEnv();
  const result = await inviteAlumnus(env.DB, email, fullName, admin.id);
  if (result === "exists") denyRedirect("/admin/alumni", "alumni_invite_exists");
  let sent = true;
  try {
    await sendInviteEmail(env, email, fullName, `${siteUrl()}/alumni/login`, "alumni");
  } catch (e) {
    console.error("alumni invite email not sent", e);
    sent = false;
  }
  revalidatePath("/admin/alumni");
  redirect(`/admin/alumni?${sent ? "sent" : "unsent"}=1`);
}

export async function removeAlumniAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const env = await hubEnv();
  const { DB } = env;
  if (UUID_RE.test(id)) {
    if (formData.get("what") === "invite") await cancelAlumniInvite(DB, id);
    else {
      // Before the row goes: the Discord link is deleted with it.
      await removeAlumnusFromDiscord(DB, env, id);
      await removeAlumnus(DB, id);
    }
  }
  revalidatePath("/admin/alumni");
}
