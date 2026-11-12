import Link from 'next/link'

import { BRAND } from '@/lib/brand/config'

/**
 * Root-level not-found page for routes that don't match any locale.
 * Must include html/body tags since it's outside the locale layout.
 */
export default function NotFound() {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{
          minHeight: '100vh',
          backgroundColor: '#000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem'
        }}>
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: '3.75rem', fontWeight: 'bold', color: '#fff', marginBottom: '1rem' }}>404</h1>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '600', color: '#d1d5db', marginBottom: '1rem' }}>Page Not Found</h2>
            <p style={{ color: '#9ca3af', marginBottom: '2rem' }}>
              The page you&apos;re looking for doesn&apos;t exist or has been moved.
            </p>
            <Link
              href="/"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0.75rem 1.5rem',
                backgroundColor: BRAND.accentColor,
                color: '#fff',
                fontWeight: '500',
                borderRadius: '0.75rem',
                textDecoration: 'none',
                transition: 'background-color 0.2s'
              }}
            >
              Go Home
            </Link>
          </div>
        </div>
      </body>
    </html>
  )
}
