import ConnectBrand from "@/components/ConnectBrand";
import Link from "next/link";
import type { ReactNode } from "react";

export default function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="border-b border-line bg-white">
        <div className="mx-auto max-w-6xl px-4 py-3 sm:px-8 sm:py-4">
          <Link href="/login" className="inline-flex items-center gap-2.5" aria-label="Connect by QUANTT home">
            <ConnectBrand />
          </Link>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 items-center px-4 py-8 sm:px-8 sm:py-12">
        {children}
      </main>
    </div>
  );
}
