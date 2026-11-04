import type { MetadataRoute } from "next";

/** Web app manifest (served at /manifest.webmanifest). Colors are the dark tokens: --color-bg dark. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Pixtaha Management",
    short_name: "Pixtaha",
    description: "Server fleet monitoring",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#14110E",
    theme_color: "#14110E",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
