"use client";

import Image from "next/image";
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
];

export default function AdminNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin navigation" className="sticky top-0 z-50 border-b border-white/10 bg-navy/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
        <Link href="/admin" className="flex shrink-0 items-center gap-2 self-start">
          <Image
            src="/images/logos/quantt-icon.png"
            alt=""
            width={32}
            height={32}
            className="h-7 w-7"
            priority
          />
          <span className="text-[13px] font-bold tracking-[2px] text-white">
            QUANTT
            <span className="ml-1.5 font-normal tracking-wide text-blue-light">Admin</span>
          </span>
        </Link>
        <div
          className="flex min-w-0 max-w-full items-center gap-4 overflow-x-auto p-1"
          onFocus={(event) => event.target.scrollIntoView({ block: "nearest", inline: "nearest" })}
        >
          {LINKS.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`shrink-0 whitespace-nowrap py-2 text-[11px] uppercase tracking-[1px] ${
                  active ? "text-white" : "text-white/55 hover:text-white/80"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
          <div className="ml-1 flex shrink-0 items-center gap-2 border-l border-white/15 pl-4">
            <Link href="/feed" className={buttonClass("nav")}>
              Member hub
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
