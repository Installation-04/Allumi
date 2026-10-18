"use client";

import { useTranslations } from "next-intl";

/** Anything that escapes a page (not a form: those answer with a message): a translated page, not Next's raw one. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errors");
  return (
    <section className="space-y-4" role="alert">
      <h1 className="text-xl font-semibold">{t("page")}</h1>
      <button
        type="button"
        onClick={reset}
        className="rounded-md border border-stone-300 px-4 py-2 text-sm font-medium hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
      >
        {t("retry")}
      </button>
    </section>
  );
}
