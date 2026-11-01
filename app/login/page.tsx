import Image from "next/image";
import Link from "next/link";
import { login, requestPasswordReset } from "@/lib/actions/auth";
import { Field, GhostButton, PrimaryButton, TextInput } from "@/components/Form";
import PublicShell from "@/components/PublicShell";
import LoginPanel from "@/components/LoginPanel";
import { DENIAL_MESSAGES } from "@/lib/denials";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reset?: string }>;
}) {
  const { error, reset } = await searchParams;
  const errorText = error ? DENIAL_MESSAGES[error] : undefined;
  return (
    <PublicShell>
      <div className="grid w-full overflow-hidden rounded border border-line bg-white lg:grid-cols-[0.9fr_1.1fr]">
        <div className="flex flex-col bg-navy p-6 sm:p-8 lg:p-12">
          <Image
            src="/images/logos/quantt-icon.png"
            alt=""
            width={56}
            height={56}
            className="hidden h-12 w-12 lg:block"
            priority
          />
          <div className="lg:mt-40">
            <h1 className="font-heading text-3xl font-semibold tracking-[-0.035em] text-white sm:text-[40px]">
              Connect{" "}
              <span className="mt-2 block text-base font-normal tracking-normal text-white/80">by QUANTT</span>
            </h1>
            <p className="mt-4 max-w-sm text-base leading-7 text-white/80">
              Invite-only access for members and approved companies.
            </p>
          </div>
        </div>
        <LoginPanel>
          <form action={login} className="mt-6 w-full space-y-5">
            {errorText && <p className="text-sm text-red-700">{errorText}</p>}
            {reset && (
              <p className="text-sm text-primary">
                If that address has an account, a reset link is on its way. Check your inbox — the
                link opens a page where you set a new password.
              </p>
            )}
            <Field label="Email">
              <TextInput name="email" type="email" required autoComplete="email" />
            </Field>
            <Field label="Password">
              <TextInput name="password" type="password" required autoComplete="current-password" />
            </Field>
            <PrimaryButton type="submit" className="w-full">
              Log in
            </PrimaryButton>
            {/*
              Reuses the email field above. formNoValidate skips the required
              password, which a reset obviously does not need; the action checks
              the email itself.
            */}
            <GhostButton type="submit" formAction={requestPasswordReset} formNoValidate className="w-full">
              Forgot your password?
            </GhostButton>
          </form>
          <p className="mt-8 border-t border-line pt-6 text-sm text-copy">
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
