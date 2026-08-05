import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ViralClip AI — AI Video Clipper for YouTube Shorts",
  description:
    "Turn long videos into viral YouTube Shorts. Paste a link, let AI find the best moments, and get ready-to-post 30-60s clips.",
  keywords: [
    "video clipper",
    "YouTube Shorts",
    "AI video",
    "viral clips",
    "content creation",
    "OpenAI",
  ],
  authors: [{ name: "ViralClip AI" }],
  openGraph: {
    title: "ViralClip AI — AI Video Clipper",
    description: "Turn long videos into viral YouTube Shorts with AI.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground min-h-screen`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
