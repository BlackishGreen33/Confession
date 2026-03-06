'use client';

import { Check, MonitorCog, MoonStar, SunMedium } from 'lucide-react';
import { useTheme } from 'next-themes';
import React, { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type ThemeOption = 'light' | 'dark' | 'system';

const THEME_OPTIONS: Array<{ value: ThemeOption; label: string; icon: React.ReactNode }> = [
  { value: 'system', label: '跟隨系統', icon: <MonitorCog className="size-4" /> },
  { value: 'light', label: '淺色', icon: <SunMedium className="size-4" /> },
  { value: 'dark', label: '深色', icon: <MoonStar className="size-4" /> },
];

export const ThemeToggle: React.FC = () => {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const triggerIcon = useMemo(() => {
    if (!mounted) {
      return <MonitorCog className="size-4" />;
    }
    if ((theme ?? 'system') === 'system') {
      return <MonitorCog className="size-4" />;
    }
    return resolvedTheme === 'dark' ? (
      <MoonStar className="size-4" />
    ) : (
      <SunMedium className="size-4" />
    );
  }, [mounted, resolvedTheme, theme]);

  return (
    <div className="fixed right-4 bottom-4 z-50 md:right-6 md:bottom-6">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            className="border-cyber-border bg-cyber-surface/90 text-cyber-text shadow-md backdrop-blur-sm hover:bg-cyber-surface2"
            aria-label="切換主題"
          >
            {triggerIcon}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="border-cyber-border bg-cyber-surface text-cyber-text"
          align="end"
          side="top"
        >
          {THEME_OPTIONS.map((option) => {
            const selected = (theme ?? 'system') === option.value;
            return (
              <DropdownMenuItem
                key={option.value}
                onSelect={() => setTheme(option.value)}
                className="flex items-center justify-between gap-4 text-sm"
              >
                <span className="inline-flex items-center gap-2">
                  {option.icon}
                  {option.label}
                </span>
                {selected && <Check className="size-4 text-cyber-primary" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
