"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import ConnectBrand from "@/components/ConnectBrand";
import { buttonClass } from "@/components/Form";
import { alumniLogout } from "@/lib/actions/alumni";

const LINKS = [
  { href: "/alumni", label: "Opportunities" },
  { href: "/alumni/members", label: "Members" },
  { href: "/alumni/directory", label: "Alumni" },
  { href: "/alumni/messages", label: "Messages" },
  { href: "/alumni/discord", label: "Discord" },
  { href: "/alumni/profile", label: "Profile" },
];

export default function AlumniNav({ unread = 0 }: { unread?: number }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Alumni navigation" className="hub-nav">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-6 py-4 sm:px-8 xl:flex-row xl:items-center xl:justify-between xl:gap-6">
        <Link href="/alumni" className="flex shrink-0 items-center gap-2.5 self-start">
          <ConnectBrand />
          <span className="ml-1 border-l border-line pl-3 text-xs text-copy">Alumni</span>
        </Link>
        <div className="flex min-w-0 max-w-full items-center gap-5 overflow-x-auto p-1">
          {LINKS.map((link) => {
            const active = link.href === "/alumni" ? pathname === "/alumni" : pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined} className="hub-nav-link relative">
                {link.label}
                {link.label === "Messages" && unread > 0 && (
                  <>
                    <span aria-hidden="true" className="absolute -right-2 top-1 h-1.5 w-1.5 rounded-full bg-primary" />
                    <span className="sr-only"> ({unread} unread conversations)</span>
                  </>
                )}
              </Link>
            );
          })}
          <form action={alumniLogout} className="ml-1 shrink-0 border-l border-line pl-4">
            <button type="submit" className={buttonClass("nav")}>
              Log out
            </button>
          </form>
        </div>
      </div>
    </nav>
  );
}
