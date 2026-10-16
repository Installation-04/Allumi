import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card } from "@/app/_components/ui";
import { getSession } from "@/app/_lib/session";
import { MfaForm } from "./form";

export const dynamic = "force-dynamic";

export default async function MfaPage() {
  const session = await getSession();
  if (!session) redirect("/connexion");
  if (!session.mfaPending) redirect("/");
  const t = await getTranslations("mfa");
  return (
    <Card title={t("title")}>
      <p className="text-sm text-stone-700 dark:text-stone-300">{t("intro")}</p>
      <MfaForm />
    </Card>
  );
}
