import { redirect } from "next/navigation";

/** Invites moved onto People (one form for sponsors and alumni). Old links land here. */
export default async function InvitePage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind } = await searchParams;
  redirect(`/admin/people?tab=${kind === "alum" ? "alumni" : "sponsors"}&invite=1`);
}
