import Link from "next/link";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  return { title: (await getTranslations("errors"))("notFound") };
}

export default async function NotFound() {
  const t = await getTranslations("errors");
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">{t("notFound")}</h1>
      <Link href="/" className="underline">
        Allumi
      </Link>
    </section>
  );
}
