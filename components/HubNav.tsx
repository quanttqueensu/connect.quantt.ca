"use client";

import ConnectBrand from "@/components/ConnectBrand";
import SponsorModeToggle from "@/components/SponsorModeToggle";
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
  sponsorMode?: boolean;
};

export default function HubNav({ profile, unread = 0, companyCaps, sponsorMode = false }: Props) {
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
        { href: "/members", label: "Members" },
        { href: "/messages", label: "Messages" },
        { href: "/profile", label: "Profile" },
      ];

  if (profile.is_admin) {
    links.push({ href: "/admin", label: "Admin" });
  }

  return (
    <nav aria-label="Connect navigation" className="hub-nav">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-6 py-4 sm:px-8 xl:flex-row xl:items-center xl:justify-between xl:gap-6">
        <Link href={isCompany ? "/company" : "/feed"} className="flex shrink-0 items-center gap-2.5 self-start">
          <ConnectBrand />
        </Link>
        <div
          className="flex min-w-0 max-w-full items-center gap-5 overflow-x-auto p-1"
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
                className="hub-nav-link relative"
              >
                {link.label}
                {showBadge && (
                  <>
                    <span aria-hidden="true" className="absolute -right-2 top-1 h-1.5 w-1.5 rounded-full bg-primary" />
                    <span className="sr-only"> ({unread} unread conversations)</span>
                  </>
                )}
              </Link>
            );
          })}
          {profile.is_admin && !sponsorMode && <SponsorModeToggle />}
          <form action={logout} className="ml-1 shrink-0 border-l border-line pl-4">
            <button type="submit" className={buttonClass("nav")}>
              Log out
            </button>
          </form>
        </div>
      </div>
    </nav>
  );
}
