import type { ReactNode } from 'react'

/// The global task-manager shell locks html/body scrolling
/// (styles/components.css). Standalone document pages — privacy, terms, docs,
/// help, and friends — therefore own a viewport scroll surface explicitly,
/// otherwise everything below the fold is clipped and unreachable.
///
/// Use `scrollShellClassName` directly when a page's root element already
/// carries layout classes; use `<ScrollShell>` when wrapping is cleaner.
export const scrollShellClassName =
  'h-dvh overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)] [-webkit-overflow-scrolling:touch]'

export function ScrollShell({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div data-testid="scroll-shell" className={`${scrollShellClassName} ${className}`.trim()}>
      {children}
    </div>
  )
}
