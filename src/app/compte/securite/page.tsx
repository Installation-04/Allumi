import Link from "next/link";
import QRCode from "qrcode";
import { getTranslations } from "next-intl/server";
import { Card } from "@/app/_components/ui";
import { requireSession } from "@/app/_lib/session";
import { getProfile, pendingTotpEnrollment, totpStatus } from "@/modules/auth";
import { TwoFactorPanel } from "./forms";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: (await getTranslations("security"))("title") };
}

export default async function SecurityPage() {
  const session = await requireSession();
  const [t, profile, status] = [await getTranslations("security"), await getProfile(session.userId), await totpStatus(session.userId)];
  const pending = status.pending && profile ? await pendingTotpEnrollment(session.userId, profile.email) : null;
  const qr = pending ? await QRCode.toDataURL(pending.uri, { margin: 1, width: 220 }) : null;

  return (
    <Card title={t("title")}>
      <h2 className="text-lg font-semibold">{t("twoFactor")}</h2>
      <TwoFactorPanel enabled={status.enabled} recoveryCodesLeft={status.recoveryCodesLeft} enrollment={pending && qr ? { qr, secret: pending.secret } : null} />
      <Link href="/" className="inline-block text-sm underline">
        {t("backHome")}
      </Link>
    </Card>
  );
}
