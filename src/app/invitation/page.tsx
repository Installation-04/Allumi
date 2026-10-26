import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/app/_lib/session";
import { ActionForm, Card, Field, SelectField } from "@/app/_components/ui";
import { acceptAction } from "./actions";
export default async function InvitationPage() {
  const session = await getSession();
  if (session?.mfaPending) redirect("/connexion/2fa");
  const t = await getTranslations("members");
  return <Card title={t("join")}><p>{t(session ? "existing" : "newAccount")}</p>{!session && <Link href="/connexion" className="inline-flex min-h-11 items-center underline">{t("signInFirst")}</Link>}<ActionForm action={acceptAction} label={t("accept")}><Field name="token" label={t("code")} autoComplete="off" /><Field name="email" label={t("email")} type="email" autoComplete="email" />{!session && <><Field name="displayName" label={t("name")} autoComplete="name" /><Field name="password" label={t("password")} type="password" autoComplete="new-password" hint={t("passwordHint")} /><SelectField name="locale" label={t("language")} options={[{ value: "fr-CA", label: "Français" }, { value: "en", label: "English" }]} /></>}</ActionForm></Card>;
}
