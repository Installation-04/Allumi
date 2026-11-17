"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "@/platform/i18n/client";
import { SEARCH_KINDS, SEARCH_SUGGESTION_DELAY, SEARCH_SUGGESTION_LIMIT, suggestionQuery, type SearchSuggestion } from "@/modules/search/client";
import { FOCUS } from "./focus";

function readRows(value: unknown, base: string): SearchSuggestion[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows) || value.rows.length > SEARCH_SUGGESTION_LIMIT) throw new Error("response");
  return value.rows.map((row: unknown) => {
    if (!row || typeof row !== "object") throw new Error("response");
    const item = row as SearchSuggestion;
    if (typeof item.id !== "string" || !SEARCH_KINDS.includes(item.kind) || (item.label !== null && typeof item.label !== "string") || typeof item.href !== "string" || /[\\\u0000-\u001f\u007f]/.test(item.href)) throw new Error("response");
    const url = new URL(item.href, "https://allumi.invalid");
    if (url.origin !== "https://allumi.invalid" || !item.href.startsWith(`${base}/`) || !url.pathname.startsWith(`${base}/`)) throw new Error("destination");
    return item;
  });
}

function SearchControl({ companyId }: { companyId: string }) {
  const t = useTranslations("companySearch"), router = useRouter(), id = useId(), base = `/c/${companyId}`;
  const [query, setQuery] = useState(""), [rows, setRows] = useState<SearchSuggestion[]>([]), [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1), [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null), controller = useRef<AbortController | null>(null), sequence = useRef(0), focused = useRef(false);
  const cancel = () => { sequence.current++; if (timer.current) clearTimeout(timer.current); controller.current?.abort(); };
  const close = () => { cancel(); setOpen(false); setRows([]); setActive(-1); setStatus("idle"); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); controller.current?.abort(); sequence.current++; }, []);

  useEffect(() => { if (open && active >= 0) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" }); }, [active, open, id]);

  function lookup(value: string) {
    cancel(); setRows([]); setActive(-1); setStatus("idle");
    let term: string;
    try { term = suggestionQuery(value); } catch { setOpen(false); return; }
    if (!term) { setOpen(false); return; }
    setOpen(true); const request = sequence.current;
    timer.current = setTimeout(async () => {
      const abort = new AbortController(); controller.current = abort; setStatus("loading");
      try {
        const response = await fetch(`${base}/recherche/suggestions?${new URLSearchParams({ q: term })}`, { cache: "no-store", credentials: "same-origin", redirect: "error", signal: abort.signal });
        if (!response.ok) throw new Error("response");
        const next = readRows(await response.json(), base);
        if (request !== sequence.current || !focused.current) return;
        setRows(next); setStatus("ready");
      } catch {
        if (request === sequence.current && focused.current && !abort.signal.aborted) { setRows([]); setStatus("error"); }
      }
    }, SEARCH_SUGGESTION_DELAY);
  }
  const visible = open && (rows.length > 0 || status === "loading" || status === "error" || status === "ready");
  return <form action={`${base}/recherche`} method="get" role="search" aria-label={t("title")} onSubmit={close}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { focused.current = false; close(); } }}
    className="relative flex w-full min-w-0 items-center gap-2 lg:w-auto lg:min-w-56 lg:flex-1 lg:max-w-sm">
    <input name="q" type="search" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={visible}
      aria-controls={visible ? `${id}-list` : undefined} aria-activedescendant={visible && active >= 0 ? `${id}-${active}` : undefined}
      aria-describedby={visible ? `${id}-help` : `${id}-start`} maxLength={120} autoComplete="off" aria-label={t("query")} placeholder={t("shortPlaceholder")} value={query}
      onFocus={() => { focused.current = true; lookup(query); }} onChange={event => { setQuery(event.target.value); lookup(event.target.value); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") { event.preventDefault(); close(); }
        else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && rows.length) { event.preventDefault(); setOpen(true); setActive(index => event.key === "ArrowDown" ? (index + 1) % rows.length : (index <= 0 ? rows.length - 1 : index - 1)); }
        else if (event.key === "Enter" && visible && active >= 0 && rows[active]) { event.preventDefault(); const href = rows[active].href; close(); setQuery(""); router.push(href); }
      }} className={`min-h-11 min-w-0 w-full rounded border border-stone-300 bg-white px-3 text-sm dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`} />
    <span id={`${id}-start`} className="sr-only">{t("suggestionsStart")}</span>
    <button type="submit" aria-label={t("title")} className={`min-h-11 shrink-0 rounded px-2 text-sm underline ${FOCUS}`}>{t("submit")}</button>
    {visible && <div className="absolute inset-x-0 top-full z-50 mt-1 max-h-[60dvh] overflow-y-auto rounded-lg border border-stone-300 bg-white p-1 shadow-lg dark:border-stone-600 dark:bg-stone-900">
      <ul id={`${id}-list`} role="listbox" aria-busy={status === "loading"} aria-label={t("suggestions")} className="min-w-0">
        {rows.map((row, index) => <li key={`${row.kind}:${row.id}`} role="presentation"><Link id={`${id}-${index}`} href={row.href} prefetch={false} role="option" aria-selected={active === index} tabIndex={-1}
          onPointerMove={() => setActive(index)} onClick={() => { close(); setQuery(""); }}
          className={`block min-h-11 min-w-0 rounded px-3 py-2 text-sm [overflow-wrap:anywhere] ${active === index ? "bg-stone-100 dark:bg-stone-700" : "hover:bg-stone-50 dark:hover:bg-stone-800"} ${FOCUS}`}>
          <span className="block text-xs text-stone-600 dark:text-stone-400">{t(`kinds.${row.kind}`)}</span><span className="line-clamp-2">{row.label ?? t("unnumbered")}</span>
        </Link></li>)}
      </ul>
      <p id={`${id}-help`} role="status" className="px-3 py-2 text-xs text-stone-600 dark:text-stone-400">{status === "loading" ? t("suggestionsLoading") : status === "error" ? t("suggestionsError") : rows.length ? t("suggestionsHint") : t("suggestionsEmpty")}</p>
    </div>}
  </form>;
}

export function HeaderSearch({ companyId }: { companyId: string }) {
  const pathname = usePathname();
  return <SearchControl key={`${companyId}:${pathname}`} companyId={companyId} />;
}
