import type { Metadata, Viewport } from "next";
import "./globals.css";

const title = "Soulscrape: understand a person without pretending to contain them";
const description =
  "Soulscrape is an Agent Skill that turns the evidence you are authorized to use into a dated, evidence-calibrated working model of a person, with an asking protocol, instruction-bound web research, and explicit privacy boundaries.";

export const metadata: Metadata = {
  metadataBase: new URL("https://soulscrape.com"),
  title,
  description,
  alternates: { canonical: "/" },
  icons: {
    icon: [{ type: "image/svg+xml", url: "/favicon.svg" }],
  },
  openGraph: {
    title,
    description,
    siteName: "Soulscrape",
    type: "website",
    url: "/",
  },
  twitter: {
    card: "summary",
    title,
    description,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { color: "#faf7fb", media: "(prefers-color-scheme: light)" },
    { color: "#161219", media: "(prefers-color-scheme: dark)" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
