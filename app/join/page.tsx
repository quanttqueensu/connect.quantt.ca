import { submitCompanyRequest } from "@/lib/actions/admin";
import { Field, PrimaryButton, TextArea, TextInput } from "@/components/Form";
import { DENIAL_MESSAGES } from "@/lib/denials";
import Link from "next/link";
import PublicShell from "@/components/PublicShell";

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { sent, error } = await searchParams;
  const errorText = error ? DENIAL_MESSAGES[error] : undefined;

  return (
    <PublicShell>
      <div className="mx-auto w-full max-w-xl rounded border border-line bg-white p-6 sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">Sponsors</p>
        <h1 className="mt-3 font-heading text-3xl font-semibold leading-tight text-ink">Request Connect access</h1>
        <p className="mt-4 text-sm leading-6 text-copy">
          Share this page with hiring contacts. QUANTT execs review each request and send an
          invite to set a password. You will not have an account until you are approved.
        </p>
        {sent ? (
          <p className="mt-10 text-sm text-primary">
            We’ll be in touch if QUANTT approves your access.
          </p>
        ) : (
          <form action={submitCompanyRequest} className="mt-8 space-y-5">
            {errorText && <p className="text-sm text-red-700">{errorText}</p>}
            <Field label="Company name">
              <TextInput name="company_name" required maxLength={200} />
            </Field>
            <Field label="Website">
              <TextInput name="website" type="url" maxLength={500} />
            </Field>
            <Field label="Your name">
              <TextInput name="contact_name" required maxLength={120} />
            </Field>
            <Field label="Work email">
              <TextInput name="contact_email" type="email" required maxLength={254} />
            </Field>
            <Field label="Note">
              <TextArea name="note" rows={4} maxLength={2000} />
            </Field>
            <PrimaryButton type="submit">Submit request</PrimaryButton>
          </form>
        )}
        <p className="mt-8 text-sm text-copy">
          Already invited?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </PublicShell>
  );
}
