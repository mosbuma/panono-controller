import type { Metadata, Viewport } from "next";
import { SwRegister } from "@/components/SwRegister";
import "./globals.css";

export const metadata: Metadata = {
  title: "Panono Control",
  description: "Control a Panono 360° camera and download panoramas over WiFi",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Panono Control",
  },
  applicationName: "Panono Control",
};

export const viewport: Viewport = {
  themeColor: "#1a4d6d",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SwRegister />
        {children}
      </body>
    </html>
  );
}
