import Link from "next/link";
import QRCode from "qrcode";
import { getTranslations } from "next-intl/server";
import { Card, SubmitButton } from "@/app/_components/ui";
import { requireSession } from "@/app/_lib/session";
import { getProfile, pendingTotpEnrollment, totpStatus } from "@/modules/auth";
import { beginEnrollmentAction } from "./actions";
import { ConfirmEnrollmentForm, DisableForm } from "./forms";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const session = await requireSession();
  const [t, profile, status] = [await getTranslations("security"), await getProfile(session.userId), await totpStatus(session.userId)];
  const pending = status.pending && profile ? await pendingTotpEnrollment(session.userId, profile.email) : null;
  const qr = pending ? await QRCode.toDataURL(pending.uri, { margin: 1, width: 220 }) : null;

  return (
    <Card title={t("title")}>
      <h2 className="text-lg font-semibold">{t("twoFactor")}</h2>
      {status.enabled ? (
        <>
          <p className="text-sm">{t("twoFactorOn", { count: status.recoveryCodesLeft })}</p>
          <DisableForm />
        </>
      ) : pending && qr ? (
        <ConfirmEnrollmentForm qr={qr} secret={pending.secret} />
      ) : (
        <>
          <p className="text-sm">{t("twoFactorOff")}</p>
          <form action={beginEnrollmentAction}>
            <SubmitButton>{t("enable")}</SubmitButton>
          </form>
        </>
      )}
      <Link href="/" className="inline-block text-sm underline">
        {t("backHome")}
      </Link>
    </Card>
  );
}
