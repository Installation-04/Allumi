"use client";
import { useTranslations } from "next-intl";
import { FOCUS } from "@/app/_components/focus";
export function PrintButton() {
  const t = useTranslations("invoicePrint");
  return <button type="button" onClick={() => window.print()} className={`min-h-11 rounded-full bg-brand-700 px-5 text-white ${FOCUS}`}>{t("print")}</button>;
}
