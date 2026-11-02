import type { ReactNode } from "react";

import AlumniNav from "@/components/AlumniNav";
import { requireAlumnus } from "@/lib/alumni/current";
import { unreadCount } from "@/lib/alumni/data";
import { hubEnv } from "@/lib/hub/env";

export default async function AlumniLayout({ children }: { children: ReactNode }) {
  const me = await requireAlumnus();
  const unread = await unreadCount((await hubEnv()).DB, { kind: "alumni", id: me.id });
  return (
    <>
      <AlumniNav unread={unread} />
      <main className="mx-auto max-w-6xl px-6 py-10 sm:px-8 sm:py-14">{children}</main>
    </>
  );
}
