import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Footer, Header } from "./_components/shell";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Allumi", template: "%s · Allumi" },
  description: "Comptabilité libre et auto-hébergeable pour le Québec et le Canada",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale === "en" ? "en" : "fr-CA"}>
      <body className="flex min-h-screen flex-col font-sans">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Header />
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
          <Footer />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
