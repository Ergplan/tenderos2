import "@/src/styles.css";
import "@/src/app.css";
import "@/src/bid.css";
import "@/src/cfd.css";
import "@/src/meter.css";
import "@/src/seci.css";
import "@/src/team.css";
import "@/src/trace.css";
import { PRE_PAINT } from "@/src/themeScript";

export const metadata = {
  title: { default: "TenderOS", template: "%s · TenderOS" },
  description: "Hybrid RE sizing, dispatch and project finance",
};

export const viewport = {
  colorScheme: "dark light",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#fafaf7" }, { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" }],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PRE_PAINT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
