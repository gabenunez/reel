import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { APP_NAME } from "@/lib/document-title";
import { TV_CRITICAL_CSS, TV_MODE_BOOTSTRAP_SCRIPT } from "@/lib/tv-mode-detect";

const inter = Inter({
  subsets: ["latin"],
  display: "optional",
  preload: true,
  adjustFontFallback: true,
});

/** Fade hero title in once Inter is ready — avoids weight/metric swap on first paint. */
const HERO_FONT_BOOTSTRAP_SCRIPT = `(function(){var done=false;function mark(){if(done)return;done=true;document.documentElement.classList.add("hero-fonts-ready")}var t=setTimeout(mark,180);if(document.fonts&&document.fonts.ready){document.fonts.ready.then(function(){clearTimeout(t);mark()})}else{mark()}})();`;

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s · ${APP_NAME}`,
  },
  description: "Self-hosted movies and TV streaming",
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <style dangerouslySetInnerHTML={{ __html: TV_CRITICAL_CSS }} />
        <script dangerouslySetInnerHTML={{ __html: TV_MODE_BOOTSTRAP_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: HERO_FONT_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className={inter.className}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
