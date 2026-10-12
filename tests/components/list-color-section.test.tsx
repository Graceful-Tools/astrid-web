/**
 * @vitest-environment jsdom
 *
 * List settings can change a list's colour. With hide_list_images the colour
 * is what marks a list, and there was no way to set it after creation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { buildTaskList } from '../fixtures/domain'

const apiPut = vi.fn()
vi.mock('@/lib/api', () => ({ apiPut: (...args: unknown[]) => apiPut(...args) }))

import { ListColorSection } from '@/components/list-admin/ListColorSection'
import { LIST_COLOR_PALETTE } from '@/lib/brand/colors'

const list = buildTaskList({ id: 'list-1', name: 'Groceries', color: '#3b82f6' })
const ok = (color: string) => ({ json: async () => ({ list: { ...list, color } }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('ListColorSection', () => {
  it('offers every palette colour and marks the current one', () => {
    render(<ListColorSection list={list} canEditSettings onUpdate={() => {}} />)

    const swatches = screen.getAllByRole('radio')
    expect(swatches).toHaveLength(LIST_COLOR_PALETTE.length)
    expect(screen.getByRole('radio', { name: '#3b82f6' })).toHaveAttribute('aria-checked', 'true')
  })

  it('saves only the colour and reports the updated list', async () => {
    apiPut.mockResolvedValue(ok('#22c55e'))
    const onUpdate = vi.fn()
    render(<ListColorSection list={list} canEditSettings onUpdate={onUpdate} />)

    fireEvent.click(screen.getByRole('radio', { name: '#22c55e' }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
    expect(apiPut).toHaveBeenCalledWith('/api/v1/lists/list-1', { color: '#22c55e' })
    expect(onUpdate.mock.calls[0][0].color).toBe('#22c55e')
  })

  it('puts the swatch back when the save is refused', async () => {
    apiPut.mockRejectedValue(new Error('400'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ListColorSection list={list} canEditSettings onUpdate={() => {}} />)

    fireEvent.click(screen.getByRole('radio', { name: '#22c55e' }))

    await waitFor(() =>
      expect(screen.getByRole('radio', { name: '#3b82f6' })).toHaveAttribute('aria-checked', 'true')
    )
  })

  it('saves a custom colour once, after the picker settles', async () => {
    vi.useFakeTimers()
    apiPut.mockResolvedValue(ok('#123456'))
    render(<ListColorSection list={list} canEditSettings onUpdate={() => {}} />)
    const picker = screen.getByLabelText('Custom color')

    fireEvent.change(picker, { target: { value: '#111111' } })
    fireEvent.change(picker, { target: { value: '#123456' } })
    await act(async () => { vi.advanceTimersByTime(500) })

    expect(apiPut).toHaveBeenCalledTimes(1)
    expect(apiPut).toHaveBeenCalledWith('/api/v1/lists/list-1', { color: '#123456' })
  })

  it('renders nothing for someone who cannot edit the list', () => {
    const { container } = render(<ListColorSection list={list} canEditSettings={false} onUpdate={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })
})
