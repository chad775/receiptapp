import type { Metadata } from "next";
import "./globals.css";
import StaffLink from "@/components/StaffLink";

export const metadata: Metadata = {
  title: "Receipt Management | Boyd Group Services",
  description:
    "Manage your business receipts and streamline your accounting with Boyd Group Services",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <StaffLink />
        {children}
      </body>
    </html>
  );
}
