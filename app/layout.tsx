import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Love Language Atlas",
  description: "Discover words of love around the world."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
