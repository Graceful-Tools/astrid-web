# SDK channel restart recovery (AWTD-1565)

Restart recovery is **opt-in**. Existing channel configurations keep their current
session recovery and SSE behavior; no server routes, event payloads, SDK version,
first-party clients, or deployment flags change.

```typescript
const adapter = AstridChannel.createAdapter({
  enabled: true,
  clientId,
  clientSecret,
  recovery: {
    stateFile: '/private/agent-state/astrid-delivery.json',
    // Explicit identity of the agent bound to this credential: a built-in
    // mailbox ('claude') or a Custom Agent address ('scout.oc@astrid.cc').
    agentMailbox,
  },
})
await adapter.init()
await adapter.connect(async message => {
  await acceptMessage(message)
})
```

## Identity

`agentMailbox` is sent verbatim as `agent=` to `GET /api/v1/agent-queue`, which
accepts a pollable built-in mailbox or a Custom Agent address
(`<name>.oc@<domain>`) when the caller is that agent or the person who
registered it (AWTD-1642, docs/API_CONTRACT.md). An identity the server does
not accept fails the connection with the server's reason (`Unknown agent "…"`)
instead of reconciling an empty queue. The optional claim sends the mailbox
without its domain, because the claim route compares it with the local part of
the token's agent identity.

The rest of the channel (`/api/v1/agent/tasks`, task detail, comments,
`send()`, and the event stream) is scoped to the token's own user as assignee.
Use the agent's own credential: a person-owned token can read the agent's
queue but cannot read or answer the agent's tasks through these endpoints, so
every reconciled task would be skipped with a warning.

## Delivery and persistence

On every successful SSE connection, including automatic reconnects, the adapter
opens the stream first, then reads pending Ready tasks and task attention from
`/api/v1/agent-queue?agent=<explicit mailbox>`. Optional `lists` scope those reads
to the named boards; unassigned tasks are not included.
The stream buffers events during that read. Pending tasks are delivered rather
than being treated as already processed because a session was recovered.
Queue results and assignment events share one task-id delivery ledger. A restart
restores session mappings for delivered ledger entries without delivering them
again. Task/comment receipts are separate from those session mappings.

The versioned ledger contains only task/comment receipt IDs and pending delivery
intents, a hash of the API base/client ID/mailbox,
and the last accepted server time. Writes use a private temporary file (0600),
fsync, and atomic rename. A file that parses but has the wrong shape, or
belongs to a different agent scope, fails explicitly. An empty or truncated
file (power loss) logs a warning and starts a fresh ledger: that can deliver
work at most once more, where refusing would stop the channel until someone
deleted the file. Give each agent a separate
durable state file and run **one adapter process per file**. This is a local
delivery ledger, not a distributed claim or lock.

Task IDs do not expire with the local clock. In recovery mode, completion/deletion
events re-read the assigned task before removing receipts: a retained terminal
event must not clear a newly accepted reopened task. A currently completed or
no-longer-visible task ends the session; a currently incomplete task keeps it.
Receipts expire after 30 days
measured using server samples, and the ledger holds at most 1,000 task/comment
receipts/intents total. Ending a task (completed, deleted, no longer visible)
removes its comment receipts with it, so finished conversations do not evict
live task receipts. Either eviction logs a warning and can permit old work to be
delivered again. Queue/attention truncation and unread list chat are also reported
explicitly. List-chat messages are not task-channel messages.

Ready tasks lazily try `POST /api/v1/tasks/:id/claim` before first delivery;
attention that starts a new session uses `resume` unless the task is Ready.
Only HTTP 200 `claimed` / `already_yours` proceeds. Body-shaped `conflict`,
`not_ready`, and `not_found` skip the task. An answer that will not change — a
plain disabled-route 404, 405/501, forbidden, or an unknown response shape —
switches to the legacy unclaimed behavior with one warning per adapter
instance. A transient failure (network error, 429, other 5xx) delivers that one
task unclaimed with a warning and claims again next time; it does not disable
claiming for the life of the process. Claims
are never required and this branch does not enable the claim server flag.
An explicit handback still in Waiting can be refused as `not_ready` by the
current claim API; that API does not implement the handback transition.
`already_yours` checks agent ownership, not an instance lease: replicas using the
same agent identity can still both accept work if they maintain distinct ledgers.

A pending delivery intent is persisted before attempting a claim, and replaced
by a delivered receipt after consumer acceptance. Restart/reconnect also recovers
these pending IDs through the assigned-task detail endpoint with `resume`. This
prevents a successful claim from hiding a failed delivery by moving it out of
Ready. If that task is completed, or the assigned-only endpoint returns 404
(deleted/reassigned/no longer visible), its intent is cleared; 404 logs a warning.

Delivery is recorded after the message callback succeeds (including awaiting
an asynchronous callback in recovery mode). A recovery callback or state-write
failure aborts the stream before the replay cursor moves (see below), so replay
retries unaccepted comments as well as pending task intents. Legacy dispatch
remains nonblocking and logs rejected callbacks; a throwing legacy consumer
keeps its session, so later comments on that task still arrive and `send()`
still works, exactly as without recovery. A process crash
between consumer acceptance and ledger persistence
can replay that message. The consumer must use task/session IDs as idempotency
keys for durable side effects: this does **not** promise transactional exactly-once
execution. Task attention and live comments share persisted comment-id receipts
in recovery mode, so replaying an already accepted attention comment is suppressed.
Comments already included in an accepted task's conversation are recorded with
its receipt in the same atomic write.

## Replay cursor and retention gap

The existing agent stream IDs contain event type, task/comment IDs, and the
delivery wall-clock time. The shared replay store uses UUIDs with timestamp
scores, not a server-issued monotonic sequence. `Last-Event-ID` is not accepted
as a replay-store cursor. Making it trustworthy requires a shared ordered store
and replay API changes, not just adding an `id:` line. This branch deliberately
does not change the server or advertise unsupported cursor semantics.

In recovery mode the first connection requests replay from one millisecond after
epoch (zero disables replay in the current endpoint); subsequent connections use
the persisted **server** time cursor minus a 30-second overlap. The client clock
never moves the cursor. Missing/invalid server times log a warning and leave the
cursor unchanged.

The cursor moves only on a `keepalive`, never on `connected`. Recovery dispatch
is sequential, so a keepalive is handled only after every event read before it
was accepted by the consumer (or recorded by the ledger); a crash, `disconnect()`
or keepalive abort before that leaves the cursor where it was, and the next
connection replays the unaccepted event. `connected` is not such a point, because
the server replays missed events after it, asynchronously, and can interleave
keepalives with a slow replay. The cursor therefore also holds until a keepalive
at least 30 seconds (server time) after `connected`, giving the replay that long
to drain. A replay still running after 30 seconds is the remaining window; the
queue reconciliation still recovers pending assignments and the latest attention
comment in that case.
This tolerates client clock skew and modest server timing differences but is
not a monotonic replay guarantee.

A gap of at least the current 15-minute replay retention between server samples
logs a retention-gap warning. Assigned tasks are reconciled on **every**
connection regardless of whether such a gap can be detected. Queue recovery
can recover pending assignments even if their SSE event has expired; it cannot
reconstruct expired comments or terminal events, or infer intermediate
completion/reassignment that occurred entirely while offline.
An attention entry no longer readable through the assigned-only task endpoint is
skipped with a warning instead of preventing unrelated queue/SSE work.

## Reconnects

Both modes reconnect with exponential backoff: 2 s, doubling to a 60 s cap,
with ±20% jitter (never above the cap), and at least the server's `Retry-After`
on a 429. A reconnect that fails before its stream opens — network error, token
failure, 401 after refreshes, 429, 5xx — schedules the next one, so rate limiting
never stops the channel; it keeps retrying at the cap. The backoff resets only
after a `keepalive` is handled, so a stream that opens and immediately fails or
closes keeps backing off instead of reconnecting every few seconds into the
5-per-minute stream limit. `disconnect()` cancels a pending reconnect. The
caller's first `connect()` still rejects if that first attempt cannot open the
stream, as before.

## Release and rollback

Keep `recovery` unset until the branch is reviewed and the consuming agent can
provide private durable state and idempotent acceptance. Disabling the option
restores the legacy channel path. A plain revert rolls back this branch; no
migration, publication, version bump, or production release is performed here.
