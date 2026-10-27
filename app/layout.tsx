import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Eventra | Event Management",
  description: "Dashboard pengelolaan event untuk Admin dan PIC.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id"><body>{children}</body></html>;
}
