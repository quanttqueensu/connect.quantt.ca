"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ALUMNI_COOKIE, endAlumniSession } from "@/lib/alumni/auth";
import { requireAlumnusForWrite as requireAlumnus } from "@/lib/alumni/current";
import { removeAlumnusFromDiscord } from "@/lib/alumni/discord";
import { pushConnectAlumni } from "@/lib/alumni/directory-push";
import {
  cancelAlumniInvite,
  closeAlumniPost,
  createAlumniPost,
  decideRequest,
  inviteAlumnus,
  openConversation,
  removeAlumnus,
  requestConversation,
  saveAlumniPrefs,
  sendThreadMessage,
  updateAlumnus,
  type AlumniViewer,
} from "@/lib/alumni/data";
import { requireProfile } from "@/lib/auth";
import { sendInviteEmail } from "@/lib/cf-auth/email";
import { looksLikeEmail, normalizeEmail } from "@/lib/cf-auth/tokens";
import { hubEnv } from "@/lib/hub/env";
import { notifyLater } from "@/lib/notify";
import { notifyAlumniMessage, notifyAlumniRequest, notifyAlumniRequestAccepted } from "@/lib/notifications";
import { siteUrl } from "@/lib/site-url";
import { denyRedirect } from "./deny";

/**
 * Alumni area actions. Alumni actions check the alumni session (their own
 * cookie); member actions check the hub session and role = member; admin
 * actions check is_admin. Nothing here trusts an id from the form for "who am I".
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
// Alumni sign in on /login with everyone else (lib/actions/auth.ts).

export async function alumniLogout() {
  const jar = await cookies();
  await endAlumniSession((await hubEnv()).DB, jar.get(ALUMNI_COOKIE)?.value);
  jar.delete(ALUMNI_COOKIE);
  redirect("/login");
}

// ---- Alumni: profile, posts, messages ------------------------------------

export async function saveAlumniProfile(formData: FormData) {
  const me = await requireAlumnus();
  const back = "/alumni/profile";
  const fullName = text(formData, "full_name", 120);
  const link = httpsUrl(text(formData, "linkedin_url", 500));
  const other = httpsUrl(text(formData, "other_social_url", 500));
  const phone = text(formData, "phone", 40);
  const bio = text(formData, "bio", 1000);
  const yearRaw = text(formData, "grad_year", 4);
  const year = yearRaw ? Number(yearRaw) : null;
  if (!fullName || !link.ok || !other.ok || (year !== null && (!Number.isInteger(year) || year < 1950 || year > 2100))) {
    denyRedirect(back, "alumni_profile_invalid");
  }
  // Optional, but a number that's there has to look like one.
  if (phone && (!/^\+?[0-9 ().-]{7,40}$/.test(phone) || phone.replace(/\D/g, "").length < 7)) {
    denyRedirect(back, "alumni_phone_invalid");
  }
  const env = await hubEnv();
  await updateAlumnus(env.DB, { kind: "alumni", id: me.id }, {
    full_name: fullName,
    grad_year: year,
    program: text(formData, "program", 120),
    firm: text(formData, "firm", 120),
    title: text(formData, "title", 120),
    location: text(formData, "location", 120),
    linkedin_url: link.url,
    other_social_url: other.url,
    phone,
    bio,
  });
  await pushConnectAlumni(env.DB, env.AUTH).catch((e) => console.error("connect alumni push failed", e));
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
  return { kind: "member", id: p.id, admin: Boolean(p.is_admin) };
}

function threadPath(viewer: AlumniViewer, id: string) {
  return viewer.kind === "alumni" ? `/alumni/messages/${id}` : `/alumni-network/messages/${id}`;
}

/**
 * Start (or reopen) a conversation. Alumni pass member_id and go straight to
 * the thread, and so do admins passing alumni_id. Other members pass alumni_id:
 * an existing conversation opens, and a first contact goes to the request form.
 */
export async function startAlumniConversation(formData: FormData) {
  const isAlumniSide = formData.get("side") === "alumni";
  const viewer: AlumniViewer = isAlumniSide ? { kind: "alumni", id: (await requireAlumnus()).id } : await memberViewer();
  const other = String(formData.get(isAlumniSide ? "member_id" : "alumni_id") ?? "");
  const back = isAlumniSide ? "/alumni/members" : "/alumni-network";
  if (!UUID_RE.test(other)) denyRedirect(back, "alumni_conversation_failed");
  const id = await openConversation((await hubEnv()).DB, viewer, other);
  if (!id) {
    if (!isAlumniSide) redirect(`/alumni-network/request/${other}`);
    denyRedirect(back, "alumni_conversation_failed");
  }
  redirect(threadPath(viewer, id));
}

/** A member's message request to an alum, with a short intro. */
export async function requestAlumniConversation(formData: FormData) {
  const viewer = await memberViewer();
  const alumniId = String(formData.get("alumni_id") ?? "");
  if (!UUID_RE.test(alumniId)) denyRedirect("/alumni-network", "alumni_conversation_failed");
  const res = await requestConversation((await hubEnv()).DB, viewer, alumniId, String(formData.get("body") ?? ""));
  if (!res) denyRedirect(`/alumni-network/request/${alumniId}`, "alumni_request_invalid");
  if (res.created) notifyLater("alumni request", (db, send) => notifyAlumniRequest(db, send, res.id));
  revalidatePath("/alumni-network");
  redirect(threadPath(viewer, res.id));
}

/** The alum accepts or declines a member's request. */
export async function decideAlumniRequest(formData: FormData) {
  const me = await requireAlumnus();
  const id = String(formData.get("conversation_id") ?? "");
  const accept = formData.get("decision") === "accept";
  if (!UUID_RE.test(id)) denyRedirect("/alumni/messages", "alumni_request_failed");
  const ok = await decideRequest((await hubEnv()).DB, { kind: "alumni", id: me.id }, id, accept);
  if (!ok) denyRedirect(`/alumni/messages/${id}`, "alumni_request_failed");
  if (accept) notifyLater("alumni request accepted", (db, send) => notifyAlumniRequestAccepted(db, send, id));
  revalidatePath("/alumni", "layout");
  redirect(accept ? `/alumni/messages/${id}` : "/alumni/messages?declined=1");
}

export async function saveAlumniNotifications(formData: FormData) {
  const me = await requireAlumnus();
  await saveAlumniPrefs((await hubEnv()).DB, { kind: "alumni", id: me.id }, {
    requests: formData.get("requests") === "on",
    messages: formData.get("messages") === "on",
  });
  if (formData.get("setup") === "1") {
    revalidatePath("/alumni", "layout");
    // Last setup step: offer the Discord (skippable).
    redirect("/alumni/discord?setup=1");
  }
  revalidatePath("/alumni/profile");
  redirect("/alumni/profile?notifications=saved#notifications");
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
  if (!looksLikeEmail(email) || !fullName) denyRedirect("/admin/people?tab=alumni", "alumni_invite_invalid");
  const env = await hubEnv();
  const result = await inviteAlumnus(env.DB, email, fullName, admin.id);
  if (result === "exists") denyRedirect("/admin/people?tab=alumni", "alumni_invite_exists");
  let sent = true;
  try {
    await sendInviteEmail(env, email, fullName, `${siteUrl()}/login`, "alumni");
  } catch (e) {
    console.error("alumni invite email not sent", e);
    sent = false;
  }
  await pushConnectAlumni(env.DB, env.AUTH).catch((e) => console.error("connect alumni push failed", e));
  revalidatePath("/admin/people");
  redirect(`/admin/people?tab=alumni&${sent ? "sent" : "unsent"}=1`);
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
    await pushConnectAlumni(DB, env.AUTH).catch((e) => console.error("connect alumni push failed", e));
  }
  revalidatePath("/admin/people");
}
