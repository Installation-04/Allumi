"use client";

import { useId } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { setTheme } from "@/app/appearance/actions";
import { THEMES, type Theme } from "@/app/_lib/theme";
import { FOCUS } from "./focus";

function ThemeControl({ value }: { value: Theme }) {
  const t = useTranslations("appearance");
  const id = useId();
  const { pending } = useFormStatus();
  return <>
    <label htmlFor={id} className="sr-only">{t("label")}</label>
    <select id={id} name="theme" value={value} aria-busy={pending}
      onChange={(event) => event.currentTarget.form?.requestSubmit()}
      className={`min-h-11 max-w-full rounded-md border border-stone-300 bg-white px-2 text-sm dark:border-stone-700 dark:bg-stone-900 ${FOCUS}`}>
      {THEMES.map((theme) => <option key={theme} value={theme}>{t(theme)}</option>)}
    </select>
    <noscript><button type="submit" className="min-h-11 px-2 underline">{t("apply")}</button></noscript>
  </>;
}

export function ThemePicker({ value }: { value: Theme }) {
  return <form action={setTheme}><ThemeControl value={value} /></form>;
}
