import "./globals.css";
import { Be_Vietnam_Pro, Bricolage_Grotesque, IBM_Plex_Mono } from "next/font/google";

const ui = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-ui",
  display: "swap",
});

const displayFace = Bricolage_Grotesque({
  subsets: ["latin", "vietnamese"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

// IBM Plex Mono, not Spline Sans Mono: broad subset coverage keeps mono-styled
// KPIs, receipts, and trace rows aligned.
const mono = IBM_Plex_Mono({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata = {
  title: "Chirpy · KFC Vietnam ordering agent",
  description: "Conversational ordering agent that learns your taste. AABW 2026, KFC Vietnam track.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${ui.variable} ${displayFace.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
