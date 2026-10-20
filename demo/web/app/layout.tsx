import type { Metadata, Viewport } from "next";
import { Space_Grotesk } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const sans = Space_Grotesk({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CipherPhi testnet demo",
  description:
    "Zakat rules enforced before money moves. Give test francs, see the split across the eight categories, watch a payout released only with approval, and check it all on a public explorer.",
};

export const viewport: Viewport = { themeColor: "#fbfaf6" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={sans.variable}>
      <body>
        <div className="page">
          <p className="banner" role="note">
            <strong>Testnet demo.</strong> Test tokens only, no real money. The contracts are
            unaudited.
          </p>
          <Providers>{children}</Providers>
          <footer className="footer">
            <p>Swiss Islamic Finance · Swiss Zakat Foundation · built by Bits &amp; Blocks</p>
            <p className="small">
              Runs on Stellar testnet. tCHF is a test token with no value, issued for this demo.
            </p>
          </footer>
        </div>
      </body>
    </html>
  );
}
