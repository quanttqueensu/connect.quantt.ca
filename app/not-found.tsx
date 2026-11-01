import Link from "next/link";
import { buttonClass } from "@/components/Form";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-5 py-20">
      <p className="text-xs uppercase tracking-wider text-primary">404</p>
      <h1 className="mt-2 font-heading text-2xl font-bold text-ink">Not found</h1>
      <p className="mt-4 text-sm text-copy">
        That page doesn&apos;t exist, or you don&apos;t have access to it.
      </p>
      <Link href="/" className={buttonClass("primary", "mt-8")}>
        Go home
      </Link>
    </div>
  );
}
