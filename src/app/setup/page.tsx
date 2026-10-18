import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Card } from "@/app/_components/ui";
import { currentSetupGate, isSetUp, PASSWORD_MIN_LENGTH } from "@/modules/auth";
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
  const gate = currentSetupGate();
  return (
    <Card title={t("title")}>
      <p className="text-sm text-stone-700 dark:text-stone-300">{t("intro")}</p>
      {gate === "token_missing" ? (
        <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          {t("tokenMissing")}
        </p>
      ) : (
        <SetupForm passwordMin={PASSWORD_MIN_LENGTH} defaultLocale={locale === "en" ? "en" : "fr-CA"} tokenRequired={gate === "token_required"} />
      )}
    </Card>
  );
}
