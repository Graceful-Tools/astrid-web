import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf-8')

// AWTD-1435: the app shell had no <main>, no skip link, and a div logo.
describe('app shell accessibility landmarks (AWTD-1435)', () => {
  const shell = read('components/TaskManagerView.tsx')
  const sidebar = read('components/TaskManager/Sidebar/LeftSidebar.tsx')

  it('renders a main landmark that the skip link targets', () => {
    const skip = read('components/TaskManager/SkipToContentLink.tsx')
    expect(shell).toContain('<main id="main-content"')
    expect(skip).toContain('href="#main-content"')
    expect(skip).toContain('t("navigation.skipToContent")')
  })

  it('puts the skip link before the sidebar so it is the first Tab stop', () => {
    expect(shell.indexOf('<SkipToContentLink')).toBeLessThan(shell.indexOf('<LeftSidebar'))
  })

  it('renders the sidebar logo as a button, not a click-only div', () => {
    const logo = sidebar.slice(sidebar.indexOf('{/* Astrid brand header */}'))
    expect(logo.slice(0, logo.indexOf('onClick={onLogoClick}'))).toContain('<button')
    expect(logo).toContain('aria-label={t("navigation.goHome")}')
  })

  it('has the new strings in every locale', () => {
    const dir = path.join(process.cwd(), 'lib/i18n/locales')
    for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.json'))) {
      const nav = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')).navigation
      expect(nav.skipToContent, f).toBeTruthy()
      expect(nav.goHome, f).toBeTruthy()
    }
  })
})
