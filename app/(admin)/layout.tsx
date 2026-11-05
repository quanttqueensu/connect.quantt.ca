import SponsorModeBanner from "@/components/SponsorModeBanner";
import { getCompanyContext } from "@/lib/sponsor-mode";
import type { ReactNode } from "react";
import AdminNav from "@/components/AdminNav";
import { requireCurrentProfile } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const profile = await requireCurrentProfile();
  if (!profile.is_admin) redirect("/feed");

  // Middleware keeps sponsor mode on /company, except this picker page.
  const sponsorContext = await getCompanyContext();

  return (
    <>
      <AdminNav sponsorMode={sponsorContext?.preview} />
      {sponsorContext?.preview && <SponsorModeBanner companyName={sponsorContext.company.name} />}
      <main className="mx-auto max-w-6xl px-4 py-5 sm:px-8 sm:py-8">{children}</main>
    </>
  );
}
