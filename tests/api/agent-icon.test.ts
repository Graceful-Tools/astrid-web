/**
 * Regression for task 2f1ec1af: the Copilot agent's icon must be the current
 * GitHub Copilot mark (helmet, goggles, two mouth dashes), not the retired
 * glyph with oval eyes.
 *
 * The route prefers the upstream simpleicons SVG, but production serves the
 * local fallback (`public/images/ai-agents/copilot.svg`) whenever that fetch
 * fails — which is what users actually saw. So the contract under test is the
 * fallback path with upstream down.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/v1/agent-icon/[slug]/route'

/**
 * Distinctive opening of the current official mark's outline (Simple Icons
 * `githubcopilot`, which tracks GitHub's brand asset). The retired glyph
 * opens with `M23.922 16.992c-.861 1.495` instead.
 */
const CURRENT_COPILOT_MARK = 'M23.922 16.997C23.061 18.492'

async function getIcon(slug: string) {
  return GET(new NextRequest(`http://localhost/api/v1/agent-icon/${slug}`), {
    params: Promise.resolve({ slug }),
  })
}

describe('GET /api/v1/agent-icon/[slug]', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('upstream down')))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('serves the current GitHub Copilot mark from the local fallback when upstream is down (task 2f1ec1af)', async () => {
    const res = await getIcon('copilot')

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml')
    const svg = await res.text()
    expect(svg).toContain('<svg')
    expect(svg).toContain(CURRENT_COPILOT_MARK)
  })

  /**
   * The mark fills its 24×24 box edge to edge, so in a round avatar it looked
   * cramped. The route pads the viewBox by 12.5% a side for copilot — on both
   * sources, since production serves whichever one answers.
   */
  const PADDED_VIEWBOX = 'viewBox="-3 -3 30 30"'

  it('pads the Copilot mark with margin when serving the local fallback', async () => {
    const svg = await (await getIcon('copilot')).text()
    expect(svg).toContain(PADDED_VIEWBOX)
  })

  it('pads the Copilot mark with margin when serving the upstream icon', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>',
    }))
    const svg = await (await getIcon('copilot')).text()
    expect(svg).toContain(PADDED_VIEWBOX)
  })
})
