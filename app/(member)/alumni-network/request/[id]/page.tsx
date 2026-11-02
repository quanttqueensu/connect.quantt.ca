import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Field, PrimaryButton, TextArea } from "@/components/Form";
import Notice from "@/components/Notice";
import { requestAlumniConversation } from "@/lib/actions/alumni";
import { getAlumnusName, MAX_ALUMNI_REQUEST, openConversation } from "@/lib/alumni/data";
import { getCurrentProfile } from "@/lib/auth";
import { hubEnv } from "@/lib/hub/env";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A member's first contact with an alum: one intro the alum accepts or declines. */
export default async function AlumniRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ denied?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await getCurrentProfile();
  if (!me) redirect("/login");
  if (me.role !== "member") redirect("/company");
  if (!UUID_RE.test(id)) notFound();
  const { DB } = await hubEnv();
  const existing = await openConversation(DB, { kind: "member", id: me.id }, id);
  if (existing) redirect(`/alumni-network/messages/${existing}`);
  const name = await getAlumnusName(DB, id);
  if (name === null) notFound();
  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
        <Link href="/alumni-network" className="hover:underline">Alumni</Link>
      </p>
      <h1 className="mt-2 font-heading text-2xl font-bold text-ink">Message request to {name}</h1>
      <p className="mt-2 max-w-lg text-sm text-copy">
        Introduce yourself and say what you&apos;d like to talk about. {name} sees this first and can accept or decline.
        Once they accept, you can message freely.
      </p>
      <Notice message={sp.denied} />
      <form action={requestAlumniConversation} className="mt-6 max-w-lg space-y-3">
        <input type="hidden" name="alumni_id" value={id} />
        <Field label="Intro">
          <TextArea name="body" rows={5} required maxLength={MAX_ALUMNI_REQUEST} />
        </Field>
        <PrimaryButton type="submit">Send request</PrimaryButton>
      </form>
    </>
  );
}
