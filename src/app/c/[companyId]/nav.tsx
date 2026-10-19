"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FOCUS } from "@/app/_components/focus";

export type NavLink = { href: string; label: string };

/** Section links of a company; the current one is marked for assistive technologies. */
export function CompanyNav({ links, label }: { links: NavLink[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="mb-6 flex flex-wrap gap-x-4 gap-y-2 border-b border-stone-200 pb-3 text-sm dark:border-stone-800">
      {links.map((link, index) => {
        const current = index === 0 ? pathname === link.href : pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={current ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-md px-2 py-2 ${FOCUS} ${current ? "font-semibold underline decoration-2 underline-offset-4" : "text-stone-700 hover:underline dark:text-stone-300"}`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
