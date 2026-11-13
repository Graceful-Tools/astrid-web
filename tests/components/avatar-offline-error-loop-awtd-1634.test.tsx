/**
 * AWTD-1634: offline, an avatar whose src is in the in-memory image cache
 * (it loaded once while online) re-mounted its <img> after every error,
 * requesting /placeholder.svg thousands of times a second.
 */
import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { clearImageCache } from '@/lib/image-cache'
import * as imageCache from '@/lib/image-cache'

const SRC = '/placeholder.svg'

describe('AvatarImage error handling (AWTD-1634)', () => {
  // Distinct <img> elements ever inserted: each one is a network request.
  let mounted = new Set<HTMLImageElement>()
  let observer: MutationObserver

  beforeEach(() => {
    mounted = new Set()
    observer = new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((n) => {
          if (n instanceof HTMLImageElement) mounted.add(n)
          else if (n instanceof Element) n.querySelectorAll('img').forEach((img) => mounted.add(img))
        })
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
  })

  afterEach(() => {
    observer.disconnect()
    vi.restoreAllMocks()
    clearImageCache()
  })

  it('does not re-mount the <img> after an error when the src was cached earlier', async () => {
    // The src loaded once while online, so the memory cache says it is cached.
    vi.spyOn(imageCache, 'isImageCached').mockImplementation((url) => url === SRC)

    const { container } = render(
      <Avatar>
        <AvatarImage src={SRC} />
        <AvatarFallback>JP</AvatarFallback>
      </Avatar>
    )

    // Offline: every load attempt fails. Fire error on whatever <img> is mounted
    // a bounded number of times; a healthy avatar gives up after the first.
    for (let i = 0; i < 20; i++) {
      const img = container.querySelector('img')
      if (!img) break
      await act(async () => {
        fireEvent.error(img)
      })
    }

    await act(async () => {})
    expect(container.querySelector('img')).toBeNull()
    expect(mounted.size).toBe(1)
    // The fallback shows instead of the broken image.
    expect(container.textContent).toContain('JP')
  })

  it('tries again when the src changes after an error', async () => {
    const { container, rerender } = render(
      <Avatar>
        <AvatarImage src={SRC} />
      </Avatar>
    )
    await act(async () => {
      fireEvent.error(container.querySelector('img')!)
    })
    expect(container.querySelector('img')).toBeNull()

    rerender(
      <Avatar>
        <AvatarImage src="/other.png" />
      </Avatar>
    )
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/other.png')
  })
})
