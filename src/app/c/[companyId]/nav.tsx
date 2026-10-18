"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FOCUS } from "@/app/_components/focus";
import { Icon, type IconName } from "@/app/_components/icon";

export type NavLink = { href: string; label: string; icon: IconName };

export function CompanyNav({ links, label }: { links: NavLink[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="flex gap-1 overflow-x-auto p-2 lg:flex-col lg:overflow-visible lg:p-3">
      {links.map((link, index) => {
        const current = index === 0 ? pathname === link.href : pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link key={link.href} href={link.href} aria-current={current ? "page" : undefined}
            className={`flex min-h-11 shrink-0 items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors ${FOCUS} ${current ? "bg-brand-50 font-semibold text-brand-800 dark:bg-brand-800 dark:text-white" : "text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800"}`}>
            <Icon name={link.icon} /><span>{link.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
