import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fourtune Vaults — Play Money Strategy Game",
  description:
    "Read four mysterious vaults, balance exploration with exploitation, and find Ember in this local play-money casino prototype.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
