import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Card } from "@/app/_components/ui";
import { isSetUp, PASSWORD_MIN_LENGTH, setupTokenRequired } from "@/modules/auth";
import { SetupForm } from "./form";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: (await getTranslations("setup"))("title") };
}

export default async function SetupPage() {
  // Disabled for good once the instance has been set up.
  if (await isSetUp()) redirect("/connexion");
  const t = await getTranslations("setup");
  const locale = await getLocale();
  return (
    <Card title={t("title")}>
      <p className="text-sm text-stone-700 dark:text-stone-300">{t("intro")}</p>
      <SetupForm passwordMin={PASSWORD_MIN_LENGTH} defaultLocale={locale === "en" ? "en" : "fr-CA"} tokenRequired={setupTokenRequired()} />
    </Card>
  );
}
