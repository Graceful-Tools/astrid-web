/**
 * The deployment monitor must only close its OWN tasks (task d893debc).
 *
 * The filter was a substring match on four very common words — 'deployment
 * failure', 'deployment monitoring', 'vercel', 'build'. On the live board it
 * selected a substantive open task about iOS adoption, purely because the title
 * contains the word "build", and posted a canned "Deployment Issues Resolved"
 * comment to it.
 *
 * It had not destroyed the board only by accident: updateAstridTask sent PATCH
 * to a route exporting GET/PUT/DELETE, so completion 405'd and the task
 * survived — while the misleading comment went out regardless, being posted
 * first. Fixing the 405 without fixing the filter would have begun silently
 * closing real bugs, which is why the two changes ship together.
 */

import { describe, it, expect } from 'vitest'
import {
  DEPLOY_MONITOR_TAG,
  deploymentFingerprint,
  isDeploymentMonitorTask,
  selectResolvableTasks,
} from '../../scripts/lib/deployment-monitor-tasks'

/** The real board task the old filter selected. */
const IOS_ADOPTION_TASK = {
  id: 'ios-adoption',
  title: "Delete the vestigial listType:'status' rows once iOS build 200 is adopted",
  description: 'Once the phone has adopted build 200 the rows can go.',
  completed: false,
}

const PREDEPLOY_TASK = {
  id: 'predeploy',
  title: '🔴 Predeploy Failed: Build',
  description: '## Automated Predeploy Failure Report',
  completed: false,
}

const OWN_TASK = {
  id: 'own',
  title: '🚨 Deployment Failure: Module not found',
  description: `${deploymentFingerprint('https://astrid-abc.vercel.app')}\n\n## Deployment Error Details\n**Deployment**: https://astrid-abc.vercel.app`,
  completed: false,
}

const LEGACY_OWN_TASK = {
  id: 'legacy',
  title: '🚨 Deployment Failure: Type error',
  description: '## Deployment Error Details\n**Deployment**: https://astrid-xyz.vercel.app',
  completed: false,
}

describe('selectResolvableTasks', () => {
  it('does not select the iOS adoption task — the reported false positive', () => {
    expect(selectResolvableTasks([IOS_ADOPTION_TASK])).toEqual([])
  })

  it('does not select a predeploy task just because its title says Build', () => {
    expect(selectResolvableTasks([PREDEPLOY_TASK])).toEqual([])
  })

  it('does not select a task that merely mentions Vercel in passing', () => {
    const mentioning = {
      id: 'mention',
      title: 'Write up why the Vercel preview URL was malformed',
      description: 'Notes on the CI capture bug.',
      completed: false,
    }
    expect(selectResolvableTasks([mentioning])).toEqual([])
  })

  it('selects a task this script created', () => {
    expect(selectResolvableTasks([OWN_TASK]).map(t => t.id)).toEqual(['own'])
  })

  it('still recognises tasks created before the tag existed', () => {
    // Otherwise the fix strands every task already on the board.
    expect(selectResolvableTasks([LEGACY_OWN_TASK]).map(t => t.id)).toEqual(['legacy'])
  })

  it('picks its own out of a realistic mixed board', () => {
    const board = [IOS_ADOPTION_TASK, PREDEPLOY_TASK, OWN_TASK, LEGACY_OWN_TASK]
    expect(selectResolvableTasks(board).map(t => t.id).sort()).toEqual(['legacy', 'own'])
  })

  it('skips completed tasks', () => {
    expect(selectResolvableTasks([{ ...OWN_TASK, completed: true }])).toEqual([])
  })

  it('requires the fingerprint, not just the tag', () => {
    // A task carrying the tag but recording no deployment is not evidence that
    // any particular deployment recovered.
    const tagOnly = {
      id: 'tag-only',
      title: '🚨 Deployment Failure: something',
      description: `${DEPLOY_MONITOR_TAG} but no deployment recorded`,
      completed: false,
    }
    expect(selectResolvableTasks([tagOnly])).toEqual([])
  })
})

describe('isDeploymentMonitorTask', () => {
  it('does not accept an exact title prefix alone', () => {
    // A human can write that title. The old bug in a stricter costume.
    expect(
      isDeploymentMonitorTask({
        title: '🚨 Deployment Failure: I typed this myself',
        description: 'no marker here',
      }),
    ).toBe(false)
  })

  it('does not accept the description heading alone', () => {
    expect(
      isDeploymentMonitorTask({
        title: 'My notes on a deploy',
        description: '## Deployment Error Details (pasted from a run)',
      }),
    ).toBe(false)
  })

  it('handles null title and description without throwing', () => {
    expect(isDeploymentMonitorTask({ title: null, description: null })).toBe(false)
  })
})
