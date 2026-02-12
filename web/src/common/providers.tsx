'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider as JotaiProvider } from 'jotai';
import { ThemeProvider } from 'next-themes';
import React, { type ReactNode, useState } from 'react';

import { ExtensionBridgeInit } from '@/hooks/use-extension-bridge';

interface ProvidersProps {
  children: ReactNode;
}

/** 全域 Provider 堆疊：主題 → Jotai → React Query → 擴充套件橋接 */
export const Providers: React.FC<ProvidersProps> = ({ children }) => {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <JotaiProvider>
        <QueryClientProvider client={queryClient}>
          <ExtensionBridgeInit />
          {children}
        </QueryClientProvider>
      </JotaiProvider>
    </ThemeProvider>
  );
};
