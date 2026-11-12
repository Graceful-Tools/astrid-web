import type React from "react"
import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, setRequestLocale } from 'next-intl/server'
import { routing } from '@/lib/i18n/routing'
import { BRAND, brandOrigin } from '@/lib/brand/config'
import { brandIconUrl, brandMetadataIcons } from '@/lib/brand/icons'
import { brandAccentCssVars } from '@/lib/brand/css-vars'
import "../globals.css"
// These four used to be `@import` rules at the BOTTOM of globals.css. That is invalid CSS —
// @import must precede all other rules — which PostCSS tolerated and Turbopack (the Next 16
// default) rejects. Hoisting them inside globals.css would have fixed the parse error by
// moving theme and component rules ABOVE Tailwind's output, silently flipping the cascade
// wherever a themed class competes with a utility. Importing them here instead keeps them
// after globals.css in the bundle, so the cascade order is exactly what it was.
// The design tokens (astrid-core's design/tokens.json, vendored). Before the theme stylesheets,
// which read every shared colour from them. docs/specs/DESIGN_SYSTEM.md
import "../../packages/astrid-design/astrid-tokens.css"
import "../../styles/themes/light-theme.css"
import "../../styles/themes/dark-theme.css"
import "../../styles/themes/ocean-theme.css"
// Must come after the three theme stylesheets: the hover variants tie them on
// specificity and win on source order. See the file header.
import "../../styles/themes/hover-variants.css"
import "../../styles/components.css"
import { Providers } from "@/components/providers"
import { SoundInitializer } from "@/components/sound-initializer"

// Force all pages to be dynamically rendered to avoid SessionProvider issues during static generation
export const dynamic = 'force-dynamic'

const inter = Inter({ subsets: ["latin"], display: "swap" })

/**
 * The brand accent as CSS custom properties, so stylesheets can paint it too.
 * CSS cannot read env, so the stylesheets hardcoded the Astrid blue and a
 * partner's focus ring and prose links stayed blue (task 518ec534). The RGB
 * triplets feed `--theme-accent` in styles/themes/*.css; absent, those keep
 * their built-in values (see brandAccentCssVars).
 */
function brandCssVars(): React.CSSProperties {
  return brandAccentCssVars() as React.CSSProperties
}

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
  // There was no OG image at all, so a shared link previewed with nothing (AWTD-1588). The
  // brand's square mark suits the "summary" card. Absolute, as crawlers require: there is
  // no metadataBase here to resolve a relative one against.
  openGraph: {
    type: "website",
    siteName: BRAND.productTitle,
    title: BRAND.productTitle,
    description: BRAND.tagline,
    images: [{ url: `${brandOrigin()}${brandIconUrl({ kind: "icon", size: 512 })}`, width: 512, height: 512, alt: BRAND.appName }],
  },
  twitter: {
    card: "summary",
    title: BRAND.productTitle,
    description: BRAND.tagline,
    images: [`${brandOrigin()}${brandIconUrl({ kind: "icon", size: 512 })}`],
  },
  // Every size from the brand's one source icon; Astrid's own files for Astrid (AWTD-1588).
  icons: {
    icon: brandMetadataIcons(),
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
      // The brand's default theme, so the server's HTML is already under a
      // theme: every colour is a token, and a token only answers under a theme
      // class. ThemeProvider starts from the same default and swaps this class
      // for the stored choice once it has read it.
      className={BRAND.defaultTheme}
      // The brand accent as a CSS custom property, so stylesheets can paint it
      // too. CSS cannot read env, so the stylesheets hardcoded the Astrid blue
      // and a partner's focus ring and prose links stayed blue (task 518ec534).
      style={brandCssVars()}
    >
      <head>
        <link rel="apple-touch-icon" href={brandIconUrl({ kind: "apple-touch" })} />
        <link rel="apple-touch-icon" sizes="180x180" href={brandIconUrl({ kind: "apple-touch" })} />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className={inter.className} style={BRAND.fontFamily ? { fontFamily: BRAND.fontFamily } : undefined}>
        <SoundInitializer />
        <NextIntlClientProvider messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
        {/* Vercel-hosted only: elsewhere both load /_vercel/insights/*, which 404s (AWTD-1286). */}
        {process.env.VERCEL && <Analytics />}
        {process.env.VERCEL && <SpeedInsights />}
      </body>
    </html>
  )
}
