"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { livesOnTier } from "@/lib/tiers";
import { denyRedirect } from "./deny";

async function requireAdmin() {
  const profile = await requireProfile();
  if (!profile.is_admin) denyRedirect("/feed", "admins_only");
  return profile;
}

function slugifyTier(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

function parsePriceCents(raw: string) {
  const s = raw.trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 100);
}

function parseEmbargo(raw: string) {
  const s = raw.trim();
  if (!s) return 0;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0 || n > 8760) return undefined;
  return n;
}

function revalidateTiers() {
  revalidatePath("/admin/tiers");
  revalidatePath("/admin/companies");
  revalidatePath("/feed");
  revalidatePath("/company", "layout");
  revalidatePath("/company/sponsorship");
  revalidatePath("/company/resume-book");
  revalidatePath("/company/search");
}

export async function createTier(formData: FormData) {
  const profile = await requireAdmin();
  const supabase = await createClient();
  const name = String(formData.get("name") ?? "").trim();
  const rank = Number(formData.get("rank"));
  const price = parsePriceCents(String(formData.get("price") ?? ""));
  const embargo = parseEmbargo(String(formData.get("embargo") ?? ""));
  const bookEmbargo = parseEmbargo(String(formData.get("resume_book_embargo") ?? ""));
  if (!name) denyRedirect("/admin/tiers", "tier_name_required");
  if (!Number.isInteger(rank) || rank < 1) denyRedirect("/admin/tiers", "tier_rank_invalid");
  if (price === undefined) denyRedirect("/admin/tiers", "tier_price_invalid");
  if (embargo === undefined) denyRedirect("/admin/tiers", "tier_embargo_invalid");
  if (bookEmbargo === undefined) denyRedirect("/admin/tiers", "tier_embargo_invalid");

  const { data, error } = await supabase
    .from("sponsor_tiers")
    .insert({
      key: slugifyTier(name) || `tier-${rank}`,
      name,
      rank,
      price_cents: price,
      blurb: String(formData.get("blurb") ?? "").trim(),
      applicant_embargo_hours: embargo,
      resume_book_embargo_hours: bookEmbargo,
    })
    .select("id")
    .maybeSingle();
  if (error?.code === "23505") {
    const blob = `${error.message} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
    if (blob.includes("rank") || blob.includes("sponsor_tiers_rank_active")) {
      denyRedirect("/admin/tiers", "tier_rank_taken");
    }
    denyRedirect("/admin/tiers", "tier_key_duplicate");
  }
  if (error) denyRedirect("/admin/tiers", "tier_save_failed");
  if (!data) denyRedirect("/admin/tiers", "tier_save_failed");

  await supabase.from("sponsor_tier_events").insert({
    kind: "tier_created",
    tier_id: data.id,
    actor_id: profile.id,
    detail: { name, rank },
  });
  revalidateTiers();
}

export async function updateTier(formData: FormData) {
  const profile = await requireAdmin();
  const supabase = await createClient();
  const id = String(formData.get("tier_id"));
  const name = String(formData.get("name") ?? "").trim();
  const rank = Number(formData.get("rank"));
  const price = parsePriceCents(String(formData.get("price") ?? ""));
  const embargo = parseEmbargo(String(formData.get("embargo") ?? ""));
  const bookEmbargo = parseEmbargo(String(formData.get("resume_book_embargo") ?? ""));
  if (!name) denyRedirect("/admin/tiers", "tier_name_required");
  const { data: existing } = await supabase
    .from("sponsor_tiers")
    .select("key")
    .eq("id", id)
    .maybeSingle();
  if (!existing) denyRedirect("/admin/tiers", "tier_save_failed");
  const minRank = existing.key === "none" ? 0 : 1;
  if (!Number.isInteger(rank) || rank < minRank) denyRedirect("/admin/tiers", "tier_rank_invalid");
  if (price === undefined) denyRedirect("/admin/tiers", "tier_price_invalid");
  if (embargo === undefined) denyRedirect("/admin/tiers", "tier_embargo_invalid");
  if (bookEmbargo === undefined) denyRedirect("/admin/tiers", "tier_embargo_invalid");

  const { data, error } = await supabase
    .from("sponsor_tiers")
    .update({
      name,
      rank,
      price_cents: price,
      blurb: String(formData.get("blurb") ?? "").trim(),
      applicant_embargo_hours: embargo,
      resume_book_embargo_hours: bookEmbargo,
    })
    .eq("id", id)
    .select("id");
  if (error?.code === "23505") denyRedirect("/admin/tiers", "tier_rank_taken");
  if (error) denyRedirect("/admin/tiers", "tier_save_failed");
  if (!data?.length) denyRedirect("/admin/tiers", "tier_save_failed");

  await supabase.from("sponsor_tier_events").insert({
    kind: "tier_updated",
    tier_id: id,
    actor_id: profile.id,
    detail: { name, rank, price_cents: price, embargo, resume_book_embargo: bookEmbargo },
  });
  revalidateTiers();
}

export async function deactivateTier(formData: FormData) {
  const profile = await requireAdmin();
  const supabase = await createClient();
  const id = String(formData.get("tier_id"));
  const { data, error } = await supabase
    .from("sponsor_tiers")
    .update({ is_active: false })
    .eq("id", id)
    .select("id");
  if (error) denyRedirect("/admin/tiers", "tier_deactivate_system");
  if (!data?.length) denyRedirect("/admin/tiers", "tier_save_failed");
  await supabase.from("sponsor_tier_events").insert({
    kind: "tier_deactivated",
    tier_id: id,
    actor_id: profile.id,
  });
  revalidateTiers();
}

export async function reactivateTier(formData: FormData) {
  const profile = await requireAdmin();
  const supabase = await createClient();
  const id = String(formData.get("tier_id"));
  const { data, error } = await supabase
    .from("sponsor_tiers")
    .update({ is_active: true })
    .eq("id", id)
    .select("id");
  if (error) denyRedirect("/admin/tiers", "tier_rank_taken");
  if (!data?.length) denyRedirect("/admin/tiers", "tier_save_failed");
  await supabase.from("sponsor_tier_events").insert({
    kind: "tier_reactivated",
    tier_id: id,
    actor_id: profile.id,
  });
  revalidateTiers();
}

export async function saveTierCapabilities(formData: FormData) {
  const profile = await requireAdmin();
  const supabase = await createClient();
  const tierId = String(formData.get("tier_id"));

  const { data: caps } = await supabase.from("sponsor_capabilities").select("key, kind");
  const { data: current } = await supabase
    .from("sponsor_tier_capabilities")
    .select("capability, value")
    .eq("tier_id", tierId);

  const currentMap = new Map(
    (current ?? []).map((r) => [r.capability as string, r.value as number | null]),
  );
  const next = new Map<string, number | null>();

  for (const cap of caps ?? []) {
    const granted = formData.get(`grant_${cap.key}`) === "on";
    if (!granted) continue;
    if (cap.kind === "quota") {
      const raw = String(formData.get(`value_${cap.key}`) ?? "").trim();
      if (!raw) {
        next.set(cap.key, null);
      } else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0) {
          denyRedirect("/admin/tiers", "tier_capability_value_invalid");
        }
        next.set(cap.key, n);
      }
    } else {
      next.set(cap.key, null);
    }
  }

  const { data: firms } = await supabase
    .from("companies")
    .select("id, sponsor_tier_id, grace_tier_id, tier_grace_until");
  const count = (firms ?? []).filter((c) =>
    livesOnTier(
      {
        sponsor_tier_id: c.sponsor_tier_id as string,
        grace_tier_id: (c.grace_tier_id as string | null) ?? null,
        tier_grace_until: (c.tier_grace_until as string | null) ?? null,
      },
      tierId,
    ),
  ).length;
  const removing = [...currentMap.keys()].some((k) => !next.has(k));
  if (count > 0 && removing && formData.get("confirmed") !== "on") {
    denyRedirect("/admin/tiers", "tier_confirm_required");
  }

  for (const [key, value] of next) {
    const prev = currentMap.get(key);
    if (prev === undefined) {
      const { error } = await supabase
        .from("sponsor_tier_capabilities")
        .insert({ tier_id: tierId, capability: key, value });
      if (error) denyRedirect("/admin/tiers", "tier_capability_invalid");
      await supabase.from("sponsor_tier_events").insert({
        kind: "capability_granted",
        tier_id: tierId,
        actor_id: profile.id,
        detail: { capability: key, value },
      });
    } else if (prev !== value) {
      const { error } = await supabase
        .from("sponsor_tier_capabilities")
        .update({ value })
        .eq("tier_id", tierId)
        .eq("capability", key);
      if (error) denyRedirect("/admin/tiers", "tier_save_failed");
      await supabase.from("sponsor_tier_events").insert({
        kind: "capability_granted",
        tier_id: tierId,
        actor_id: profile.id,
        detail: { capability: key, value },
      });
    }
  }

  for (const key of currentMap.keys()) {
    if (next.has(key)) continue;
    const { error } = await supabase
      .from("sponsor_tier_capabilities")
      .delete()
      .eq("tier_id", tierId)
      .eq("capability", key);
    if (error) denyRedirect("/admin/tiers", "tier_save_failed");
    await supabase.from("sponsor_tier_events").insert({
      kind: "capability_revoked",
      tier_id: tierId,
      actor_id: profile.id,
      detail: { capability: key },
    });
  }

  revalidateTiers();
}
