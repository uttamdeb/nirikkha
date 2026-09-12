import type { Metadata } from "next";
import { Noto_Sans_Bengali, Sora, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import "katex/dist/katex.min.css";
import { cn } from "@/lib/utils";

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sans",
});

const soraHeading = Sora({
  subsets: ["latin"],
  variable: "--font-heading",
  weight: ["500", "600", "700"],
});

const notoBangla = Noto_Sans_Bengali({
  subsets: ["bengali"],
  variable: "--font-bangla",
  weight: ["400", "500", "600", "700"],
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "নিরীক্ষা",
  description: "Human-in-the-Loop Bangla handwritten CQ grading",
  icons: {
    icon: [
      { url: "/logo.png", media: "(prefers-color-scheme: light)" },
      { url: "/logo-dark.png", media: "(prefers-color-scheme: dark)" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="bn"
      suppressHydrationWarning
      className={cn(
        "h-full antialiased",
        sora.variable,
        soraHeading.variable,
        notoBangla.variable,
        mono.variable,
        "font-sans"
      )}
    >
      <body className="flex min-h-full flex-col">
        {/* Providers boots the app: it fetches /api/config and blocks on it.
            The public page must render without that, so the gate lives in the
            subtrees that need a session rather than at the root. */}
        {children}
      </body>
    </html>
  );
}
