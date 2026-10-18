import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card } from "@/app/_components/ui";
import { getSession } from "@/app/_lib/session";
import { isSetUp } from "@/modules/auth";
import { LoginForm } from "./form";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: (await getTranslations("login"))("title") };
}

export default async function LoginPage() {
  if (!(await isSetUp())) redirect("/setup");
  const session = await getSession();
  if (session) redirect(session.mfaPending ? "/connexion/2fa" : "/");
  const t = await getTranslations("login");
  return (
    <Card title={t("title")}>
      <LoginForm />
    </Card>
  );
}
