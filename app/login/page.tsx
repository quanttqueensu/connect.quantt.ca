import Image from "next/image";
import Link from "next/link";
import { cookies } from "next/headers";
import { requestCode, restartLogin, verifyCode } from "@/lib/actions/auth";
import { Field, GhostButton, PrimaryButton, TextInput } from "@/components/Form";
import PublicShell from "@/components/PublicShell";
import LoginPanel from "@/components/LoginPanel";
import { DENIAL_MESSAGES } from "@/lib/denials";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; step?: string }>;
}) {
  const { error, step } = await searchParams;
  const errorText = error ? DENIAL_MESSAGES[error] : undefined;
  const pendingEmail = (await cookies()).get("connect_login_email")?.value;
  const codeStep = step === "code" && Boolean(pendingEmail);
  return (
    <PublicShell>
      <div className="mx-auto grid w-full max-w-4xl overflow-hidden rounded border border-line bg-white md:grid-cols-[0.85fr_1.15fr]">
        <div className="flex flex-col bg-navy p-6 sm:p-8 md:justify-center">
          <Image
            src="/images/logos/quantt-icon.png"
            alt=""
            width={56}
            height={56}
            className="hidden h-10 w-10 md:block"
            priority
          />
          <div className="md:mt-8">
            <h1 className="font-heading text-3xl font-semibold tracking-[-0.035em] text-white sm:text-[34px]">
              Connect{" "}
              <span className="mt-2 block text-base font-normal tracking-normal text-white/80">by QUANTT</span>
            </h1>
            <p className="mt-3 max-w-xs text-sm leading-6 text-white/80">
              Invite-only access for members, sponsors and alumni.
            </p>
          </div>
        </div>
        <LoginPanel error={errorText} codeStep={codeStep}>
          {codeStep ? (
            <form action={verifyCode} className="mt-5 w-full space-y-4">
              <p className="text-sm text-copy">
                If <span className="font-medium text-ink">{pendingEmail}</span> has an account, a
                six-digit code is on its way. It works for 10 minutes.
              </p>
              <Field label="Code">
                <TextInput
                  name="code"
                  inputMode="numeric"
                  pattern="[0-9 ]{6,7}"
                  maxLength={7}
                  required
                  autoComplete="one-time-code"
                  autoFocus
                />
              </Field>
              <PrimaryButton type="submit" className="w-full">
                Log in
              </PrimaryButton>
              <GhostButton type="submit" formAction={restartLogin} formNoValidate className="w-full">
                Use a different email
              </GhostButton>
            </form>
          ) : (
            <form action={requestCode} className="mt-5 w-full space-y-4">
              <Field label="Email you were invited with">
                <TextInput name="email" type="email" required autoComplete="email" />
              </Field>
              <PrimaryButton type="submit" className="w-full">
                Email me a sign-in code
              </PrimaryButton>
            </form>
          )}
          <p className="mt-6 border-t border-line pt-5 text-sm text-copy">
            Hiring for your firm?{" "}
            <Link href="/join" className="font-medium text-primary hover:underline">
              Request Connect access
            </Link>
          </p>
        </LoginPanel>
      </div>
    </PublicShell>
  );
}
