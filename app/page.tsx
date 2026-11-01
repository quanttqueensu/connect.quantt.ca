import { redirect } from "next/navigation";

import { currentSession } from "@/lib/supabase/server";

/** The middleware already sends both cases on; this is the fallback. */
export default async function Home() {
  const session = await currentSession();
  if (!session) redirect("/login");
  redirect(session.role === "company_user" ? "/company" : "/feed");
}
