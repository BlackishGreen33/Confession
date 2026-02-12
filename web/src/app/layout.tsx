import './globals.css';

import type { Metadata } from 'next';

import { NavBar } from '@/components/nav-bar';
import { Providers } from '@/providers';

export const metadata: Metadata = {
  title: 'Confession — 薄暮靜析的告解詩',
  description: '靜態程式碼漏洞檢測與修復儀表盤',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <body className="antialiased">
        <Providers>
          <NavBar />
          {children}
        </Providers>
      </body>
    </html>
  );
}
