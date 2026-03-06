import './globals.css';

import type { Metadata } from 'next';
import { JetBrains_Mono, Noto_Sans, Noto_Serif } from 'next/font/google';

import { Providers } from '@/providers';

const notoSansTc = Noto_Sans({
  variable: '--font-noto-sans-tc',
  subsets: ['latin'],
  weight: ['400', '500', '700', '900'],
  display: 'swap',
});

const notoSerifTc = Noto_Serif({
  variable: '--font-noto-serif-tc',
  subsets: ['latin'],
  weight: ['500', '700', '900'],
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
});

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
    <html
      lang="zh-Hant"
      className={`${notoSansTc.variable} ${notoSerifTc.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased font-sans">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
