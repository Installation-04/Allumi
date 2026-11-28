"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "@/platform/i18n/client";
import { PROJECT_CUSTOMER_LIMIT, projectCustomerQuery, type ProjectCustomerChoice } from "@/modules/projects/client";
import { FOCUS } from "@/app/_components/focus";
export function ProjectCustomerLookup({ companyId, onSelect }: {
    companyId: string;
    onSelect: (row: ProjectCustomerChoice) => void;
}) {
    const t = useTranslations("projects"), id = useId(), { pending } = useFormStatus();
    const [query, setQuery] = useState(""), [rows, setRows] = useState<ProjectCustomerChoice[]>([]), [hasMore, setHasMore] = useState(false);
    const [status, setStatus] = useState<"idle" | "loading" | "ready" | "invalid" | "unavailable" | "selected">("idle");
    const request = useRef<AbortController | null>(null);
    useEffect(() => () => request.current?.abort(), []);
    const clear = () => { request.current?.abort(); request.current = null; setRows([]); setHasMore(false); };
    const search = async () => {
        if (pending || status === "loading")
            return;
        clear();
        let q: string;
        try {
            q = projectCustomerQuery(query);
        }
        catch {
            setStatus("invalid");
            return;
        }
        const controller = new AbortController();
        request.current = controller;
        setStatus("loading");
        try {
            const response = await fetch(`/c/${companyId}/projets/clients?${new URLSearchParams({ q })}`, { credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal, headers: { Accept: "application/json" } });
            if (!response.ok)
                throw new Error("customer lookup");
            const data: {
                rows: ProjectCustomerChoice[];
                hasMore: boolean;
            } = await response.json();
            if (!Array.isArray(data.rows) || data.rows.length > PROJECT_CUSTOMER_LIMIT || typeof data.hasMore !== "boolean" || data.rows.some(row => !row || typeof row.id !== "string" || typeof row.displayName !== "string"))
                throw new Error("customer response");
            if (request.current !== controller || controller.signal.aborted)
                return;
            setRows(data.rows);
            setHasMore(data.hasMore);
            setStatus("ready");
        }
        catch {
            if (request.current === controller && !controller.signal.aborted)
                setStatus("unavailable");
        }
    };
    return <fieldset disabled={pending} className="space-y-3 rounded border border-stone-300 p-4 dark:border-stone-700">
    <legend className="px-1 font-semibold">{t("customerLookup")}</legend>
    <p id={`${id}-hint`} className="text-sm">{t("customerLookupHint")}</p>
    <label htmlFor={id} className="block text-sm font-medium">{t("customerSearch")}</label>
    <div className="flex flex-wrap gap-2"><input id={id} type="search" value={query} maxLength={120} autoComplete="off" aria-describedby={`${id}-hint`} onChange={event => { clear(); setQuery(event.target.value); setStatus("idle"); }} onKeyDown={event => { if (event.key === "Enter") {
        event.preventDefault();
        void search();
    } }} className={`min-h-11 min-w-0 flex-1 rounded border bg-white px-3 py-2 text-base dark:bg-stone-900 ${FOCUS}`}/>
      <button type="button" disabled={status === "loading"} onClick={() => void search()} className={`min-h-11 rounded border px-4 disabled:opacity-60 ${FOCUS}`}>{t("customerFind")}</button></div>
    <div role="status" aria-live="polite" className="text-sm">
      {status === "loading" && t("customerLoading")}{status === "invalid" && t("customerQueryHint")}{status === "unavailable" && t("customerUnavailable")}{status === "selected" && t("customerSelected")}{status === "ready" && rows.length === 0 && t("customerEmpty")}{status === "ready" && hasMore && t("customerMore")}
    </div>
    {rows.length > 0 && <ul aria-label={t("customerResults")} className="space-y-2">{rows.map(row => <li key={row.id}><button type="button" onClick={() => { clear(); onSelect(row); setStatus("selected"); }} className={`min-h-11 w-full rounded border p-3 text-left break-words [overflow-wrap:anywhere] ${FOCUS}`}><span className="block font-semibold">{t("customerUse", { name: row.displayName })}</span></button></li>)}</ul>}
  </fieldset>;
}
