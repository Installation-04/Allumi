"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FOCUS } from "@/app/_components/focus";
import { Icon, type IconName } from "@/app/_components/icon";

export type NavLink = { href: string; label: string; icon: IconName };

export function CompanyNav({ links, label, tabs = false }: { links: NavLink[]; label: string; tabs?: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className={tabs ? "hidden gap-5 overflow-x-auto border-b border-stone-200 bg-white px-6 dark:border-stone-800 dark:bg-stone-900 lg:flex" : "mobile-navigation fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900 lg:static lg:flex lg:flex-col lg:border-0 lg:bg-transparent lg:dark:bg-transparent"}>
      {links.map((link, index) => {
        const current = index === 0 ? pathname === link.href : pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link key={link.href} href={link.href} aria-current={current ? "page" : undefined}
            className={tabs
              ? `flex min-h-12 shrink-0 items-center border-b-3 px-1 text-xs ${FOCUS} ${current ? "border-brand-700 font-semibold text-stone-950 dark:text-white" : "border-transparent text-stone-500 hover:text-brand-700 dark:text-stone-400"}`
              : `flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 border-t-3 px-1 py-2 text-center text-[10px] leading-tight focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-brand-700 lg:min-h-11 lg:flex-row lg:justify-start lg:gap-3 lg:border-t-0 lg:border-l-3 lg:px-5 lg:py-3 lg:text-left lg:text-sm lg:focus-visible:outline-white ${current ? "border-brand-600 bg-brand-50 font-semibold text-brand-800 dark:bg-brand-800 dark:text-white lg:border-brand-500 lg:bg-black/40 lg:text-white lg:dark:bg-black/40" : "border-transparent text-stone-600 hover:bg-stone-100 dark:text-stone-300 lg:text-stone-200 lg:hover:bg-black/20"}`}>
            {!tabs && <Icon name={link.icon} className="h-4 w-4 shrink-0" />}<span>{link.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
