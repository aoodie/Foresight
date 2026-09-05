import type { Metadata } from "next";
import "./globals.css";
import "@/components/quant/workspace.css";
import { PlatformNavigation } from "@/components/quant/navigation";

export const metadata: Metadata = {
  title: "Forex Research | Foresight FX",
  description: "A focused forex research dashboard with OANDA market-data connectivity.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased"><PlatformNavigation />{children}</body>
    </html>
  );
}
