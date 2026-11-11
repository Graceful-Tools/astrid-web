/**
 * @vitest-environment jsdom
 */

/**
 * AWTD-1575: the dialog an owner gets when leaving their list was half
 * translated — the title and the picker label came from the locale file, the
 * paragraph that explains what to do, "Transfer & Leave" and "Cancel" did not.
 */
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { OwnerLeaveDialog } from '@/components/owner-leave-dialog'
import { PseudoLocale, hardcodedCopy } from '@/tests/utils/pseudo-messages'
import type { TaskList } from '@/types/task'

// tests/setup.ts answers every key in English; this is about what is NOT a key.
vi.unmock('@/lib/i18n/client')

const list = { id: 'list-1', name: 'Zeltlager' } as TaskList
const me = { id: 'me' }
const members = [
  { user_id: 'me', type: 'member', role: 'owner', name: 'Jo' },
  { user_id: 'a', type: 'member', role: 'admin', name: 'Ada Lovelace' },
  { user_id: 'b', type: 'member', role: 'member', email: 'grace@example.test' },
]

function renderDialog(withMembers: unknown[]) {
  return render(
    <PseudoLocale>
      <OwnerLeaveDialog
        list={list}
        members={withMembers as never[]}
        currentUser={me}
        open
        onClose={() => {}}
        onTransferAndLeave={() => {}}
        onDeleteList={() => {}}
      />
    </PseudoLocale>,
  )
}

describe('owner-leave dialog has no hardcoded English (AWTD-1575)', () => {
  const data = ['Zeltlager', 'Ada Lovelace', 'grace@example.test']

  it('with successors to choose from', () => {
    const { container } = renderDialog(members)
    expect(container.textContent).toContain('Zeltlager')
    expect(hardcodedCopy(container, data)).toEqual([])
  })

  it('with nobody to hand the list to', () => {
    const { container } = renderDialog(members.slice(0, 1))
    expect(hardcodedCopy(container, data)).toEqual([])
  })

  it('keeps the list name inside the translated sentence, so a language can move it', () => {
    const { container } = renderDialog(members)
    const name = container.querySelector('strong')
    expect(name?.textContent).toBe('Zeltlager')
    expect(name?.parentElement?.textContent?.trim()).toMatch(/^⟦.*Zeltlager.*⟧$/)
  })
})
