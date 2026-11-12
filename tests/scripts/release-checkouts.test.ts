/**
 * AWTD-1510 — a Doing release searches every checkout its board's workflow can touch.
 *
 * The Windows loop runs `release-stuck-doing.ts --repo <astrid-windows>`, but a [core]
 * task's work is a branch in the sibling astrid-core checkout. The release looked only at
 * astrid-windows and told the next run the task "starts fresh". These build real git
 * checkouts in a temp directory — two bare remotes and a clone of each, side by side, the
 * way the Windows machine lays them out — and run the same git reads the script runs.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { BOARD_CHECKOUTS } from '@/scripts/lib/board-by-name'
import { checkoutName, readCheckout, releaseCheckouts } from '@/scripts/lib/release-checkouts'
import { releaseDoingClaim } from '@/scripts/lib/doing-release'
import { agentEmail } from '@/lib/brand/agent-emails'

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'init.defaultBranch=main', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

/** A bare remote named `<name>.git` and a clone of it at `<work>/<dir>`, with one commit on main. */
function makeCheckout(root: string, name: string, dir = name): string {
  const remote = join(root, 'remotes', `${name}.git`)
  mkdirSync(remote, { recursive: true })
  git(remote, 'init', '--bare', '-q')
  const seed = join(root, 'seed', name)
  mkdirSync(seed, { recursive: true })
  git(seed, 'init', '-q')
  writeFileSync(join(seed, 'README.md'), name)
  git(seed, 'add', '.')
  git(seed, 'commit', '-q', '-m', 'init')
  git(seed, 'push', '-q', remote, 'HEAD:refs/heads/main')
  const work = join(root, 'work')
  mkdirSync(work, { recursive: true })
  git(work, 'clone', '-q', remote, dir)
  return join(work, dir)
}

function pushBranch(checkout: string, branch: string) {
  git(checkout, 'checkout', '-q', '-b', branch)
  writeFileSync(join(checkout, `${branch.replace(/\//g, '-')}.txt`), branch)
  git(checkout, 'add', '.')
  git(checkout, 'commit', '-q', '-m', branch)
  git(checkout, 'push', '-q', 'origin', branch)
  git(checkout, 'checkout', '-q', 'main')
}

const doingTask = {
  id: 't1510',
  identifier: 'AWTD-1510',
  completed: false,
  statusRole: 'doing',
  creatorId: 'jon',
  creator: { id: 'jon', isAIAgent: false },
  assignee: { email: agentEmail('claude') },
}

async function releaseComment(checkouts: ReturnType<typeof readCheckout>[]) {
  const api = {
    setStatus: vi.fn(async () => {}),
    handBack: vi.fn(async () => {}),
    comment: vi.fn(async (_task: { id: string }, _content: string) => {}),
  }
  await releaseDoingClaim({ task: doingTask, comments: [], branches: [], checkouts, why: 'The run died.', api })
  return api.comment.mock.calls[0][1] as string
}

describe('AWTD-1510: the checkouts a board can touch', () => {
  it('AWTD-1510: the Windows board touches astrid-windows and astrid-core', () => {
    expect(BOARD_CHECKOUTS.windows).toEqual(['astrid-windows', 'astrid-core'])
    expect(BOARD_CHECKOUTS.web).toEqual(['astrid-web'])
  })
})

describe('AWTD-1510: release search across sibling checkouts (temp git repos)', () => {
  let root: string
  let windows: string
  let core: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'awtd-1510-'))
    // The loop's own checkout is a worktree with its own directory name: the repo name
    // comes from its origin, not from the folder.
    windows = makeCheckout(root, 'astrid-windows', 'win-worktree')
    core = makeCheckout(root, 'astrid-core')
    pushBranch(core, 'fix/awtd-1510-core-rule')
    git(windows, 'fetch', '-q', 'origin')
    git(core, 'fetch', '-q', 'origin')
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('AWTD-1510: names a checkout by its origin repo, not its folder', () => {
    expect(checkoutName(windows)).toBe('astrid-windows')
    expect(checkoutName(core)).toBe('astrid-core')
  })

  it('AWTD-1510: --repo astrid-windows alone reaches the sibling astrid-core checkout', () => {
    const found = releaseCheckouts({ repos: [windows] })
    expect(found.map(c => c.name)).toEqual(['astrid-windows', 'astrid-core'])
    expect(found[1].path).toBe(core)
  })

  it('AWTD-1510: the only branch for the task lives in core, and the release comment names it with its repo', async () => {
    const text = await releaseComment(releaseCheckouts({ repos: [windows] }).map(readCheckout))
    expect(text).toContain('`fix/awtd-1510-core-rule` in astrid-core')
    expect(text).not.toMatch(/starts? fresh/)
  })

  it('AWTD-1510: a repeated --repo is not searched twice', () => {
    const found = releaseCheckouts({ repos: [windows, core], board: 'windows' })
    expect(found.map(c => c.name)).toEqual(['astrid-windows', 'astrid-core'])
  })

  it('AWTD-1510: a board without companions searches only its own checkout', () => {
    const found = releaseCheckouts({ repos: [windows], board: 'web' })
    expect(found.map(c => c.name)).toEqual(['astrid-windows'])
  })

  it('AWTD-1510: nothing found says which checkouts were searched, and no fresh start', async () => {
    const lonely = mkdtempSync(join(tmpdir(), 'awtd-1510-lonely-'))
    try {
      const onlyWindows = makeCheckout(lonely, 'astrid-windows')
      const checkouts = releaseCheckouts({ repos: [onlyWindows] })
      expect(checkouts.map(c => c.name)).toEqual(['astrid-windows'])
      const text = await releaseComment(checkouts.map(readCheckout))
      expect(text).toContain('No branch carrying its id was found in the checkouts this loop can see (astrid-windows).')
      expect(text).not.toMatch(/starts? fresh/)
    } finally {
      rmSync(lonely, { recursive: true, force: true })
    }
  })
})
