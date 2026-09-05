/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { CustomAgentManager } from '@/components/custom-agent-manager'
import en from '@/lib/i18n/locales/en.json'

describe('CustomAgentManager (AWTD-761)', () => {
  it('uses generic product copy and the generic management route', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ agents: [] }),
    })
    global.fetch = fetchMock

    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <CustomAgentManager />
      </NextIntlClientProvider>
    )

    expect(await screen.findByText(/No custom agents connected/i)).toBeInTheDocument()
    expect(screen.queryByText(/OpenClaw/i)).not.toBeInTheDocument()
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/custom-agents/agents',
        expect.any(Object)
      )
    )
  })
})
