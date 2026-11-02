"use client";

import ConnectBrand from "@/components/ConnectBrand";
import SponsorModeToggle from "@/components/SponsorModeToggle";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/actions/auth";
import { buttonClass } from "@/components/Form";

const LINKS = [
  { href: "/admin/invite", label: "Invite" },
  { href: "/admin/people", label: "People" },
  { href: "/admin/companies", label: "Companies" },
  { href: "/admin/tiers", label: "Tiers" },
  { href: "/admin/requests", label: "Requests" },
  { href: "/admin/posts", label: "Posts" },
  { href: "/admin/applications", label: "Applications" },
  { href: "/admin/alumni", label: "Alumni" },
];

export default function AdminNav({ sponsorMode = false }: { sponsorMode?: boolean }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin navigation" className="hub-nav">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-6 py-4 sm:px-8 xl:flex-row xl:items-center xl:justify-between xl:gap-6">
        <Link href="/admin" className="flex shrink-0 items-center gap-2.5 self-start">
          <ConnectBrand admin />
        </Link>
        <div
          className="flex min-w-0 max-w-full items-center gap-5 overflow-x-auto p-1"
          onFocus={(event) => event.target.scrollIntoView({ block: "nearest", inline: "nearest" })}
        >
          {LINKS.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
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
