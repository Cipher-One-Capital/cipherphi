import type { Metadata, Viewport } from "next";
import { DM_Sans } from "next/font/google";
import { Disclaimer } from "@/components/Disclaimer";
import { LiveDonations } from "@/components/LiveDonations";
import { TipsProvider } from "@/components/Tips";
import { Providers } from "./providers";
import "./globals.css";

const sans = DM_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CipherPhi testnet demo",
  description:
    "Enforces zakat rules before funds move. A testnet demo: give, see the split across the eight zakat categories, see a payout released only with approval, check every step on a public explorer.",
};

export const viewport: Viewport = { themeColor: "#f2f2f2" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={sans.variable}>
      <body>
        <TipsProvider>
          <div className="page">
            <LiveDonations />
            <Providers>{children}</Providers>
          </div>
        </TipsProvider>
        <Disclaimer />
      </body>
    </html>
  );
}
