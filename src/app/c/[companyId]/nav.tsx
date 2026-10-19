"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FOCUS } from "@/app/_components/focus";
import { Icon, type IconName } from "@/app/_components/icon";

export type NavLink = { href: string; label: string; shortLabel?: string; icon: IconName };

export function CompanyNav({ links, label, tabs = false }: { links: NavLink[]; label: string; tabs?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const t = useTranslations("nav");
  const current = (link: NavLink) => link === links[0] ? pathname === link.href : pathname === link.href || pathname.startsWith(`${link.href}/`);
  const close = () => { setOpen(false); toggle.current?.focus(); };
  const item = (link: NavLink, mode: "desktop" | "mobile" | "panel") => <Link key={link.href} href={link.href} aria-label={link.label} aria-current={current(link) ? "page" : undefined} onClick={() => setOpen(false)}
    className={`flex min-h-11 min-w-0 items-center gap-3 ${FOCUS} ${mode === "mobile" ? "min-h-16 flex-col justify-center gap-1 px-1 py-2 text-center text-[11px]" : "px-5 py-3 text-sm"} ${current(link) ? mode === "desktop" ? "border-l-3 border-brand-500 bg-black/40 font-semibold text-white" : "bg-brand-50 font-semibold text-brand-800 dark:bg-brand-800 dark:text-white" : mode === "desktop" ? "text-stone-200 hover:bg-black/20" : "text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800"}`}>
    <Icon name={link.icon} className="h-4 w-4 shrink-0" /><span>{mode === "mobile" ? link.shortLabel ?? link.label : link.label}</span>
  </Link>;
  if (tabs) return <nav aria-label={label} className="hidden gap-5 overflow-x-auto border-b border-stone-200 bg-white px-6 dark:border-stone-800 dark:bg-stone-900 lg:flex">{links.map((link) => <Link key={link.href} href={link.href} aria-current={current(link) ? "page" : undefined} className={`flex min-h-12 shrink-0 items-center border-b-3 px-1 text-xs ${FOCUS} ${current(link) ? "border-brand-700 font-semibold" : "border-transparent text-stone-500"}`}>{link.label}</Link>)}</nav>;
  return <nav aria-label={label} onKeyDown={(event) => { if (event.key === "Escape" && open) { event.preventDefault(); close(); } }} className="mobile-navigation fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900 lg:static lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:border-0 lg:bg-transparent lg:dark:bg-transparent">
    <div className="hidden lg:block">{links.map((link) => item(link, "desktop"))}</div>
    <div className="lg:hidden">
      {open && <div id={menuId} className="max-h-[65dvh] overflow-y-auto border-b border-stone-200 dark:border-stone-800"><div className="flex items-center justify-between px-5"><h2 className="font-semibold text-stone-900 dark:text-white">{t("menu")}</h2><button type="button" onClick={close} className={`min-h-11 px-3 text-sm text-stone-700 dark:text-stone-200 ${FOCUS}`}>{t("closeMenu")}</button></div>{links.slice(3).map((link) => item(link, "panel"))}</div>}
      <div className="grid grid-cols-4">{links.slice(0, 3).map((link) => item(link, "mobile"))}<button ref={toggle} type="button" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen(!open)} className={`flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-[11px] ${FOCUS} ${links.slice(3).some(current) ? "bg-brand-50 font-semibold text-brand-800 dark:bg-brand-800 dark:text-white" : "text-stone-700 dark:text-stone-200"}`}><span aria-hidden="true" className="text-lg">☰</span>{t("menu")}</button></div>
    </div>
  </nav>;
}
