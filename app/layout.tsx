import type { Metadata } from "next";
import { Azeret_Mono, Instrument_Serif, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";

const display = Instrument_Serif({ weight: "400", style: ["normal", "italic"], subsets: ["latin"], variable: "--font-display" });
const body = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-body" });
const mono = Azeret_Mono({ weight: ["400", "500", "600"], subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Paddle Agent — Hudson River paddling intelligence",
  description: "Live Hudson River conditions from ClickHouse, briefed into one honest answer: should you launch?",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
