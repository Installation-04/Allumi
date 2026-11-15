import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { installedReleaseNotes, earlierReleaseNotes, RELEASE_TAG, type ReleaseNotes } from "@/modules/updates";
import { FOCUS } from "@/app/_components/focus";

export async function ReleaseNotesPanel({ version }: { version: string }) {
  const t = await getTranslations("whatsNew");
  const locale = await getLocale();
  const notes = installedReleaseNotes(version, locale);
  const earlier = earlierReleaseNotes(version, locale);
  const tag = version.startsWith("v") ? version : `v${version}`;
  const releaseUrl = RELEASE_TAG.test(tag) ? `https://github.com/Installation-04/Allumi/releases/tag/${tag}` : "https://github.com/Installation-04/Allumi/releases";
  const content = (entry: ReleaseNotes) => <div className="space-y-4">
    <p className="font-semibold break-words">{entry.title}</p>
    {(["added", "improved", "fixed", "installation"] as const).map(category => entry[category].length > 0 && <div key={category} className="space-y-2">
      <h3 className="font-semibold">{t(category)}</h3>
      <ul className="list-disc space-y-2 pl-5">{entry[category].map((item, index) => <li key={index} className="break-words">
        <p>{item.text}</p>
        {item.guide && <Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={`https://github.com/Installation-04/Allumi/wiki/${item.guide}`}>{t("guide")}</Link>}
      </li>)}</ul>
    </div>)}
  </div>;
  return <section id="nouveautes" aria-labelledby="whats-new-title" className="space-y-4 rounded border border-stone-300 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
    <h2 id="whats-new-title" className="text-xl font-semibold break-words">{t("title", { version })}</h2>
    <p className="text-sm">{t("intro")}</p>
    {notes ? content(notes) : <p>{t("unavailable")}</p>}
    <Link className={`inline-flex min-h-11 items-center underline ${FOCUS}`} href={releaseUrl}>{t("release")}</Link>
    {earlier.length > 0 && <details className="space-y-3 rounded border border-stone-300 p-3 dark:border-stone-700">
      <summary className={`min-h-11 cursor-pointer font-semibold ${FOCUS}`}>{t("earlier")}</summary>
      <ol className="space-y-5">{earlier.map(entry => <li key={entry.version} className="space-y-3 border-t border-stone-300 pt-3 dark:border-stone-700">
        <p className="font-semibold">{t("version", { version: entry.version })}</p>{content(entry.notes)}
      </li>)}</ol>
    </details>}
  </section>;
}
