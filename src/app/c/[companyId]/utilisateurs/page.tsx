import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { can, listMembers } from "@/modules/companies";
import { getProfile } from "@/modules/auth";
import { ActionForm, Field } from "@/app/_components/ui";
import { loadCompany } from "../_lib";
import { inviteAction, memberAction, serverAccessAction } from "./actions";
import { InviteForm, PermissionFields } from "./forms";
export default async function MembersPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { company, actor } = await loadCompany(params);
  if (!can(company, "members.manage")) notFound();
  const { members, invitations } = await listMembers(actor);
  const profile = await getProfile(actor.userId);
  const t = await getTranslations("members");
  const roles = await getTranslations("dashboard.roles");
  const confirm = <label className="flex min-h-11 items-center gap-3"><input name="confirm" value="yes" type="checkbox" required />{t("confirm")}</label>;
  return <section className="space-y-6"><h1 className="text-2xl font-semibold">{t("title")}</h1><p>{t("intro")}</p>{profile?.isInstanceAdmin && <p>{t("superAdmin")}</p>}<Link href="/invitation" className="inline-flex min-h-11 items-center underline">{t("join")}</Link><div className="grid items-start gap-6 xl:grid-cols-2"><section className="space-y-3"><h2 className="text-xl font-semibold">{t("active")}</h2>{members.map(m => <article key={m.id} className="space-y-3 rounded-lg border bg-white p-4 dark:bg-stone-900"><h3 className="font-semibold break-words">{m.user.displayName}</h3><p className="break-all">{m.user.email}</p><p>{roles(m.role)}{m.user.disabledAt ? ` · ${t("disabled")}` : ""}</p>{profile?.isInstanceAdmin && !m.user.isInstanceAdmin && <details><summary className="min-h-11 cursor-pointer">{t("serverAccess")}</summary><p>{t("serverAccessHint")}</p><ActionForm action={serverAccessAction.bind(null, m.userId, !m.user.canManageServer)} label={t(m.user.canManageServer ? "revokeServer" : "grantServer")}><Field name="password" type="password" label={t("adminPassword")} autoComplete="current-password" /></ActionForm></details>}{m.userId === actor.userId ? <p>{t("self")}</p> : <><ActionForm action={memberAction.bind(null, company.id, m.id, "save")} label={t("save")}><PermissionFields role={m.role} access={m.moduleAccess} /></ActionForm><details><summary className="min-h-11 cursor-pointer text-red-700 dark:text-red-400">{t("remove")}</summary><ActionForm action={memberAction.bind(null, company.id, m.id, "remove")} label={t("remove")}>{confirm}<p className="text-sm">{t("removeHint")}</p></ActionForm></details></>}</article>)}</section><section className="space-y-4 rounded-lg border bg-white p-4 dark:bg-stone-900"><h2 className="text-xl font-semibold">{t("invite")}</h2><InviteForm action={inviteAction.bind(null, company.id)} /></section></div><section className="space-y-3"><h2 className="text-xl font-semibold">{t("pending")}</h2>{!invitations.length && <p>{t("empty")}</p>}{invitations.map(i => <article key={i.id} className="space-y-2 rounded border p-4"><h3 className="font-semibold break-all">{i.email}</h3><p>{roles(i.role)} · {t("expires", { date: i.expiresAt.toISOString().slice(0, 10) })}</p><ActionForm action={memberAction.bind(null, company.id, i.id, "revoke")} label={t("revoke")}>{confirm}</ActionForm></article>)}</section></section>;
}
