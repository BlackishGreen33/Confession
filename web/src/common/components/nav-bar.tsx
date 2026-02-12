'use client'

import { Bug, LayoutDashboard, Settings, Shield } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import React from 'react'

import { cn } from '@/utils/cn'

const NAV_ITEMS = [
  { href: '/', label: '儀表盤', icon: LayoutDashboard },
  { href: '/vulnerabilities', label: '漏洞列表', icon: Bug },
  { href: '/settings', label: '設定', icon: Settings },
] as const

/** 頂部導航列 */
export const NavBar: React.FC = () => {
  const pathname = usePathname()

  return (
    <header className="border-border/50 bg-card/80 sticky top-0 z-50 border-b backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
        {/* 品牌 */}
        <Link href="/" className="flex items-center gap-2">
          <Shield className="text-primary h-5 w-5" />
          <span className="text-sm font-semibold tracking-tight">Confession</span>
        </Link>

        {/* 導航連結 */}
        <nav className="flex items-center gap-1" aria-label="主導航">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
                  isActive
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
