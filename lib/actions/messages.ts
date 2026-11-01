"use server";

import { assertSponsorWriteAllowed } from "@/lib/sponsor-mode";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { notify } from "@/lib/notify";
import { createClient } from "@/lib/supabase/server";
import { markConversationRead } from "@/lib/message-read";
import { denyRedirect } from "./deny";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string) {
  return UUID_RE.test(value);
}

export async function startConversation(formData: FormData) {
  const profile = await requireProfile();
  await assertSponsorWriteAllowed(profile);
  const supabase = await createClient();
  let companyId = String(formData.get("company_id") ?? "");
  const memberId =
    profile.role === "member" ? profile.id : String(formData.get("member_id") ?? "");
  if (profile.role === "company_user") {
    const { data } = await supabase
      .from("company_users")
      .select("company_id")
      .eq("profile_id", profile.id)
      .maybeSingle();
    if (!data) throw new Error("No company on this account");
    companyId = data.company_id;
  }

  const deniedPath = conversationReturnPath(formData, profile.role);
  if (!isUuid(companyId) || !isUuid(memberId)) {
    denyRedirect(deniedPath, "conversation_start_forbidden");
  }

  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("member_id", memberId)
    .eq("company_id", companyId)
    .maybeSingle();

  const id = existing?.id;
  if (!id) {
    const { data, error } = await supabase
      .from("conversations")
      .insert({ member_id: memberId, company_id: companyId })
      .select("id")
      .single();
    if (error || !data) {
      if (error?.code === "23505") {
        const { data: raced } = await supabase
          .from("conversations")
          .select("id")
          .eq("member_id", memberId)
          .eq("company_id", companyId)
          .maybeSingle();
        if (raced?.id) {
          redirect(
            profile.role === "company_user"
              ? `/company/messages/${raced.id}`
              : `/messages/${raced.id}`,
          );
        }
      }
      denyRedirect(deniedPath, "conversation_start_forbidden");
    }
    const path =
      profile.role === "company_user"
        ? `/company/messages/${data.id}`
        : `/messages/${data.id}`;
    redirect(path);
  }

  const path =
    profile.role === "company_user" ? `/company/messages/${id}` : `/messages/${id}`;
  redirect(path);
}

const MAX_MESSAGE_BODY = 4000;

export async function sendMessage(formData: FormData) {
  const profile = await requireProfile();
  await assertSponsorWriteAllowed(profile);
  const supabase = await createClient();
  const conversationId = String(formData.get("conversation_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const inboxPath = profile.role === "company_user" ? "/company/messages" : "/messages";
  if (!isUuid(conversationId)) {
    denyRedirect(inboxPath, "message_send_failed");
  }
  const deniedPath =
    profile.role === "company_user"
      ? `/company/messages/${conversationId}`
      : `/messages/${conversationId}`;
  if (!body || body.length > MAX_MESSAGE_BODY) {
    denyRedirect(deniedPath, "message_invalid");
  }
  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_id: profile.id,
    body,
  });
  if (error) {
    denyRedirect(deniedPath, "message_send_failed");
  }

  const col =
    profile.role === "company_user" ? "company_last_read_at" : "member_last_read_at";
  // No zero-row branch here on purpose: the messages insert above already
  // passed, and for both roles conversations_member_update /
  // conversations_company_update are strictly weaker than the messages insert
  // policy, so a sender who could post into this thread can always stamp its
  // read marker. A refusal is unreachable rather than merely unlikely.
  const { error: touchErr } = await supabase
    .from("conversations")
    .update({ [col]: new Date().toISOString() })
    .eq("id", conversationId);
  if (touchErr) {
    denyRedirect(deniedPath, "message_send_failed");
  }

  await notify({
    type: "message",
    to: [],
    subject: "New message on Connect by QUANTT",
    body,
  });
  revalidatePath("/messages");
  revalidatePath(`/messages/${conversationId}`);
  revalidatePath("/company/messages");
  revalidatePath(`/company/messages/${conversationId}`);
}

export async function markRead(conversationId: string) {
  const profile = await requireProfile();
  await assertSponsorWriteAllowed(profile);
  const supabase = await createClient();
  await markConversationRead(supabase, profile, conversationId);
}

function conversationReturnPath(formData: FormData, role: string) {
  if (role !== "company_user") {
    const dest = String(formData.get("return_to") ?? "");
    if (
      (dest === "/feed" || dest.startsWith("/feed/")) &&
      !dest.includes("//") &&
      !dest.includes("\\") &&
      !dest.includes("..")
    ) {
      return dest;
    }
    return "/feed";
  }
  const dest = String(formData.get("return_to") ?? "");
  if (
    dest.startsWith("/company/") &&
    !dest.includes("//") &&
    !dest.includes("\\") &&
    !dest.includes("..")
  ) {
    return dest;
  }
  return "/company/applicants";
}
