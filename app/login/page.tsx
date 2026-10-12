import Image from "next/image";
import Link from "next/link";
import { login, requestPasswordReset } from "@/lib/actions/auth";
import { Field, GhostButton, PrimaryButton, TextInput } from "@/components/Form";
import { DENIAL_MESSAGES } from "@/lib/denials";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reset?: string }>;
}) {
  const { error, reset } = await searchParams;
  const errorText = error ? DENIAL_MESSAGES[error] : undefined;
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <Image
        src="/images/logos/quantt-icon.png"
        alt=""
        width={56}
        height={56}
        className="h-12 w-12"
        priority
      />
      <h1 className="mt-6 font-heading text-3xl font-bold text-white">QUANTT Hub</h1>
      <p className="mt-2 max-w-sm text-center text-sm text-white/55">
        Invite-only access for members and approved companies.
      </p>
      {/* A plain link, not <Link>: the route handler redirects off-site. */}
      <a
        href="/auth/quantt/start"
        className="mt-10 block w-full max-w-sm rounded-md bg-white px-4 py-2.5 text-center text-sm font-semibold text-navy hover:bg-white/90"
      >
        QUANTT member? Sign in with your Queen&apos;s email
      </a>
      <p className="mt-6 text-xs uppercase tracking-wide text-white/40">Companies</p>
      <form action={login} className="mt-3 w-full max-w-sm space-y-4">
        {errorText && <p className="text-sm text-red-300">{errorText}</p>}
        {reset && (
          <p className="text-sm text-blue-light">
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
      <p className="mt-8 text-sm text-white/60">
        Hiring for your firm?{" "}
        <Link href="/join" className="text-blue-light hover:text-white">
          Request access
        </Link>
      </p>
    </div>
  );
}
