import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return { name: "Allumi", short_name: "Allumi", description: "Comptabilité pour le Québec et le Canada", start_url: "/", scope: "/", display: "standalone", background_color: "#f5f6f7", theme_color: "#007f5f", icons: [{ src: "/icons/allumi-192.png", sizes: "192x192", type: "image/png" }, { src: "/icons/allumi-512.png", sizes: "512x512", type: "image/png" }] };
}
