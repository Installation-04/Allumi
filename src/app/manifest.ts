import type { MetadataRoute } from "next";
import { getLocale, getTranslations } from "next-intl/server";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getTranslations("app");
  return {
    name: "Allumi", short_name: "Allumi", description: t("tagline"), lang: await getLocale(),
    start_url: "/", scope: "/", display: "standalone", background_color: "#f5f6f7", theme_color: "#007f5f",
    icons: [
      { src: "/icons/allumi-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/allumi-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/allumi-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
