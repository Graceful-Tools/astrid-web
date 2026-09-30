# Spec: short task identifiers (`AWTD-1007`, `#1007`)

*Spec of record for the human-readable task id. Task **AWTD-1010**.*

Status: **decided, partly built.** Minting and display exist today (task 12f54df4,
`lib/task-identifier.ts`). This file settles scope, uniqueness, typing and visibility, and
names the follow-up work per client. Companion to
[TASK_BLOCKING_DEPENDENCIES.md](./TASK_BLOCKING_DEPENDENCIES.md), whose "Waiting on" row
is the first surface that needs someone to *type* an id.

> The ask, in Jon's words (2026-09-26): *"astrid windows is already doing something. make
> it consistent. Recommend look at how github does it. Might be globally unique for a
> shared domain but start with everyone on astrid.cc a single shared domain."*

---

## The one thing this spec is really about

**The id already exists, is already minted by the server, and Windows already renders
it.** So there is nothing to invent. The risk is that a second scheme grows up in a
client. The server mints the id and every client displays, parses and links it the same
way. Windows does not derive its own id: it shows the `identifier` field the API returns
(e.g. `AWTD2-44`), and AWTD2-44 is about *when* to show it, not *what* it is.

## How GitHub does it, and what we take

| GitHub | Astrid |
|---|---|
| Issue numbers are per repo: `#123`. | Sequence numbers are per **project**: `AWTD-1007`. |
| `owner/repo#123` is globally unique. | The project **key** is unique across astrid.cc, so `AWTD-1007` alone is globally unique. That is the "single shared domain". |
| `#123` inside a repo means that repo's issue. | `#1007` inside a project's task or list chat means that project's task. |
| Numbers are never reused. | `Project.nextSequence` is never decremented, deletes included. Already true. |
| A transferred issue gets a new number, and the old URL redirects. | A task **keeps its first id forever**, even after moving projects. See *Moving* below for why we deviate. |
| A renamed repo redirects the old name. | Key renames are deferred. When they come, the old key stays as an alias (follow-up W4). |
| You can't learn about an issue you can't see. | A private task's id resolves to the same "not found" as an id that doesn't exist. |

## Decisions

### 1. Format

`KEY-N`. `KEY` is 2–5 characters, a letter followed by letters or digits. `N` is a
positive integer. Input is case-insensitive and stored uppercase. The pattern lives once, in
`parseIdentifier` (`lib/task-identifier.ts`). Clients mirror it from shared fixtures (see
*Consistency*), not from their own copy.

### 2. Uniqueness: keys are unique across astrid.cc

Today `Project.key` is unique **per owner** (`@@unique([ownerId, key])`), but
`Task.identifier` is unique **globally** (`@@unique([identifier])`). The two disagree:

- The first time a second owner's project derives a key someone else already holds, the
  project gets that key.
- Every task created in that project then fails the global unique index. The create in
  `services/task.service.ts` rethrows the P2002 as a 500, or reports a false 409 when the
  request carried a `clientRequestId`.

Production has five keyed projects and no collision (checked 2026-09-26), so this is
latent. It will not stay latent once other users create projects.

**Decision:** keys are unique across astrid.cc. `resolveProjectKeyCollision` checks every
key, not just the owner's, and the constraint becomes `@@unique([key])`. The migration is
safe on current data. A future "domain" (an organisation with its own namespace) would
scope keys the way `owner/` scopes a GitHub repo. That is not built until a second domain
exists.

### 3. Who picks the key

The key is still derived from the project name, as today (`deriveProjectKey`). Collisions
get a digit, so "Astrid Windows To-do" became `AWTD2`. A project owner may **set the key
when the project is created**, before any task is minted. Changing it afterwards is a rename
(W4, AWTD-1024): the tasks become `NEW-N`, and the old key stays behind as an alias.

### 4. Which tasks have an id, and moving

- A task gets an id when it **first** lands on a list that belongs to a project. That
  happens at create today. The follow-up extends it to moves (W1), because a task moved
  into a project currently stays id-less forever.
- A task in no project has no id. A solo user never sees one. That is the progressive
  disclosure rule, and it is unchanged.
- **Moving between projects keeps the first id.** GitHub renumbers on transfer and keeps
  a redirect, but a GitHub issue lives in exactly one repo. An Astrid task can sit on
  several lists at once, so "the project it belongs to" is not single-valued. One
  permanent id per task avoids an alias table and never breaks a branch name or a commit
  message that cites it. The cost is that `AWTD-12` may now sit on the iOS board, and that
  cost is acceptable.

### 5. Typing and linking

- **Full form, anywhere:** `AWTD-1007` in a comment, description or list chat renders as a
  link to that task.
- **Short form, in context:** `#1007` in a comment or chat that belongs to a project
  means that project's key. Outside a project, `#1007` is plain text.
- **Rendering needs no lookup.** Both forms render as a link to `/t/AWTD-1007`. That route
  resolves the id, checks access, and redirects to the task. So rendering a comment never
  costs a query, and it never reveals whether the id exists.
- **Pickers search the server.** The "Waiting on" picker already calls `/api/v1/search`,
  which matches a bare identifier. The `!` mention picker in comments filters tasks
  already on the client, by title only (`hooks/use-chat-mentions.ts`). It must use the same
  server search, so typing `!AWTD-10` finds the task. The stored form is unchanged: the
  mention markdown that `lib/markdown.ts` parses, carrying the task's UUID.
- **Every API that takes a task id takes an identifier.** `GET`, `PUT` and `DELETE
  /api/v1/tasks/[id]`, its comments route, and the hosted MCP operations all resolve
  through `resolveTaskIdOrIdentifier` (W1, AWTD-1016).

### 6. Visibility

- **Resolving is gated.** An identifier the reader cannot see answers exactly like one
  that does not exist: 404 from the API, and "not found" from `/t/…`. No existence oracle.
- **Rendering is gated too.** A reference to a task the reader can't see renders as plain
  text, not as a link that 404s. The "Waiting on" row already hides a hidden blocker's
  title *and* id.
- **The number leaks a count.** `AWTD-1007` says a project has about a thousand tasks.
  GitHub accepts the same leak, and so do we.

### 7. Where the id is shown

The rule every client applies, and the answer to the question on AWTD2-44:

- **Show it when the task is on a list that belongs to a project** (a board). That is
  the same place the id was minted, so "has boards" and "has an id" agree in practice.
- **Always reachable, never shouted:** the id sits in task details next to the lists, and
  every task's context menu (right-click, long-press) has **"Copy task id"**. Rows show it
  in a muted face only on board views.
- A task with an id that is no longer on any project list (moved out) keeps the id for
  links and search, but rows don't show it.

The predicate is a shared rule, so it belongs in `astrid-core` for Windows and in one helper
per client elsewhere. Clients should not open-code it.

## Consistency across clients

The server is the only minter. Every client needs the same three things, checked against
one fixture set:

1. **Parse:** `parseIdentifier` cases, both valid and invalid (`AB-1`, `ab-1`, `A-1` ✗,
   `ABCDEF-1` ✗, `AB-0` ✗).
2. **Autolink:** comment text in, link spans out, for both `KEY-N` and `#N`, with and
   without a project context, and with a hidden target.
3. **Show-rule:** a task's lists in, show or hide out.

The fixtures live in `tests/fixtures/task-identifiers.json` in this repo. astrid-windows
copies them into `contracts/fixtures/`, alongside `smart.json`, and astrid-ios into its
test bundle, the same way the quick-add keyword tables are shared.

## Follow-up work

Web (Astrid Web To-do):

- **W1: server — built (AWTD-1016).** Keys unique across astrid.cc (migration
  `20260926230000_project_key_unique_globally`, global collision check). An id-less task
  gets its id when a move lands it on a project. PUT, DELETE, comments and MCP resolve
  identifiers. `/t/[identifier]` (`lib/task-link.ts`) resolves with gated access. The
  shared fixtures are `tests/fixtures/task-identifiers.json`; the autolink cases take the
  reader's visible project keys as context, so `UTF-8` and `COVID-19` stay prose.
- **W2: UI.** Autolink `KEY-N` and `#N` in comments, descriptions and chat. The `!` picker
  searches the server, including identifiers. Show the id in task details, and add "Copy
  task id" to the task menu. Apply the show-rule to rows.
- **W3: owner sets the key at project creation.**
- **W4: key rename with alias — built (AWTD-1024).** `PATCH /api/v1/projects/:id { key }`
  (owner only; also in the board settings) runs `renameProjectKey`. It rebuilds every
  `OLD-N` as `NEW-N` from `Task.sequence`, and records `OLD` in `ProjectKeyAlias`. An old key
  keeps resolving, the way GitHub redirects renamed repos: `/t/`, the API, MCP and search
  go through `canonicalizeIdentifier`. The autolinker links alias keys too
  (`/api/v1/projects` returns `keyAliases`). An alias is reserved: no other project may take
  it. The same holds for a key whose `KEY-N` ids already exist. Only the same project may
  take its old key back.

Other clients:

- **iOS/Mac (iOS To-do):** show-rule, a details row, "Copy task id" in the context menu,
  and autolinks in comment/chat rendering. Uses the shared fixtures.
- **Windows:** AWTD2-44 already covers the show-rule and its discovery surface. This spec
  answers its open question. Autolinking in `astrid-core` is a separate Windows task.
