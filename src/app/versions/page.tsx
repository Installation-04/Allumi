import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/app/_lib/session";
import { getProfile } from "@/modules/auth";
import { latestRelease, updateStatus, compareVersions } from "@/modules/updates";
import { appVersion } from "@/platform/version";
import { ActionForm } from "@/app/_components/ui";
import { updateServerAction } from "./actions";

export default async function VersionsPage() {
  const session = await requireSession();
  const profile = await getProfile(session.userId);
  const t = await getTranslations("updates");
  const current = appVersion();
  let release = null;
  let unavailable = false;
  try { release = await latestRelease(); } catch { unavailable = true; }
  const newer = release && compareVersions(release.tag, current) > 0;
  const status = (profile?.isInstanceAdmin || profile?.canManageServer) ? await updateStatus() : "disabled";
  return <section className="mx-auto max-w-2xl space-y-5 p-4">
    <Link className="inline-flex min-h-11 items-center underline" href="/">{t("back")}</Link>
    <h1 className="text-2xl font-semibold">{t("title")}</h1>
    <p>{t("current", { version: current })}</p>
    <p>{t("web")}</p>
    <p role="status">{unavailable ? t("unavailable") : release ? t(newer ? "available" : "upToDate", { version: release.tag }) : t("noRelease")}</p>
    <Link className="inline-flex min-h-11 items-center underline" href={release?.url ?? "https://github.com/Installation-04/Allumi/releases"}>{t("downloads")}</Link>
    {(profile?.isInstanceAdmin || profile?.canManageServer) && <div className="space-y-4 rounded-lg border border-stone-200 p-5 dark:border-stone-700">
      <h2 className="font-semibold">{t("server")}</h2><p>{t(`status.${status as "disabled" | "pending" | "running" | "success" | "failed" | "ready"}`)}</p>
      {newer && release && status !== "disabled" && status !== "pending" && status !== "running" && <ActionForm action={updateServerAction} label={t("install")}>
        <input type="hidden" name="target" value={release.tag} />
        <label className="flex items-start gap-3 text-sm"><input className="mt-1 h-5 w-5 shrink-0" type="checkbox" name="confirm" value="yes" required />{t("confirm")}</label>
      </ActionForm>}
      <Link className="inline-flex min-h-11 items-center underline" href="https://github.com/Installation-04/Allumi/wiki/Mise-a-jour">{t("guide")}</Link>
    </div>}
  </section>;
}
