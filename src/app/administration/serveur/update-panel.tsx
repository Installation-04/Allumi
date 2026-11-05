"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { compareVersions, type UpdateStatusDetails } from "@/modules/updates/client";
import { ActionForm } from "@/app/_components/ui";
import { FOCUS } from "@/app/_components/focus";
import { updateServerAction } from "@/app/versions/actions";

type Overview = { currentVersion: string; release: { tag: string; url: string } | null; unavailable: boolean; status: UpdateStatusDetails };

export function ServerUpdatePanel({ overview }: { overview: Overview }) {
  const t = useTranslations("updates");
  const router = useRouter();
  const pathname = usePathname();
  const [refreshing, startRefresh] = useTransition();
  const [generation, setGeneration] = useState(0);
  const [connection, setConnection] = useState<"online" | "reconnecting" | "restored" | "paused" | "denied">("online");
  const [snapshot, setSnapshot] = useState({ currentVersion: overview.currentVersion, status: overview.status });
  const [previousOverview, setPreviousOverview] = useState(overview);
  if (previousOverview !== overview) {
    setPreviousOverview(overview);
    setSnapshot({ currentVersion: overview.currentVersion, status: overview.status });
    setConnection("online");
  }
  useEffect(() => {
    if (overview.status.state !== "pending" && overview.status.state !== "running") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const deadline = Date.now() + 10 * 60 * 1000;
    async function poll() {
      if (cancelled) return;
      if (Date.now() >= deadline) { setConnection("paused"); return; }
      controller = new AbortController();
      timeout = setTimeout(() => controller?.abort(), 8000);
      try {
        const response = await fetch("/administration/serveur/mises-a-jour/etat", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
        if (response.status === 401 || response.status === 403 || response.redirected) { if (!cancelled) setConnection("denied"); return; }
        if (!response.ok) throw new Error("status");
        const data = await response.json() as { currentVersion: string; status: UpdateStatusDetails };
        if (cancelled) return;
        setSnapshot(data);
        setConnection(previous => previous === "reconnecting" ? "restored" : previous);
        if (data.status.state !== "pending" && data.status.state !== "running") { router.refresh(); return; }
      } catch {
        if (!cancelled) setConnection("reconnecting");
      } finally {
        clearTimeout(timeout);
      }
      if (!cancelled) timer = setTimeout(poll, 5000);
    }
    timer = setTimeout(poll, 5000);
    return () => { cancelled = true; clearTimeout(timer); clearTimeout(timeout); controller?.abort(); };
  }, [overview.status.state, overview.status.requestId, generation, router]);
  const { status, currentVersion } = snapshot;
  const busy = status.state === "pending" || status.state === "running";
  const newer = overview.release && compareVersions(overview.release.tag, currentVersion) > 0;
  const mayUpdate = newer && !overview.unavailable && !busy && status.state !== "disabled";
  const check = () => { setGeneration(value => value + 1); startRefresh(() => router.refresh()); };
  return <section id="server-updates" aria-labelledby="server-updates-title" className="space-y-4 rounded-lg border-2 border-green-700 bg-white p-5 dark:border-green-500 dark:bg-stone-900">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="server-updates-title" className="text-xl font-semibold">{t("server")}</h2><button type="button" onClick={check} disabled={refreshing} className={`min-h-11 rounded border border-stone-400 px-4 text-sm font-semibold disabled:opacity-60 dark:border-stone-600 ${FOCUS}`}>{t(refreshing ? "checking" : "check")}</button></div>
    <p className="font-semibold">{t("current", { version: currentVersion })}</p>
    <p>{t("web")}</p>
    <p role="status">{overview.unavailable ? t("unavailable") : overview.release ? t(newer ? "available" : "upToDate", { version: overview.release.tag }) : t("noRelease")}</p>
    {overview.release && <Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={overview.release.url}>{t("releaseNotes")}</Link>}
    <div className="space-y-2 rounded border border-stone-300 p-4 dark:border-stone-700" aria-live="polite">
      <p className="font-medium">{t(`status.${status.state}`)}</p>
      {status.stage && <p>{t(`stages.${status.stage}`)}</p>}
      {status.target && <p className="break-words">{t("target", { version: status.target })}</p>}
      {status.fromVersion && <p className="break-words">{t("fromVersion", { version: status.fromVersion })}</p>}
      {status.requestedAt && <p className="text-sm">{t("requestedAt", { date: status.requestedAt })}</p>}
      {status.updatedAt && <p className="text-sm">{t("updatedAt", { date: status.updatedAt })}</p>}
      {status.state === "failed" && <p className="text-red-800 dark:text-red-300">{t("failure", { reason: t(`failures.${status.failureCode ?? "unknown"}`) })}</p>}
      {busy && connection !== "paused" && connection !== "denied" && <p className="text-sm">{t("polling")}</p>}
      {connection !== "online" && <p>{t(connection === "reconnecting" ? "reconnecting" : connection === "restored" ? "reconnected" : connection === "paused" ? "paused" : "accessLost")}</p>}
      {(connection === "paused" || connection === "reconnecting" || connection === "denied") && <a className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={pathname}>{t("reopen")}</a>}
    </div>
    {status.state === "disabled" ? <div className="space-y-2"><p>{t("enableHint")}</p><button type="button" disabled className="min-h-11 rounded bg-green-700 px-4 text-sm font-semibold text-white opacity-50">{t("install")}</button><code className="block break-all rounded bg-stone-100 p-3 text-base dark:bg-stone-800">sudo ./scripts/enable-web-updates.sh</code></div> : mayUpdate && overview.release ? <ActionForm action={updateServerAction} label={t("install")}>
      <input type="hidden" name="target" value={overview.release.tag} />
      <label className="flex min-h-11 items-start gap-3"><input className="mt-1 h-5 w-5 shrink-0" type="checkbox" name="confirm" value="yes" required />{t("confirm")}</label>
    </ActionForm> : <div className="space-y-2"><button type="button" disabled className="min-h-11 rounded bg-green-700 px-4 text-sm font-semibold text-white opacity-50">{t("install")}</button>{!busy && !overview.unavailable && !newer && <p className="text-sm">{t("noUpdate")}</p>}</div>}
    <Link href="https://github.com/Installation-04/Allumi/wiki/Mise-a-jour" className={`inline-flex min-h-11 items-center underline ${FOCUS}`}>{t("guide")}</Link>
  </section>;
}
