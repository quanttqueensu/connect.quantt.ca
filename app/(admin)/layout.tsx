import type { ReactNode } from "react";
import AdminNav from "@/components/AdminNav";
import { requireCurrentProfile } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const profile = await requireCurrentProfile();
  if (!profile.is_admin) redirect("/feed");

  return (
    <>
      <AdminNav />
      <main className="mx-auto max-w-6xl px-6 py-10 sm:px-8 sm:py-14">{children}</main>
    </>
  );
}
