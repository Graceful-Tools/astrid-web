'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart3, Flag, ShieldCheck } from 'lucide-react'

const destinations = [
  { href: '/admin/admins', label: 'Manage Admins', icon: ShieldCheck },
  { href: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/admin/features', label: 'Feature Rollouts', icon: Flag },
]

export function AdminNavigation() {
  const pathname = usePathname()

  return (
    <header className="border-b bg-background/95 px-4 pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur">
      <div className="container mx-auto max-w-7xl">
        <div className="pb-3">
          <h1 className="text-xl font-bold sm:text-2xl">Admin</h1>
          <p className="text-sm text-muted-foreground">Manage access, analytics, and feature availability.</p>
        </div>
        <nav aria-label="Admin sections" className="-mx-4 overflow-x-auto px-4">
          <div className="flex min-w-max gap-1" role="list">
            {destinations.map(({ href, label, icon: Icon }) => {
              const active = pathname === href
                || (href === '/admin/features' && pathname === '/admin')
                || (href === '/admin/admins' && pathname?.startsWith('/admin/analytics/admins'))
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition-colors ${active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              )
            })}
          </div>
        </nav>
      </div>
    </header>
  )
}
