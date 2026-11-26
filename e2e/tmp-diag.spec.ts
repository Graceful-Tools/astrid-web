import { test, expect } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'
import { freshList, seedTask } from './utils/v1-seed'

test('diag: list with tasks after door gate', async ({ page, request }) => {
  const list = await freshList(request, 'Diag')
  for (const t of ['A', 'B', 'C']) await seedTask(request, [list.id], `${t} ${Date.now()}`)
  const logs: string[] = []
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
  page.on('response', (r) => {
    if (r.url().includes('/api/') && !r.ok()) logs.push(`[http ${r.status()}] ${r.url()}`)
  })
  page.on('response', async (r) => {
    if (/\/api\/v1\/(tasks|lists)(\?|$)/.test(r.url())) {
      const body = await r.text().catch(() => '?')
      logs.push(`[resp ${r.status()}] ${r.url()} len=${body.length}`)
    }
  })
  await gotoWithRetry(page, `/lists/${list.id}`)
  let ok = true
  try {
    await expect(page.locator('[data-task-id]')).toHaveCount(3, { timeout: 8000 })
  } catch {
    ok = false
  }
  console.log('DIAG ok=' + ok + '\n' + logs.join('\n'))
})
