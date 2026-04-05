/**
 * Agent Icon Proxy API
 *
 * GET /api/v1/agent-icon/[slug] — serves cached AI agent brand icons
 *
 * Fetches official brand SVGs from upstream CDN (cdn.simpleicons.org),
 * caches them in memory, and falls back to local SVGs if upstream is down.
 *
 * iOS and web both pull from this endpoint so icons stay consistent
 * and auto-update when brands refresh their logos.
 */

import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { join } from 'path'

interface AgentIconConfig {
  /** Slug on cdn.simpleicons.org */
  simpleIconSlug: string
  /** Official brand hex color (without #) */
  brandColor: string
  /** Local fallback filename in /public/images/ai-agents/ */
  localFallback: string
}

const AGENT_ICONS: Record<string, AgentIconConfig> = {
  claude: {
    simpleIconSlug: 'anthropic',
    brandColor: 'D4A27F',  // Anthropic warm tan/copper
    localFallback: 'claude.svg',
  },
  openai: {
    simpleIconSlug: 'openai',
    brandColor: '412991',  // OpenAI official purple
    localFallback: 'openai.svg',
  },
  gemini: {
    simpleIconSlug: 'googlegemini',
    brandColor: '8E75B2',  // Google Gemini purple
    localFallback: 'gemini.svg',
  },
}

// In-memory cache: slug -> { svg, fetchedAt }
const cache = new Map<string, { svg: string; fetchedAt: number }>()

// Cache for 24 hours
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

// Browser cache: 1 hour fresh, stale-while-revalidate for 24 hours
const CACHE_CONTROL = 'public, max-age=3600, stale-while-revalidate=86400'

async function fetchUpstreamIcon(config: AgentIconConfig): Promise<string | null> {
  try {
    // cdn.simpleicons.org serves colored SVGs: /slug/color
    const url = `https://cdn.simpleicons.org/${config.simpleIconSlug}/${config.brandColor}`
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    const svg = await res.text()
    // Basic validation — must be an SVG
    if (!svg.includes('<svg')) return null
    return svg
  } catch {
    return null
  }
}

async function getLocalFallback(filename: string): Promise<string | null> {
  try {
    const filePath = join(process.cwd(), 'public', 'images', 'ai-agents', filename)
    return await readFile(filePath, 'utf-8')
  } catch {
    return null
  }
}

async function getIcon(slug: string): Promise<string | null> {
  const config = AGENT_ICONS[slug]
  if (!config) return null

  // Check cache
  const cached = cache.get(slug)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.svg
  }

  // Try upstream
  const upstream = await fetchUpstreamIcon(config)
  if (upstream) {
    cache.set(slug, { svg: upstream, fetchedAt: Date.now() })
    return upstream
  }

  // Fall back to local (and cache it so we don't hit disk repeatedly)
  const local = await getLocalFallback(config.localFallback)
  if (local) {
    // Cache local for shorter period so we retry upstream sooner
    cache.set(slug, { svg: local, fetchedAt: Date.now() - CACHE_TTL_MS + 60 * 60 * 1000 })
    return local
  }

  return null
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const svg = await getIcon(slug)

  if (!svg) {
    return NextResponse.json(
      { error: 'Unknown agent icon', validSlugs: Object.keys(AGENT_ICONS) },
      { status: 404 }
    )
  }

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': CACHE_CONTROL,
      'X-Icon-Source': cache.get(slug)?.fetchedAt ? 'cached' : 'fresh',
    },
  })
}
