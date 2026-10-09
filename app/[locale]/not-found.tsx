import Link from 'next/link'
import { scrollShellClassName } from '@/components/scroll-shell'

export default function NotFound() {
  return (
    <div className={`${scrollShellClassName} theme-bg-primary`}>
      <div className="min-h-full flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-6xl font-bold theme-text-primary mb-4">404</h1>
          <h2 className="text-2xl font-semibold theme-text-secondary mb-4">Page Not Found</h2>
          <p className="theme-text-secondary mb-8">
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
          </p>
          <Link
            href="/"
            className="inline-flex items-center justify-center px-6 py-3 bg-[rgb(var(--theme-accent))] hover:bg-[rgb(var(--theme-accent-hover))] text-[rgb(var(--theme-accent-text))] font-medium rounded-xl transition-colors"
          >
            Go Home
          </Link>
        </div>
      </div>
    </div>
  )
}
