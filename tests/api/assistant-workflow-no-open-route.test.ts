/**
 * The assistant workflow must not be reachable over HTTP without
 * authentication (task 12b3478d).
 *
 * WHAT WAS WRONG. `POST /api/assistant-workflow` had no authentication of any
 * kind — no session, no scope, no secret. It read the body and went straight to
 * work: loading a task by id, building a prompt from its title, description and
 * last ten comments, calling a model with the API key belonging to whatever
 * `creatorId` the body named, and posting the answer as a comment authored by
 * the agent. Anyone who could reach the URL could read any task by id and spend
 * another user's model credits.
 *
 * It is the same self-fetch idiom as task 46acd19c, and it was open for the
 * same reason: three server-side callers fetched this app's own HTTP API with
 * no credentials, so the route "had" to accept anonymous requests for them to
 * work. Where 46acd19c failed loudly-in-a-swallowed-catch (401, logged as
 * success), this one succeeded — which is why nobody noticed.
 *
 * THE FIX IS THE ONE JON ALREADY CHOSE THERE: extract the work into a lib
 * function and have the in-process callers call it directly. A same-process
 * trigger has no reason to go through the network. That removes the
 * authentication question rather than answering it — there is no request, so
 * there is no session to fake and no internal secret to leak.
 *
 * AND THEN THE ROUTE GOES, because after that nothing calls it over HTTP at
 * all: not app/, components/, hooks/ or scripts/, and not astrid-ios. The
 * alternative — keeping it behind auth — would mean inventing an authorization
 * model for a caller that does not exist, and `creatorId` arriving in the body
 * means that model would have to stop an authenticated user from spending a
 * different user's credits. Dead surface with a bespoke rule guarding it is
 * worse than no surface.
 *
 * WHY NOT THE INTERNAL-SECRET PATTERN, which this repo already has:
 * app/api/internal/user-model-preferences checks `X-Internal-Secret` against
 * INTERNAL_API_SECRET. Nothing in the tree sends that header and the variable
 * is in neither .env.local nor .env.example, so that route answers 401 to
 * everyone. It is a cautionary tale rather than a pattern, and copying it here
 * would have turned an open endpoint into a dead one.
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

describe('no unauthenticated assistant-workflow route (task 12b3478d)', () => {
  it('the route file is gone', () => {
    expect(
      existsSync(join(ROOT, 'app/api/assistant-workflow/route.ts')),
      'an HTTP entry point into the assistant workflow is back — if it is ' +
        'needed again it must authenticate the caller AND derive creatorId ' +
        'server-side rather than from the body',
    ).toBe(false)
  })

  it('no server code fetches the workflow over HTTP any more', () => {
    // The three self-fetch call sites named in the task. Checking the sources
    // rather than mocking fetch: the property is that the URL is not built at
    // all, which is what makes the route safe to delete.
    //
    // Comments are stripped first. All three files now EXPLAIN in prose that
    // they used to fetch /api/assistant-workflow, and an earlier version of
    // this assertion failed on that explanation — testing the documentation
    // instead of the code.
    const stripComments = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

    const callers = [
      'lib/prisma.ts',
      'lib/webhooks/comment-notifier.ts',
      'lib/webhooks/task-assignment-notifier.ts',
    ]
    const offenders = callers.filter(f => /\/api\/assistant-workflow/.test(stripComments(read(f))))
    expect(offenders, `still fetching a deleted route: ${offenders.join(', ')}`).toEqual([])
  })

  it.each([
    'lib/prisma.ts',
    'lib/webhooks/comment-notifier.ts',
    'lib/webhooks/task-assignment-notifier.ts',
  ])('%s calls runAssistantWorkflow directly', file => {
    expect(read(file)).toMatch(/runAssistantWorkflow/)
  })
})

describe('the extracted workflow behaves like the route did (task 12b3478d)', () => {
  it('reports a missing task instead of throwing', async () => {
    const { runAssistantWorkflow } = await import('@/lib/assistant-workflow/run-assistant-workflow')
    const result = await runAssistantWorkflow({
      taskId: 'does-not-exist-12b3478d',
      agentEmail: 'claude@astrid.cc',
      creatorId: 'nobody',
    })
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ status: 404 })
  })

  it('refuses an address that is not a registered agent', async () => {
    // getServiceFromEmail must keep returning null for unknown addresses —
    // getAgentConfig's own fallback is 'claude', so a wrapper that forwarded
    // that would run a stranger's prompt on the named creator's key.
    const { runAssistantWorkflow } = await import('@/lib/assistant-workflow/run-assistant-workflow')
    const result = await runAssistantWorkflow({
      taskId: 'does-not-exist-12b3478d',
      agentEmail: 'attacker@example.com',
      creatorId: 'nobody',
    })
    expect(result.ok).toBe(false)
  })
})
