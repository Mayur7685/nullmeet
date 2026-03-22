import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "@/components/WalletProvider";
import { ThemeToggle } from "@/components/ThemeToggle";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "https://nullmeet-v2.vercel.app"
  ),
  title: "Nullmeet v2 — Multi-day Group Private Meeting Scheduler",
  description:
    "Find a common meeting time without revealing your schedule. Multi-day, group scheduling with MagicBlock TEE on Solana.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "Nullmeet v2 — Multi-day Group Private Meeting Scheduler",
    description:
      "Find a common meeting time without revealing your schedule. Multi-day, group scheduling with MagicBlock TEE on Solana.",
    images: [{ url: "/nullmeet-og.png", width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Nullmeet v2 — Multi-day Group Private Meeting Scheduler",
    description:
      "Find a common meeting time without revealing your schedule. Multi-day, group scheduling with MagicBlock TEE on Solana.",
    images: ["/nullmeet-og.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Prevent flash of wrong theme */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var t = localStorage.getItem('nullmeet-theme');
                if (!t) t = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
                document.documentElement.setAttribute('data-theme', t);
              })();
            `,
          }}
        />
      </head>
      <body className="min-h-screen">
        <WalletProvider>
          {/* Universal theme toggle — fixed top-right on every page */}
          <div className="fixed top-4 right-4 z-50">
            <ThemeToggle />
          </div>
          {children}
        </WalletProvider>
      </body>
    </html>
  );
}
