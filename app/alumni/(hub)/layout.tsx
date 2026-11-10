import type { ReactNode } from "react";

import AlumniNav from "@/components/AlumniNav";
import SponsorModeBanner from "@/components/SponsorModeBanner";
import { requireAlumnus } from "@/lib/alumni/current";
import { redirect } from "next/navigation";

import { hasChosenAlumniPrefs, unreadCount } from "@/lib/alumni/data";
import { hubEnv } from "@/lib/hub/env";

export default async function AlumniLayout({ children }: { children: ReactNode }) {
  const me = await requireAlumnus();
  const { DB } = await hubEnv();
  // Alumni pick their email notifications once before using the alumni area.
  // (Not for an admin previewing in alumni mode: that view is read-only.)
  if (!me.preview && !(await hasChosenAlumniPrefs(DB, me.id))) redirect("/alumni/setup");
  const unread = await unreadCount(DB, { kind: "alumni", id: me.id });
  return (
    <>
      <AlumniNav unread={unread} preview={me.preview} />
      {me.preview && <SponsorModeBanner companyName={me.full_name} view="alum" />}
      <main className="mx-auto max-w-6xl px-4 py-5 sm:px-8 sm:py-8">{children}</main>
    </>
  );
}
