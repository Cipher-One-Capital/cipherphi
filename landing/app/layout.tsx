import type { Metadata, Viewport } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";

const sans = DM_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.cipherphi.ch"),
  title: "CipherPhi: zakat rules, enforced onchain",
  description:
    "Enforces zakat rules before funds move. CipherPhi puts the Swiss Zakat Foundation's zakat collection and redistribution onchain, on Stellar. Testnet demo live; contracts unaudited; pilot in preparation.",
  openGraph: {
    title: "CipherPhi",
    description: "Enforces zakat rules before funds move.",
    url: "https://www.cipherphi.ch",
    siteName: "CipherPhi",
    type: "website",
  },
};

export const viewport: Viewport = { themeColor: "#f2f2f2" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={sans.variable}>
      <body>{children}</body>
    </html>
  );
}
