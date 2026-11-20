/**
 * @vitest-environment jsdom
 */

/**
 * ADEV-159 — one confirm dialog.
 *
 * Five confirms inside List Settings each hand-rolled a `fixed inset-0 bg-black/50` overlay,
 * one of them with its own focus trap, on the day a sixth was built on the dialog primitive.
 * ConfirmDialog is that sixth made general. What it must keep that the hand-rolled ones had:
 * it shows above the settings modal, and Escape closes the confirm without closing settings.
 */

import { describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDialog, ABOVE_MODAL_LAYER } from '@/components/ui/confirm-dialog'
import { SettingsModalShell } from '@/components/list-settings/SettingsModalShell'

function renderInSettings(props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  const onOpenChange = vi.fn()
  const onCancel = vi.fn()
  const onConfirm = vi.fn()
  render(
    <SettingsModalShell open onOpenChange={onOpenChange} header={<h2>List Details</h2>}>
      <ConfirmDialog
        open
        testId="confirm"
        title="Delete List"
        detail="Are you sure?"
        note="This cannot be undone."
        confirmLabel="Delete"
        onCancel={onCancel}
        onConfirm={onConfirm}
        {...props}
      />
    </SettingsModalShell>
  )
  return { onOpenChange, onCancel, onConfirm }
}

describe('ConfirmDialog (ADEV-159)', () => {
  it('sits on the layer above the settings modal, scrim included', () => {
    renderInSettings()
    const confirm = screen.getByTestId('confirm')
    expect(confirm.className).toContain(ABOVE_MODAL_LAYER)
    const scrim = Array.from(document.querySelectorAll('.fixed.inset-0')).find(el => !el.contains(confirm) && el.className.includes('bg-black/50') && el.getAttribute('data-state') === 'open')
    expect(scrim?.className).toContain(ABOVE_MODAL_LAYER)
  })

  it('Escape cancels the confirm and leaves the settings modal open', async () => {
    const user = userEvent.setup()
    const { onOpenChange, onCancel } = renderInSettings()
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('a click inside it never reaches the settings modal, and the buttons do their jobs', async () => {
    const user = userEvent.setup()
    const { onOpenChange, onCancel, onConfirm } = renderInSettings()
    const confirm = screen.getByTestId('confirm')
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }))
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('while busy it cannot be dismissed or confirmed twice', async () => {
    const user = userEvent.setup()
    const { onCancel } = renderInSettings({ busy: true })
    const confirm = screen.getByTestId('confirm')
    expect(within(confirm).getByRole('button', { name: 'Delete' })).toBeDisabled()
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('gives focus back to whatever opened it, though it has no trigger of its own', async () => {
    const user = userEvent.setup()
    function Opener() {
      const [open, setOpen] = React.useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Open</button>
          <ConfirmDialog open={open} testId="confirm" detail="Sure?" confirmLabel="Yes" onCancel={() => setOpen(false)} onConfirm={() => setOpen(false)} />
        </>
      )
    }
    render(<Opener />)
    const opener = screen.getByRole('button', { name: 'Open' })
    await user.click(opener)
    const confirm = await screen.findByTestId('confirm')
    await waitFor(() => expect(confirm).toContainElement(document.activeElement as HTMLElement))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(document.activeElement).toBe(opener))
  })

  it('without a title, the question itself is the accessible name', () => {
    renderInSettings({ title: undefined, detail: 'Remove Groceries from Home?' })
    expect(screen.getByRole('dialog', { name: 'Remove Groceries from Home?' })).toBeInTheDocument()
  })
})

describe('no confirm hand-rolls its overlay (ADEV-159)', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.tsx') ? [full] : []
  })

  it.each(['components/list-admin', 'components/TaskManager/Sidebar'])('%s draws no scrim of its own', dir => {
    const offenders = walk(path.join(process.cwd(), dir)).filter(file =>
      /fixed inset-0[^"'`]*bg-black/.test(readFileSync(file, 'utf8')))
    expect(offenders.map(file => path.relative(process.cwd(), file))).toEqual([])
  })
})
