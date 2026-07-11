import "./globals.css";
import { Be_Vietnam_Pro, Bricolage_Grotesque, Spline_Sans_Mono } from "next/font/google";

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

const mono = Spline_Sans_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata = {
  title: "COLONEL · KFC Việt Nam ordering agent",
  description: "Conversational ordering agent that learns your taste. AABW 2026, KFC Vietnam track.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${ui.variable} ${displayFace.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
