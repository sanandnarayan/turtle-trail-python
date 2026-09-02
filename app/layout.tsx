import type { Metadata } from "next";

import { AccountProvider } from "./account";
import "./globals.css";

export const metadata: Metadata = {
  title: "Turtle Trail — Learn Python by Drawing",
  description: "A playful, one-concept-at-a-time Python course with live Turtle drawings.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  other: {
    "codex-preview": "development",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased"><AccountProvider>{children}</AccountProvider></body>
    </html>
  );
}
