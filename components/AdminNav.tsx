"use client";

import ConnectBrand from "@/components/ConnectBrand";
import SponsorModeToggle from "@/components/SponsorModeToggle";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/actions/auth";
import { buttonClass } from "@/components/Form";

// Invites and alumni live on People; join requests and tiers on Companies.
const LINKS = [
  { href: "/admin/people", label: "People" },
  { href: "/admin/companies", label: "Companies" },
  { href: "/admin/posts", label: "Posts" },
  { href: "/admin/applications", label: "Applications" },
];

export default function AdminNav({ sponsorMode = false }: { sponsorMode?: boolean }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin navigation" className="hub-nav">
      <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-2.5 sm:px-8 sm:py-3 xl:flex-row xl:items-center xl:justify-between xl:gap-6">
        <Link href="/admin" className="flex shrink-0 items-center gap-2.5 self-start">
          <ConnectBrand admin />
        </Link>
        <div
          className="flex min-w-0 max-w-full items-center gap-5 overflow-x-auto p-1"
          onFocus={(event) => event.target.scrollIntoView({ block: "nearest", inline: "nearest" })}
        >
          {LINKS.map((link) => {
            const active =
              pathname === link.href ||
              pathname.startsWith(`${link.href}/`) ||
              (link.href === "/admin/companies" && pathname.startsWith("/admin/tiers"));
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className="hub-nav-link relative"
              >
                {link.label}
              </Link>
            );
          })}
          <div className="ml-1 flex shrink-0 items-center gap-2 border-l border-line pl-4">
            {!sponsorMode && <SponsorModeToggle />}
            <Link href="/feed" className={buttonClass("nav")}>
              Member area
            </Link>
            <form action={logout}>
              <button type="submit" className={buttonClass("nav")}>
                Log out
              </button>
            </form>
          </div>
        </div>
      </div>
    </nav>
  );
}
