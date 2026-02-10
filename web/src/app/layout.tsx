import './globals.css';

import type { Metadata } from 'next';

import { Providers } from '@/providers';

export const metadata: Metadata = {
  title: 'Confession - Code Vulnerability Scanner',
  description: 'Code vulnerability detection and remediation dashboard',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
