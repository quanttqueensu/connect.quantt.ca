import Link from "next/link";
import { cookies } from "next/headers";

import { Field, GhostButton, PrimaryButton, TextInput } from "@/components/Form";
import PublicShell from "@/components/PublicShell";
import { requestAlumniLoginCode, restartAlumniLogin, verifyAlumniLoginCode } from "@/lib/actions/alumni";
import { DENIAL_MESSAGES } from "@/lib/denials";

export default async function AlumniLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; step?: string }>;
}) {
  const { error, step } = await searchParams;
  const errorText = error ? DENIAL_MESSAGES[error] : undefined;
  const pendingEmail = (await cookies()).get("connect_alumni_login_email")?.value;
  const codeStep = step === "code" && Boolean(pendingEmail);
  return (
    <PublicShell>
      <div className="mx-auto grid w-full max-w-4xl overflow-hidden rounded border border-line bg-white md:grid-cols-[0.85fr_1.15fr]">
        <div className="flex flex-col bg-navy p-6 sm:p-8 md:justify-center">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-[-0.035em] text-white sm:text-[34px]">
              Connect Alumni
              <span className="mt-2 block text-base font-normal tracking-normal text-white/80">by QUANTT</span>
            </h1>
            <p className="mt-3 max-w-xs text-sm leading-6 text-white/80">
              For QUANTT alumni: share jobs and mentorship, and message current members.
            </p>
          </div>
        </div>
        <div className="p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-ink">Alumni login</h2>
          <p className="mt-2 text-sm leading-6 text-copy">We&apos;ll email a sign-in code to the address you were invited with.</p>
          {errorText && <p className="mt-4 text-sm text-red-700">{errorText}</p>}
          {codeStep ? (
            <form action={verifyAlumniLoginCode} className="mt-5 w-full space-y-4">
              <p className="text-sm text-copy">
                If <span className="font-medium text-ink">{pendingEmail}</span> has an alumni account, a six-digit
                code is on its way. It works for 10 minutes.
              </p>
              <Field label="Code">
                <TextInput name="code" inputMode="numeric" pattern="[0-9 ]{6,7}" maxLength={7} required autoComplete="one-time-code" autoFocus />
              </Field>
              <PrimaryButton type="submit" className="w-full">
                Log in
              </PrimaryButton>
              <GhostButton type="submit" formAction={restartAlumniLogin} formNoValidate className="w-full">
                Use a different email
              </GhostButton>
            </form>
          ) : (
            <form action={requestAlumniLoginCode} className="mt-5 w-full space-y-4">
              <Field label="Email">
                <TextInput name="email" type="email" required autoComplete="email" />
              </Field>
              <PrimaryButton type="submit" className="w-full">
                Email me a sign-in code
              </PrimaryButton>
            </form>
          )}
          <p className="mt-6 border-t border-line pt-5 text-sm text-copy">
            Current member or sponsor?{" "}
            <Link href="/login" className="font-medium text-primary hover:underline">
              Go to the main login
            </Link>
          </p>
        </div>
      </div>
    </PublicShell>
  );
}
