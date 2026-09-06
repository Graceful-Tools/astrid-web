import type React from "react"
import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, setRequestLocale } from 'next-intl/server'
import { routing } from '@/lib/i18n/routing'
import { BRAND } from '@/lib/brand/config'
import "../globals.css"
// These four used to be `@import` rules at the BOTTOM of globals.css. That is invalid CSS —
// @import must precede all other rules — which PostCSS tolerated and Turbopack (the Next 16
// default) rejects. Hoisting them inside globals.css would have fixed the parse error by
// moving theme and component rules ABOVE Tailwind's output, silently flipping the cascade
// wherever a themed class competes with a utility. Importing them here instead keeps them
// after globals.css in the bundle, so the cascade order is exactly what it was.
import "../../styles/themes/light-theme.css"
import "../../styles/themes/dark-theme.css"
import "../../styles/themes/ocean-theme.css"
import "../../styles/components.css"
import { Providers } from "@/components/providers"
import { SoundInitializer } from "@/components/sound-initializer"

// Force all pages to be dynamically rendered to avoid SessionProvider issues during static generation
export const dynamic = 'force-dynamic'

const inter = Inter({ subsets: ["latin"], display: "swap" })

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: BRAND.accentColor,
  // Shrink the layout viewport when the on-screen keyboard appears so a
  // position: fixed input sits naturally above the keyboard. Without this,
  // Mobile Safari auto-scrolls the underlying task list to reveal the focused
  // input, which yanks the entire list upward.
  interactiveWidget: "resizes-content",
}

export const metadata: Metadata = {
  title: BRAND.productTitle,
  description: BRAND.tagline,
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: BRAND.appName
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: "website",
    siteName: BRAND.productTitle,
    title: BRAND.productTitle,
    description: BRAND.tagline,
  },
  twitter: {
    card: "summary",
    title: BRAND.productTitle,
    description: BRAND.tagline,
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-48x48.png", sizes: "48x48", type: "image/png" },
      { url: "/favicon-196x196.png", sizes: "196x196", type: "image/png" },
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
  },
}

type Props = {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params

  // Enable static rendering
  setRequestLocale(locale)

  // Get messages for the current locale
  const messages = await getMessages()

  return (
    <html
      lang={locale}
      // The brand accent as a CSS custom property, so stylesheets can paint it
      // too. CSS cannot read env, so the stylesheets hardcoded the Astrid blue
      // and a partner's focus ring and prose links stayed blue (task 518ec534).
      style={{ '--brand-accent': BRAND.accentColor } as React.CSSProperties}
    >
      <head>
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className={inter.className}>
        <SoundInitializer />
        <NextIntlClientProvider messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
