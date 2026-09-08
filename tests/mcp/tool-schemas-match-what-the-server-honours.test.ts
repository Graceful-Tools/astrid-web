/**
 * RED for task ba84653c.
 *
 * `get_agent_queue` returns tasks that are assigned to the agent AND carry
 * `statusRole: "ready"`. Both conditions are required, so a harness that cannot
 * set the second cannot put a single task into its own queue.
 *
 * Over MCP, `statusRole` was not in the Zod schema. Zod strips unknown keys by
 * default, so it vanished before the PUT was built and the handler still
 * reported `success: true`. The task came back with `statusRole: null` and no
 * error anywhere. The v1 API has accepted `statusRole` the whole time
 * (app/api/v1/tasks/[id]/route.ts) — only the MCP layer dropped it.
 *
 * Two silent-drop bugs of the same shape sat next to it:
 *   - `repeatFrom` is ADVERTISED on both tools and was in neither Zod schema.
 *     Documented, sent in good faith, discarded.
 *   - `assigneeId` is in the Zod schema and advertised on NEITHER tool. It
 *     worked, but only if you guessed.
 *
 * So this file does not test the three fields; it tests the drift itself. The
 * advertised JSON schema and the schema the server enforces have to describe
 * the same set of fields, in both directions, or one of these comes back.
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import { OAUTH_MCP_TOOLS, CreateTaskSchema, UpdateTaskSchema } from '@/mcp/mcp-server-oauth'
import {
  CreateTaskSchema as SharedCreateTaskSchema,
  UpdateTaskSchema as SharedUpdateTaskSchema,
} from '@/mcp/schemas'

/**
 * `listId` / `listIds` are resolved by createTask BEFORE the body is validated
 * — they pick the target list rather than describing the task — so they are
 * advertised without appearing in CreateTaskSchema. This is the only exemption;
 * anything else that drifts is a bug, not a special case.
 */
const RESOLVED_BEFORE_VALIDATION = new Set(['listId', 'listIds'])

function advertised(toolName: string): Set<string> {
  const tool = OAUTH_MCP_TOOLS.find(t => t.name === toolName)
  if (!tool) throw new Error(`No such MCP tool: ${toolName}`)
  const props = (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}
  return new Set(Object.keys(props))
}

function enforced(schema: z.ZodObject<z.ZodRawShape>): Set<string> {
  return new Set(Object.keys(schema.shape))
}

const TOOLS = [
  { tool: 'create_task', schema: CreateTaskSchema },
  // update_task takes taskId in the same body it validates.
  { tool: 'update_task', schema: UpdateTaskSchema },
] as const

describe('the MCP task tools advertise exactly what the server honours', () => {
  for (const { tool, schema } of TOOLS) {
    it(`${tool}: every advertised field is actually accepted`, () => {
      const dropped = [...advertised(tool)]
        .filter(f => !RESOLVED_BEFORE_VALIDATION.has(f))
        .filter(f => !enforced(schema).has(f))

      // A field in the tool schema that the validator strips is the worst
      // shape of this bug: the caller was TOLD to send it.
      expect(dropped).toEqual([])
    })

    it(`${tool}: every accepted field is advertised`, () => {
      const undocumented = [...enforced(schema)].filter(f => !advertised(tool).has(f))

      // A field that works but is not in the schema is discoverable only by
      // guessing, which is how assigneeId stayed invisible.
      expect(undocumented).toEqual([])
    })
  }
})

describe('a task can be made queue-eligible through MCP alone', () => {
  it('update_task carries statusRole through validation', () => {
    const parsed = UpdateTaskSchema.parse({ taskId: 'task-1', statusRole: 'ready' })

    expect(parsed.statusRole).toBe('ready')
  })

  it('update_task can clear statusRole back to Inbox', () => {
    const parsed = UpdateTaskSchema.parse({ taskId: 'task-1', statusRole: null })

    expect(parsed.statusRole).toBeNull()
  })

  it('create_task can file a task straight into Ready', () => {
    const parsed = CreateTaskSchema.parse({ title: 'Do the thing', statusRole: 'ready' })

    expect(parsed.statusRole).toBe('ready')
  })

  it('create_task carries assigneeId, so a task can be created already claimed', () => {
    const parsed = CreateTaskSchema.parse({ title: 'Do the thing', assigneeId: 'ai-agent-claude' })

    expect(parsed.assigneeId).toBe('ai-agent-claude')
  })

  it('both tools carry repeatFrom, which was advertised and silently dropped', () => {
    expect(CreateTaskSchema.parse({ title: 't', repeatFrom: 'DUE_DATE' }).repeatFrom).toBe('DUE_DATE')
    expect(UpdateTaskSchema.parse({ taskId: 't', repeatFrom: 'DUE_DATE' }).repeatFrom).toBe('DUE_DATE')
  })
})

describe('a field the server will not honour fails loudly', () => {
  it('update_task rejects an unrecognised field instead of stripping it', () => {
    // The whole point. `success: true` with nothing changed is the failure mode
    // that made the original bug invisible.
    expect(() => UpdateTaskSchema.parse({ taskId: 'task-1', statusRoll: 'ready' })).toThrow()
  })

  it('create_task rejects an unrecognised field instead of stripping it', () => {
    expect(() => CreateTaskSchema.parse({ title: 'Do the thing', stuatsRole: 'ready' })).toThrow()
  })

  it('still rejects a value of the wrong type', () => {
    expect(() => UpdateTaskSchema.parse({ taskId: 'task-1', priority: 99 })).toThrow()
  })
})

/**
 * mcp/mcp-server-oauth.ts declares its own task schemas instead of importing
 * mcp/schemas.ts, which serves the shared-list MCP surface. That duplication is
 * how `statusRole` came to be missing from one and `isAllDay` from the other,
 * and it is why fixing "the MCP schema" the obvious way fixes the copy nobody's
 * tools are validated against.
 *
 * Deleting one of them is its own change. Until then, they agree here.
 */
describe('the two MCP task schema declarations have not drifted', () => {
  it('create accepts the same fields on both surfaces', () => {
    expect([...enforced(CreateTaskSchema)].sort()).toEqual(
      [...enforced(SharedCreateTaskSchema)].sort(),
    )
  })

  it('update accepts the same fields on both surfaces', () => {
    expect([...enforced(UpdateTaskSchema)].sort()).toEqual(
      [...enforced(SharedUpdateTaskSchema)].sort(),
    )
  })

  it('both reject an unrecognised field', () => {
    expect(() => SharedUpdateTaskSchema.parse({ taskId: 't', statusRoll: 'ready' })).toThrow()
    expect(() => UpdateTaskSchema.parse({ taskId: 't', statusRoll: 'ready' })).toThrow()
  })
})
