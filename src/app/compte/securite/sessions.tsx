import { getFormatter, getTranslations } from "next-intl/server";
import { SubmitButton } from "@/app/_components/ui";
import type { SessionSummary } from "@/modules/auth";
import { revokeOtherSessionsAction, revokeSessionAction } from "./actions";

/** The devices signed in to the account, each with a button to sign it out. */
export async function SessionList({ sessions }: { sessions: SessionSummary[] }) {
  const [t, format] = [await getTranslations("security"), await getFormatter()];
  const when = (date: Date) => format.dateTime(date, { dateStyle: "medium", timeStyle: "short" });
  const others = sessions.filter((session) => !session.current);

  return (
    <>
      <p className="text-sm">{t("sessionsIntro")}</p>
      <ul className="space-y-3">
        {sessions.map((session) => {
          const { browser, system } = session.device;
          const device = [browser, system].filter(Boolean).join(" · ") || t("unknownDevice");
          return (
            <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-stone-300 p-3 dark:border-stone-700">
              <div className="min-w-0 text-sm">
                <p className="font-medium">
                  {device}
                  {session.current ? <span className="ml-2 rounded bg-stone-200 px-2 py-0.5 text-xs font-normal dark:bg-stone-700">{t("thisDevice")}</span> : null}
                </p>
                <p className="text-stone-600 dark:text-stone-400">{t("lastActive", { date: when(session.lastSeenAt) })}</p>
                <p className="text-stone-600 dark:text-stone-400">{t("signedInAt", { date: when(session.createdAt) })}</p>
                {session.mfaPending ? <p className="text-amber-800 dark:text-amber-300">{t("awaitingSecondFactor")}</p> : null}
              </div>
              {session.current ? null : (
                <form action={revokeSessionAction}>
                  <input type="hidden" name="sessionId" value={session.id} />
                  <SubmitButton variant="secondary" ariaLabel={t("signOutDevice", { device })}>
                    {t("signOut")}
                  </SubmitButton>
                </form>
              )}
            </li>
          );
        })}
      </ul>
      {others.length > 0 ? (
        <form action={revokeOtherSessionsAction}>
          <SubmitButton variant="secondary">{t("signOutOthers")}</SubmitButton>
        </form>
      ) : null}
    </>
  );
}
