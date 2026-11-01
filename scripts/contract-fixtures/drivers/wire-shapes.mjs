// Runs astrid-web's v1 serializers over fixed rows and prints the JSON a client receives.
// Invoked by scripts/export-contract-fixtures.ts; not useful on its own.
//
// The shape iOS, Mac and Windows decode is astrid-core's `model::Task` / `model::List`, and until
// this fixture nothing compared those to what `/api/v1` sends (AWTD-1263). Every one of D52–D55
// (astrid-core docs/CONTRACTS.md), AITD-498/499 and AWTD-1251 was that drift, found by hand after
// a payload changed: `nextOccurrenceId` on one read and not another, `syncState` absent vs null,
// `backend` and `supports` dropped through the cache, an omitted `description` decoded as "".
//
// So the payloads are not described here, they are PRODUCED, in the two steps a request takes:
//
//   1. READ. Each fixed database record goes through the route's own Prisma select or include
//      (`v1TaskListSelect`, `V1_TASK_READ_INCLUDE`, `V1_LIST_READ_INCLUDE`) by `read()` below,
//      which does what Prisma does to a record: an include keeps every scalar and adds the named
//      relations, a select keeps only what it names. A column added to a select therefore shows up
//      here, and `check:contract-fixtures` fails until the fixture is regenerated.
//   2. SHAPE. The row goes through the route's pure shaper (lib/tasks/v1-task-shape.ts,
//      lib/lists/v1-list-shape.ts) and is serialized as NextResponse.json does — JSON.stringify, so
//      a Date becomes an ISO string and an undefined key disappears.
//
// What this file supplies is only the records — every scalar column, under fixed ids and a pinned
// clock. A select naming a column a record lacks throws, rather than exporting a fixture with the
// key silently missing; tests/scripts/wire-shapes-fixture.test.ts checks the records against the
// Prisma schema in the other direction.
//
// The point is the PRESENCE of keys as much as their values, so the surfaces are chosen to put
// fields in each of the three states this wire has: a value, null, and absent. The consumer
// (astrid-core tests/wire_shapes_contract.rs) decodes every body, re-encodes it, and asserts that
// no key was lost and none invented.
//
// Usage: node scripts/contract-fixtures/drivers/wire-shapes.mjs <path-to-astrid-web>

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerWebAliases } from './alias-loader.mjs'

const webRoot = process.argv[2]
if (!webRoot) {
  console.error('usage: node scripts/contract-fixtures/drivers/wire-shapes.mjs <path-to-astrid-web>')
  process.exit(2)
}

// Pinned, not inherited: whether `fields` is in the list select depends on this capability, and a
// fixture must not encode whichever brand the machine that generated it was configured for. It is
// ON so the fixture carries the keys a white-label deployment sends; astrid.cc never does (D5),
// and absent is already one of the states every other surface covers.
process.env.NEXT_PUBLIC_BRAND_ENABLE_PROJECT_MODE = 'true'
process.env.NEXT_PUBLIC_BRAND_ENABLE_GITHUB_PROJECTS = 'true'

registerWebAliases(webRoot)

const load = (rel) => import(pathToFileURL(join(webRoot, rel)).href)
const { shapeV1Task, shapeV1ListPageTask, v1TaskListSelect, v1TaskPageMeta, V1_TASK_READ_INCLUDE } =
  await load('lib/tasks/v1-task-shape.ts')
const { parseOmittedTaskFields } = await load('lib/tasks/v1-task-omit.ts')
const { encodeTaskCursor } = await load('lib/tasks/v1-sync-cursor.ts')
const { shapeV1List, V1_LIST_READ_INCLUDE } = await load('lib/lists/v1-list-shape.ts')

// ── Reading a record the way Prisma does ──────────────────────────────

const RELATIONS = Symbol('relations')

/** A database record: its scalar columns, plus the relations a query may follow. */
const record = (scalars, relations = {}) => ({ ...scalars, [RELATIONS]: relations })

const scalarsOf = (rec) => Object.fromEntries(Object.entries(rec))

function relationOf(rec, key) {
  if (!(key in rec[RELATIONS])) throw new Error(`wire-shapes: the query follows "${key}", which this record does not carry`)
  return rec[RELATIONS][key]
}

/** `rec` read with `query` — `true`, `{ select }` or `{ include }` — as Prisma returns it. */
function read(rec, query) {
  if (Array.isArray(rec)) return rec.map((r) => read(r, query))
  if (rec === null) return null
  if (query === true) return scalarsOf(rec)
  if (query.include) {
    const row = scalarsOf(rec)
    for (const [key, sub] of Object.entries(query.include)) {
      if (sub) row[key] = read(relationOf(rec, key), sub)
    }
    return row
  }
  if (query.select) {
    const row = {}
    for (const [key, sub] of Object.entries(query.select)) {
      if (!sub) continue
      if (key in rec[RELATIONS]) row[key] = read(rec[RELATIONS][key], sub)
      else if (key in rec) row[key] = rec[key]
      else throw new Error(`wire-shapes: the select names "${key}", which this record does not have`)
    }
    return row
  }
  throw new Error(`wire-shapes: cannot read with ${JSON.stringify(query)}`)
}

// What NextResponse.json does to a body.
const wire = (body) => JSON.parse(JSON.stringify(body))

// ── Fixed ids and a pinned clock ──────────────────────────────────────

const T0 = new Date('2026-01-15T09:00:00.000Z')
const at = (minutes) => new Date(T0.getTime() + minutes * 60_000)

const OWNER = 'user-owner-0001'
const MEMBER = 'user-member-0002'
const AGENT = 'ai-agent-claude'
const LIST = 'list-0000-0000-0000-000000000001'
const GITHUB_LIST = 'list-0000-0000-0000-000000000002'
const TASK = 'task-0000-0000-0000-000000000001'
const GITHUB_TASK = 'task-0000-0000-0000-000000000002'
const NEXT_TASK = 'task-0000-0000-0000-000000000003'
const BLOCKER = 'task-0000-0000-0000-000000000004'

// ── Users ─────────────────────────────────────────────────────────────

const user = (id, name, email, image, isAIAgent, aiAgentType) =>
  record({ id, name, email, image, isAIAgent, aiAgentType })

const ownerUser = user(OWNER, 'Owner', 'owner@example.com', null, false, null)
const memberUser = user(MEMBER, 'Member', 'member@example.com', 'https://example.com/m.png', false, null)
const agentUser = user(AGENT, 'Claude Agent', 'claude@astrid.cc', null, true, 'claude_agent')

// ── Lists ─────────────────────────────────────────────────────────────

const member = (listId, userRec, role) =>
  record(
    { id: `member-${listId}-${userRec.id}`, listId, userId: userRec.id, role, createdAt: T0, updatedAt: T0 },
    { user: userRec },
  )

// Every scalar column on TaskList.
function list(id, scalars, relations) {
  return record(
    {
      id,
      name: 'Home',
      description: null,
      color: '#3b82f6',
      imageUrl: null,
      projectId: null,
      listType: 'regular',
      backend: null,
      remoteNodeId: null,
      privacy: 'SHARED',
      createdAt: T0,
      updatedAt: at(10),
      ownerId: OWNER,
      defaultAssigneeId: MEMBER,
      defaultPriority: 0,
      defaultRepeating: 'never',
      defaultIsPrivate: true,
      defaultDueDate: 'none',
      aiAstridEnabled: false,
      copyCount: 0,
      defaultDueTime: null,
      favoriteOrder: null,
      filterAssignedBy: null,
      filterAssignee: null,
      filterCompletion: 'default',
      recentlyCompletedWindow: null,
      showSubtasks: true,
      filterDueDate: null,
      filterInLists: null,
      filterPriority: null,
      filterRepeating: null,
      isFavorite: false,
      isVirtual: false,
      sortBy: 'manual',
      virtualListType: null,
      mcpAccessLevel: 'WRITE',
      mcpEnabled: false,
      aiAgentsEnabled: ['claude'],
      fallbackAiProvider: null,
      githubRepositoryId: null,
      preferredAiProvider: null,
      aiAgentConfiguredBy: null,
      manualSortOrder: [TASK],
      publicListType: null,
      ...scalars,
    },
    {
      owner: ownerUser,
      listMembers: [member(id, ownerUser, 'admin'), member(id, memberUser, 'member')],
      listInvites: [],
      _count: record({ tasks: 0 }),
      ...relations,
    },
  )
}

const classicList = list(LIST, {}, {
  listInvites: [
    record({ id: 'invite-1', listId: LIST, email: 'guest@example.com', role: 'member', token: 'invite-token', createdAt: at(1), createdBy: OWNER }),
  ],
  _count: record({ tasks: 7 }),
})

const githubList = list(GITHUB_LIST, {
  name: 'Acme roadmap',
  description: 'The public roadmap.',
  projectId: 'project-acme',
  backend: 'github_project',
  defaultAssigneeId: 'unassigned',
  aiAgentsEnabled: null,
  githubRepositoryId: 'acme/web',
  aiAgentConfiguredBy: OWNER,
  manualSortOrder: null,
  recentlyCompletedWindow: { amount: 3, unit: 'days' },
  showSubtasks: false,
})

// ── Tasks ─────────────────────────────────────────────────────────────

function comment(id, taskId, minutes, author, content) {
  return record(
    {
      id,
      content,
      type: 'TEXT',
      systemEventType: null,
      createdAt: at(minutes),
      updatedAt: at(minutes),
      authorId: author?.id ?? null,
      taskId,
      attachmentUrl: null,
      attachmentName: null,
      attachmentType: null,
      attachmentSize: null,
      parentCommentId: null,
      clientRequestId: null,
    },
    { author, secureFiles: [] },
  )
}

// Every scalar column on Task.
function task(id, scalars, relations) {
  return record(
    {
      id,
      title: '',
      description: '',
      priority: 0,
      repeating: 'never',
      repeatingData: null,
      isPrivate: false,
      completed: false,
      completedAt: null,
      completedSource: null,
      closedReason: null,
      identifier: null,
      sequence: null,
      statusRole: null,
      statusRoleBeforeDone: null,
      createdAt: T0,
      updatedAt: at(30),
      assigneeId: null,
      assigneeIds: [],
      creatorId: OWNER,
      originalTaskId: null,
      sourceListId: null,
      dueDateTime: null,
      isAllDay: false,
      reminderSent: false,
      reminderTime: null,
      reminderType: null,
      aiAgentId: null,
      clientRequestId: null,
      occurrenceCount: 0,
      repeatFrom: 'COMPLETION_DATE',
      timerDuration: null,
      lastTimerValue: null,
      parentTaskId: null,
      previousOccurrenceId: null,
      costEstimateMicrocents: null,
      costEstimateSource: null,
      remoteNodeId: null,
      remoteKind: null,
      remoteVersion: null,
      syncState: null,
      ...scalars,
    },
    {
      creator: ownerUser,
      assignee: null,
      comments: [],
      attachments: [],
      secureFiles: [],
      blockedBy: [],
      blocks: [],
      nextOccurrences: [],
      fieldValues: [],
      ...relations,
    },
  )
}

// A classic task: no remote columns, so `remote` and `syncState` must be ABSENT on the wire, not
// null; nothing follows it, so `nextOccurrenceId` is null.
const classicTask = task(
  TASK,
  {
    title: 'Water the plants',
    description: 'Front **and** back garden.',
    priority: 2,
    repeating: 'weekly',
    identifier: 'HOME-12',
    sequence: 12,
    statusRole: 'doing',
    assigneeId: MEMBER,
    assigneeIds: [MEMBER],
    dueDateTime: new Date('2026-01-20T00:00:00.000Z'),
    isAllDay: true,
    occurrenceCount: 3,
    repeatFrom: 'DUE_DATE',
  },
  {
    lists: [classicList],
    assignee: memberUser,
    // Newest first, as V1_TASK_READ_INCLUDE orders them; the shaper puts them back in order.
    comments: [
      comment('comment-2', TASK, 20, memberUser, 'On it.'),
      comment('comment-1', TASK, 10, null, 'Owner created this task'),
    ],
    attachments: [
      record({ id: 'attachment-1', name: 'plants.jpg', url: 'https://example.com/plants.jpg', type: 'image/jpeg', size: 1024, createdAt: at(5), taskId: TASK }),
    ],
    blockedBy: [record({ blockingTaskId: BLOCKER })],
  },
)

// A GitHub-backed task in spawn mode: the remote columns become `remote` + `syncState`, the
// occurrence chain is populated, it has two assignees and project field values — one of them a
// cleared value racing the read, which must produce no key rather than a null.
const githubTask = task(
  GITHUB_TASK,
  {
    title: 'Ship the release notes',
    completed: true,
    completedAt: at(90),
    completedSource: 'github',
    closedReason: 'not_planned',
    identifier: 'acme/web#42',
    statusRoleBeforeDone: 'ready',
    assigneeId: AGENT,
    assigneeIds: [AGENT, MEMBER],
    previousOccurrenceId: BLOCKER,
    remoteNodeId: 'I_kwDOexample42',
    remoteKind: 'issue',
    remoteVersion: '2026-01-15T10:30:00Z',
    syncState: 'pending',
  },
  {
    lists: [githubList],
    assignee: agentUser,
    blocks: [record({ blockedTaskId: TASK })],
    nextOccurrences: [record({ id: NEXT_TASK })],
    fieldValues: [
      record({ fieldId: 'field-status', text: null, number: null, date: null, optionId: 'opt-in-progress', iterationId: null }),
      record({ fieldId: 'field-estimate', text: null, number: 3, date: null, optionId: null, iterationId: null }),
      record({ fieldId: 'field-target', text: null, number: null, date: new Date('2026-02-01T00:00:00.000Z'), optionId: null, iterationId: null }),
      record({ fieldId: 'field-cleared', text: null, number: null, date: null, optionId: null, iterationId: null }),
    ],
  },
)

// ── Surfaces ──────────────────────────────────────────────────────────

const META = { apiVersion: 'v1', authSource: 'oauth' }

// GET /api/v1/tasks, with the query parameters parsed the way the route parses them.
function listPage({ omit: omitParam = null, leanListMembers = false, includeFields = false }) {
  const omit = parseOmittedTaskFields(omitParam)
  const select = v1TaskListSelect({
    omit,
    leanListMembers: leanListMembers || omit.has('listMembers'),
    includeComments: false,
    includeFields,
  })
  const rows = read([classicTask, githubTask], { select })
  return wire({
    tasks: rows.map(shapeV1ListPageTask),
    meta: v1TaskPageMeta({ total: rows.length, limit: 100, offset: 0, authSource: META.authSource, omit }),
  })
}

// GET /api/v1/tasks?cursor=&limit=1 — the first page of a keyset walk (AWTD-1470). The walk is
// ordered by (updatedAt, id); the route reads limit+1 rows and issues nextCursor from the last
// row it RETURNS. serverTime is the server clock, pinned here so the fixture is reproducible.
const FIXTURE_SERVER_TIME = '2026-01-01T12:00:00.000Z'
function cursorPage() {
  const omit = parseOmittedTaskFields(null)
  const select = v1TaskListSelect({ omit, leanListMembers: false, includeComments: false, includeFields: false })
  const rows = read([classicTask, githubTask], { select }).sort(
    (a, b) => a.updatedAt - b.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  const page = rows.slice(0, 1)
  return wire({
    tasks: page.map(shapeV1ListPageTask),
    serverTime: FIXTURE_SERVER_TIME,
    nextCursor: encodeTaskCursor(page[0]),
    meta: v1TaskPageMeta({ total: rows.length, limit: 1, offset: 0, authSource: META.authSource, omit }),
  })
}

const readTask = (rec) => shapeV1Task(read(rec, { include: V1_TASK_READ_INCLUDE }))

// The route hydrates the viewer's favorite and view preferences onto the row before shaping.
function readList(rec, viewer) {
  return shapeV1List(
    { ...read(rec, { include: V1_LIST_READ_INCLUDE }), ...viewer.overlay },
    new Map([[MEMBER, read(memberUser, true)]]),
    viewer.backendInfo ?? new Map(),
  )
}

const surfaces = [
  {
    name: 'task.listPage',
    route: 'GET /api/v1/tasks?include=fields',
    shaper: 'v1TaskListSelect → shapeV1ListPageTask, v1TaskPageMeta (lib/tasks/v1-task-shape.ts)',
    note: 'The list page and full sync. No attachments, blockers, comments or nextOccurrenceId; a classic task carries no remote, syncState or fields key at all.',
    body: listPage({ includeFields: true }),
  },
  {
    name: 'task.listPage.omitted',
    route: 'GET /api/v1/tasks?omit=description,listMembers,bogus',
    shaper: 'v1TaskListSelect → shapeV1ListPageTask, v1TaskPageMeta (lib/tasks/v1-task-shape.ts)',
    note: 'description and lists[].listMembers are ABSENT, not null or "": a client must keep what it cached. meta.omitted echoes what was actually dropped; the unknown name is ignored. No include=fields, so no fields key either.',
    body: listPage({ omit: 'description,listMembers,bogus' }),
  },
  {
    name: 'task.listPage.cursor',
    route: 'GET /api/v1/tasks?cursor=&limit=1',
    shaper: 'v1TaskListSelect → shapeV1ListPageTask, v1TaskPageMeta (lib/tasks/v1-task-shape.ts); encodeTaskCursor (lib/tasks/v1-sync-cursor.ts)',
    note: 'A keyset walk page (AWTD-1470): ordered by (updatedAt, id). nextCursor is opaque — send it back as ?cursor= — and is ABSENT on the last page. serverTime (every v1 tasks/lists response) is the server clock read before the query: send it back as the next updatedSince instead of the device clock. An offset page carries serverTime but never nextCursor.',
    body: cursorPage(),
  },
  {
    name: 'task.read',
    route: 'GET /api/v1/tasks/:id',
    shaper: 'V1_TASK_READ_INCLUDE → shapeV1Task (lib/tasks/v1-task-shape.ts)',
    note: 'A classic task: nextOccurrenceId is null (present); remote, syncState and fields are absent.',
    body: wire({ task: readTask(classicTask), meta: META }),
  },
  {
    name: 'task.event',
    route: 'SSE task_created / task_updated → data.v1Task',
    shaper: 'V1_TASK_READ_INCLUDE → shapeV1Task, via loadV1TaskForEvent (lib/tasks/v1-task-shape.ts)',
    note: 'The single read\'s shaper, here on a GitHub-backed task in spawn mode: remote, syncState, fields and nextOccurrenceId all carry values. data.task beside it is the lean agent projection, which the app clients do not decode.',
    body: wire({ taskId: GITHUB_TASK, v1Task: readTask(githubTask) }),
  },
  {
    name: 'list.read',
    route: 'GET /api/v1/lists/:id',
    shaper: 'V1_LIST_READ_INCLUDE → shapeV1List (lib/lists/v1-list-shape.ts)',
    note: 'A classic list, favorited by the viewer: backend and remote are null, supports is the classic set.',
    body: wire({ list: readList(classicList, { overlay: { isFavorite: true, favoriteOrder: 2 } }), meta: META }),
  },
  {
    name: 'list.event',
    route: 'SSE list_updated → data.v1List',
    shaper: 'V1_LIST_READ_INCLUDE → shapeV1List, via loadV1ListsForViewers (lib/lists/v1-list-shape.ts)',
    note: 'A GitHub-backed list: backend, remote and supports carry values; the "unassigned" sentinel resolves defaultAssignee to null; a null aiAgentsEnabled still goes out as [].',
    body: wire({
      listId: GITHUB_LIST,
      v1List: readList(githubList, {
        overlay: { isFavorite: false, favoriteOrder: null },
        backendInfo: new Map([
          [GITHUB_LIST, { remote: { url: 'https://github.com/orgs/acme/projects/7', owner: 'acme', number: 7 }, binding: { priorityFieldId: 'field-priority', dueFieldId: null } }],
        ]),
      }),
    }),
  },
]

console.log(JSON.stringify({
  $source: 'scripts/contract-fixtures/drivers/wire-shapes.mjs — fixed records read through each v1 route\'s query and shaper',
  clock: T0.toISOString(),
  surfaces,
}))
