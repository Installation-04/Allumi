import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/app/_lib/session";
import { getProfile } from "@/modules/auth";
import { latestRelease, getUpdateOverview, compareVersions } from "@/modules/updates";
import { appVersion } from "@/platform/version";
import { ServerUpdatePanel } from "@/app/administration/serveur/update-panel";

export default async function VersionsPage() {
  const session = await requireSession();
  const profile = await getProfile(session.userId);
  const t = await getTranslations("updates");
  const mayManage = profile?.isInstanceAdmin || profile?.canManageServer;
  if (mayManage) return <section className="mx-auto max-w-3xl space-y-5 p-4">
    <Link className="inline-flex min-h-11 items-center underline" href="/">{t("back")}</Link>
    <h1 className="text-2xl font-semibold">{t("title")}</h1>
    <ServerUpdatePanel overview={await getUpdateOverview(session.userId)} />
  </section>;
  const current = appVersion();
  let release = null;
  let unavailable = false;
  try { release = await latestRelease(); } catch { unavailable = true; }
  const newer = release && compareVersions(release.tag, current) > 0;
  return <section className="mx-auto max-w-2xl space-y-5 p-4">
    <Link className="inline-flex min-h-11 items-center underline" href="/">{t("back")}</Link>
    <h1 className="text-2xl font-semibold">{t("title")}</h1>
    <p>{t("current", { version: current })}</p>
    <p>{t("web")}</p>
    <p role="status">{unavailable ? t("unavailable") : release ? t(newer ? "available" : "upToDate", { version: release.tag }) : t("noRelease")}</p>
    <Link className="inline-flex min-h-11 items-center underline" href={release?.url ?? "https://github.com/Installation-04/Allumi/releases"}>{t("downloads")}</Link>
  </section>;
}
