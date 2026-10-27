/**
 * AWTD-1286: the self-hosted cron runner fires vercel.json's jobs when Vercel would.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { cronJobs, cronMatches, crontabLines, parseCron } from '@/scripts/lib/cron-schedule.mjs'

const at = (iso: string) => new Date(iso)

describe('cronMatches (AWTD-1286)', () => {
  it('every minute', () => {
    expect(cronMatches('* * * * *', at('2026-10-27T13:37:00Z'))).toBe(true)
  })

  it('a step, in UTC', () => {
    expect(cronMatches('*/15 * * * *', at('2026-10-27T13:45:10Z'))).toBe(true)
    expect(cronMatches('*/15 * * * *', at('2026-10-27T13:46:00Z'))).toBe(false)
  })

  it('a daily time is UTC, not the machine’s zone', () => {
    expect(cronMatches('0 8 * * *', at('2026-10-27T08:00:30Z'))).toBe(true)
    expect(cronMatches('0 8 * * *', at('2026-10-27T09:00:00Z'))).toBe(false)
  })

  it('a weekday, with 7 as Sunday too', () => {
    // 2026-11-01 is a Sunday.
    expect(cronMatches('0 0 * * 0', at('2026-11-01T00:00:00Z'))).toBe(true)
    expect(cronMatches('0 0 * * 7', at('2026-11-01T00:00:00Z'))).toBe(true)
    expect(cronMatches('0 0 * * 0', at('2026-11-02T00:00:00Z'))).toBe(false)
  })

  it('ranges and lists', () => {
    expect(cronMatches('0 9-17/4 * * 1-5', at('2026-10-27T13:00:00Z'))).toBe(true)
    expect(cronMatches('5,35 * * * *', at('2026-10-27T13:35:00Z'))).toBe(true)
    expect(cronMatches('5,35 * * * *', at('2026-10-27T13:36:00Z'))).toBe(false)
  })

  it('day of month OR day of week when both are restricted, as crontab does', () => {
    // 2026-10-27 is a Tuesday, the 27th.
    expect(cronMatches('0 0 1 * 2', at('2026-10-27T00:00:00Z'))).toBe(true)
    expect(cronMatches('0 0 27 * 0', at('2026-10-27T00:00:00Z'))).toBe(true)
    expect(cronMatches('0 0 1 * 0', at('2026-10-27T00:00:00Z'))).toBe(false)
  })

  it.each(['* * * *', '60 * * * *', '* 24 * * *', '*/0 * * * *', '5-1 * * * *', 'a * * * *'])(
    'refuses %j',
    expression => {
      expect(() => parseCron(expression)).toThrow()
    }
  )
})

describe('vercel.json is the runner’s schedule (AWTD-1286)', () => {
  const jobs = cronJobs(JSON.parse(readFileSync('vercel.json', 'utf8')))

  it('parses every job Vercel runs', () => {
    expect(jobs.length).toBeGreaterThan(0)
    for (const job of jobs) expect(job.path).toMatch(/^\/api\/cron\//)
  })

  it('runs the per-minute jobs every minute', () => {
    const everyMinute = jobs.filter(job => job.schedule === '* * * * *').map(job => job.path)
    expect(everyMinute).toContain('/api/cron/reminders')
  })

  it('prints one crontab line per job, sending the secret', () => {
    const lines = crontabLines(jobs, 'https://tasks.example.test')
    expect(lines).toHaveLength(jobs.length)
    expect(lines[0]).toContain('Authorization: Bearer $CRON_SECRET')
    expect(lines[0]).toContain(`https://tasks.example.test${jobs[0].path}`)
  })
})
