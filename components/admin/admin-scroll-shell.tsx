import type { ReactNode } from 'react'

/// The global task-manager shell locks html/body scrolling. Standalone admin
/// pages therefore own a viewport scroll surface explicitly.
export function AdminScrollShell({ children }: { children: ReactNode }) {
  return (
    <main
      data-testid="admin-scroll-shell"
      className="h-dvh overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)] [-webkit-overflow-scrolling:touch]"
    >
      {children}
    </main>
  )
}
