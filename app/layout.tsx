import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@formstr/signer/styles.css";
import "../src/styles.css";
import { APP_NAME, APP_TAGLINE } from "../src/nostr/constants";

const siteUrl = process.env.SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${APP_NAME} - ${APP_TAGLINE.toLowerCase()}`,
    template: `%s - ${APP_NAME}`,
  },
  description: "Community-authored Nostr implementation proposals, surfaced by trust.",
  applicationName: APP_NAME,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: APP_NAME,
    title: APP_NAME,
    description: APP_TAGLINE,
    url: "/",
  },
  twitter: { card: "summary_large_image", title: APP_NAME, description: APP_TAGLINE },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark",
  themeColor: "#000000",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
