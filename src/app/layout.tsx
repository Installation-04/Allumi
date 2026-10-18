import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { Footer, Header } from "./_components/shell";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return { title: { default: "Allumi", template: "%s · Allumi" }, description: t("tagline") };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale === "en" ? "en" : "fr-CA"}>
      <body className="flex min-h-dvh flex-col font-sans">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Header />
          <main className="mx-auto min-w-0 w-full max-w-[1440px] flex-1 px-4 py-5 sm:px-6 sm:py-8">{children}</main>
          <Footer />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
