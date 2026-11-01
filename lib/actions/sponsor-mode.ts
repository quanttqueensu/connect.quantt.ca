"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { SPONSOR_MODE_COOKIE } from "@/lib/sponsor-mode";

export async function enterSponsorMode() {
  const profile = await requireProfile();
  if (!profile.is_admin) throw new Error("Admins only");
  (await cookies()).set(SPONSOR_MODE_COOKIE, `${profile.id}:demo`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  redirect("/company");
}

export async function exitSponsorMode() {
  const profile = await requireProfile();
  if (!profile.is_admin) throw new Error("Admins only");
  (await cookies()).delete(SPONSOR_MODE_COOKIE);
  redirect("/admin");
}
