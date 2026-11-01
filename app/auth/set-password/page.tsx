import Image from "next/image";
import { redirect } from "next/navigation";
import AwaitInviteSession from "@/components/AwaitInviteSession";
import { Field, PrimaryButton, TextInput } from "@/components/Form";
import { setPassword } from "@/lib/actions/auth";
import { userNeedsPassword } from "@/lib/auth-session";
import { DENIAL_MESSAGES } from "@/lib/denials";
import { createClient } from "@/lib/supabase/server";
import PublicShell from "@/components/PublicShell";

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <AwaitInviteSession />;
  }

  if (user.app_metadata?.must_set_password === false) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    redirect(profile?.role === "company_user" ? "/company" : "/feed");
  }

  const { error } = await searchParams;
  const errorText = error ? DENIAL_MESSAGES[error] : undefined;
  const invited = userNeedsPassword(user);

  return (
    <PublicShell>
      <div className="mx-auto flex w-full max-w-lg flex-col items-center rounded border border-line bg-white p-6 sm:p-10">
        <Image
          src="/images/logos/quantt-icon.png"
          alt=""
          width={56}
          height={56}
          className="h-12 w-12"
          priority
        />
        <h1 className="mt-6 text-center font-heading text-3xl font-semibold text-ink">Create your password</h1>
        <p className="mt-2 max-w-sm text-center text-sm text-muted">
          You&apos;re almost in. Choose a password to finish setting up your Connect account.
        </p>
        <form action={setPassword} className="mt-10 w-full max-w-sm space-y-4">
          {errorText && <p className="text-sm text-red-700">{errorText}</p>}
          {!invited && (
            <p className="text-sm text-copy">
              Use this form to choose the password you&apos;ll log in with.
            </p>
          )}
          <Field label="Password">
            <TextInput
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Confirm password">
            <TextInput
              name="confirm"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </Field>
          <PrimaryButton type="submit">Save password</PrimaryButton>
        </form>
      </div>
    </PublicShell>
  );
}
