"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/actions/auth";
import { buttonClass } from "@/components/Form";
import type { Profile } from "@/lib/types";

type Props = {
  profile: Profile;
  unread?: number;
  /** Granted hub products for a company contact. Member nav ignores this. */
  companyCaps?: string[];
};

export default function HubNav({ profile, unread = 0, companyCaps }: Props) {
  const pathname = usePathname();
  const isCompany = profile.role === "company_user";
  const caps = new Set(companyCaps ?? []);

  const links = isCompany
    ? [
        { href: "/company", label: "Posts" },
        ...(caps.has("read_applicants")
          ? [{ href: "/company/applicants", label: "Applicants" }]
          : []),
        ...(caps.has("resume_book")
          ? [{ href: "/company/resume-book", label: "Resume book" }]
          : []),
        ...(caps.has("candidate_search")
          ? [{ href: "/company/search", label: "Search" }]
          : []),
        { href: "/company/messages", label: "Messages" },
        { href: "/company/sponsorship", label: "Sponsorship" },
      ]
    : [
        { href: "/feed", label: "Feed" },
        { href: "/applications", label: "Applications" },
        { href: "/packages", label: "Packages" },
        { href: "/members", label: "Members" },
        { href: "/messages", label: "Messages" },
        { href: "/profile", label: "Profile" },
      ];

  if (profile.is_admin) {
    links.push({ href: "/admin", label: "Admin" });
  }

  return (
    <nav aria-label="Hub navigation" className="sticky top-0 z-50 border-b border-white/10 bg-navy/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
        <Link href={isCompany ? "/company" : "/feed"} className="flex shrink-0 items-center gap-2 self-start">
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
            <span className="ml-1.5 font-normal tracking-wide text-white/60">Hub</span>
          </span>
        </Link>
        <div
          className="flex min-w-0 max-w-full items-center gap-4 overflow-x-auto p-1"
          onFocus={(event) => event.target.scrollIntoView({ block: "nearest", inline: "nearest" })}
        >
          {links.map((link) => {
            const active =
              link.href === "/company"
                ? pathname === "/company" || pathname.startsWith("/company/posts")
                : pathname === link.href || pathname.startsWith(`${link.href}/`);
            const showBadge = link.label === "Messages" && unread > 0;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`relative shrink-0 whitespace-nowrap py-2 text-[11px] uppercase tracking-[1px] ${
                  active ? "text-white" : "text-white/55 hover:text-white/80"
                }`}
              >
                {link.label}
                {showBadge && (
                  <>
                    <span aria-hidden="true" className="absolute -right-2 top-1 h-1.5 w-1.5 rounded-full bg-blue-light" />
                    <span className="sr-only"> ({unread} unread conversations)</span>
                  </>
                )}
              </Link>
            );
          })}
          <form action={logout} className="ml-1 shrink-0 border-l border-white/15 pl-4">
            <button type="submit" className={buttonClass("nav")}>
              Log out
            </button>
          </form>
        </div>
      </div>
    </nav>
  );
}
