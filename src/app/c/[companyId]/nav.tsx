"use client";

import Link from "next/link";
import { matchesNavigationPath } from "./navigation-groups";
import { usePathname } from "next/navigation";
import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FOCUS } from "@/app/_components/focus";
import { Icon, type IconName } from "@/app/_components/icon";

export type NavLink = { href: string; label: string; shortLabel?: string; icon: IconName };

export type NavGroup = { href: string; links: NavLink[] };

export function CompanyNav({ links, desktopLinks = links, groups = [], label, tabs = false }: { links: NavLink[]; desktopLinks?: NavLink[]; groups?: NavGroup[]; label: string; tabs?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const menuId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const t = useTranslations("nav");
  const activeGroup = groups.find(group => matchesNavigationPath(pathname, group.href) || group.links.some(link => matchesNavigationPath(pathname, link.href)));
  const current = (link: NavLink) => link.href === activeGroup?.href || (link === links[0] ? pathname === link.href : matchesNavigationPath(pathname, link.href));
  const close = () => { setOpen(false); setQuery(""); toggle.current?.focus(); };
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  const results = links.filter(link => words.every(word => normalize(`${link.label} ${link.shortLabel ?? ""}`).includes(word)));
  const search = (mode: "desktop" | "panel") => <div className="space-y-2 px-4 py-3">
    <label className={`block text-xs font-semibold ${mode === "desktop" ? "text-stone-200" : "text-stone-700 dark:text-stone-200"}`}>
      {t("search")}
      <input type="search" value={query} onChange={event => setQuery(event.target.value)} className={`mt-2 min-h-11 w-full rounded border border-stone-400 bg-white px-3 text-sm text-stone-900 dark:border-stone-600 dark:bg-stone-900 dark:text-white ${FOCUS}`} />
    </label>
    {query && <button type="button" onClick={() => setQuery("")} className={`min-h-11 text-sm underline ${mode === "desktop" ? "text-stone-200" : "text-stone-700 dark:text-stone-200"} ${FOCUS}`}>{t("clearSearch")}</button>}
    <p role={words.length > 0 ? "status" : undefined} aria-live="polite" className={`text-xs ${mode === "desktop" ? "text-stone-200" : "text-stone-600 dark:text-stone-300"}`}>{words.length > 0 ? results.length ? t("searchCount", { count: results.length }) : t("searchEmpty") : ""}</p>
  </div>;
  const item = (link: NavLink, mode: "desktop" | "mobile" | "panel") => <Link key={link.href} href={link.href} aria-label={link.label} aria-current={current(link) ? "page" : undefined} onClick={() => { setOpen(false); setQuery(""); }}
    className={`flex min-h-11 min-w-0 items-center gap-3 ${FOCUS} ${mode === "mobile" ? "min-h-16 flex-col justify-center gap-1 px-1 py-2 text-center text-[11px]" : "px-5 py-3 text-sm"} ${current(link) ? mode === "desktop" ? "border-l-3 border-brand-500 bg-black/40 font-semibold text-white" : "bg-brand-50 font-semibold text-brand-800 dark:bg-brand-800 dark:text-white" : mode === "desktop" ? "text-stone-200 hover:bg-black/20" : "text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800"}`}>
    <Icon name={link.icon} className="h-4 w-4 shrink-0" /><span>{mode === "mobile" ? link.shortLabel ?? link.label : link.label}</span>
  </Link>;
  if (tabs) {
    if (!activeGroup?.links.length) return null;
    return <nav aria-label={label} className="hidden gap-5 overflow-x-auto border-b border-stone-200 bg-white px-6 dark:border-stone-800 dark:bg-stone-900 lg:flex">{activeGroup.links.map(link => <Link key={link.href} href={link.href} aria-current={matchesNavigationPath(pathname, link.href) ? "page" : undefined} className={`flex min-h-12 shrink-0 items-center border-b-3 px-1 text-sm ${FOCUS} ${matchesNavigationPath(pathname, link.href) ? "border-brand-700 font-semibold" : "border-transparent text-stone-500 dark:text-stone-400"}`}>{link.label}</Link>)}</nav>;
  }
  return <nav aria-label={label} onKeyDown={(event) => { if (event.key === "Escape" && open) { event.preventDefault(); close(); } }} className="mobile-navigation fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900 lg:static lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:border-0 lg:bg-transparent lg:dark:bg-transparent">
    <div className="hidden lg:block">{search("desktop")}{(words.length > 0 ? results : desktopLinks).map((link) => item(link, "desktop"))}</div>
    <div className="lg:hidden">
      {open && <div id={menuId} className="max-h-[65dvh] overflow-y-auto border-b border-stone-200 dark:border-stone-800"><div className="flex items-center justify-between px-5"><h2 className="font-semibold text-stone-900 dark:text-white">{t("menu")}</h2><button type="button" onClick={close} className={`min-h-11 px-3 text-sm text-stone-700 dark:text-stone-200 ${FOCUS}`}>{t("closeMenu")}</button></div>{search("panel")}{(words.length > 0 ? results : links.slice(3)).map((link) => item(link, "panel"))}</div>}
      <div className="grid grid-cols-4">{links.slice(0, 3).map((link) => item(link, "mobile"))}<button ref={toggle} type="button" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => { setQuery(""); setOpen(!open); }} className={`flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-[11px] ${FOCUS} ${links.slice(3).some(current) ? "bg-brand-50 font-semibold text-brand-800 dark:bg-brand-800 dark:text-white" : "text-stone-700 dark:text-stone-200"}`}><span aria-hidden="true" className="text-lg">☰</span>{t("menu")}</button></div>
    </div>
  </nav>;
}
