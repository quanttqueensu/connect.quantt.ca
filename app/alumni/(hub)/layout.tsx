import type { ReactNode } from "react";

import AlumniNav from "@/components/AlumniNav";
import { requireAlumnus } from "@/lib/alumni/current";
import { redirect } from "next/navigation";

import { alumniProfileComplete, getAlumnus, hasChosenAlumniPrefs, unreadCount } from "@/lib/alumni/data";
import { hubEnv } from "@/lib/hub/env";

export default async function AlumniLayout({ children }: { children: ReactNode }) {
  const me = await requireAlumnus();
  const { DB } = await hubEnv();
  // Before using the alumni area, alumni fill in their contact details and pick their email notifications, once.
  const profile = await getAlumnus(DB, me.id);
  if (!profile || !alumniProfileComplete(profile) || !(await hasChosenAlumniPrefs(DB, me.id))) redirect("/alumni/setup");
  const unread = await unreadCount(DB, { kind: "alumni", id: me.id });
  return (
    <>
      <AlumniNav unread={unread} />
      <main className="mx-auto max-w-6xl px-4 py-5 sm:px-8 sm:py-8">{children}</main>
    </>
  );
}
