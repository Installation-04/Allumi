import Link from "next/link";
import QRCode from "qrcode";
import { getTranslations } from "next-intl/server";
import { Card } from "@/app/_components/ui";
import { readSessionToken, requireSession } from "@/app/_lib/session";
import { getProfile, listSessions, pendingTotpEnrollment, totpStatus } from "@/modules/auth";
import { PasswordForm, TwoFactorPanel } from "./forms";
import { SessionList } from "./sessions";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: (await getTranslations("security"))("title") };
}

export default async function SecurityPage() {
  const session = await requireSession();
  const [t, profile, status] = [await getTranslations("security"), await getProfile(session.userId), await totpStatus(session.userId)];
  const sessions = await listSessions(session.userId, await readSessionToken());
  const pending = status.pending && profile ? await pendingTotpEnrollment(session.userId, profile.email) : null;
  const qr = pending ? await QRCode.toDataURL(pending.uri, { margin: 1, width: 220 }) : null;

  return (
    <Card title={t("title")}>
      <h2 className="text-lg font-semibold">{t("twoFactor")}</h2>
      <TwoFactorPanel enabled={status.enabled} recoveryCodesLeft={status.recoveryCodesLeft} enrollment={pending && qr ? { qr, secret: pending.secret } : null} />
      <h2 className="text-lg font-semibold">{t("passwordTitle")}</h2>
      <PasswordForm />
      <h2 className="text-lg font-semibold">{t("sessionsTitle")}</h2>
      <SessionList sessions={sessions} />
      <Link href="/" className="inline-block text-sm underline">
        {t("backHome")}
      </Link>
    </Card>
  );
}
