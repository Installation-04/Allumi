import { cookies } from "next/headers";
import { isTheme } from "./_lib/theme";
import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { Footer, Header } from "./_components/shell";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return { title: { default: "Allumi", template: "%s · Allumi" }, description: t("tagline"), other: { "apple-mobile-web-app-capable": "yes" }, appleWebApp: { capable: true, title: "Allumi", statusBarStyle: "default" }, icons: { apple: "/icons/allumi-180.png" } };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#007f5f" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const preference = (await cookies()).get("allumi_theme")?.value;
  const theme = isTheme(preference) ? preference : "system";
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale === "en" ? "en" : "fr-CA"} data-theme={theme}>
      <body className="flex min-h-dvh flex-col font-sans">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Header global />
          <main className="mx-auto min-w-0 w-full max-w-[1440px] flex-1 px-4 py-5 sm:px-6 sm:py-8">{children}</main>
          <Footer />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
