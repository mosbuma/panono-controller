import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Panono Control",
    short_name: "Panono",
    description: "Control a Panono 360° camera and download panoramas over WiFi",
    start_url: "/",
    display: "standalone",
    background_color: "#0f1115",
    theme_color: "#1a4d6d",
    icons: [
      {
        src: "/icons/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
