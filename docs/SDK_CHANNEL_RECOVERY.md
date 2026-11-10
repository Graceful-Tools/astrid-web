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
    agentMailbox, // Explicit identity of the agent bound to this credential.
  },
})
await adapter.init()
await adapter.connect(async message => {
  await acceptMessage(message)
})
```

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
and the last observed server time. Writes use a private temporary file (0600)
and atomic rename. Corrupt, unreadable, unwritable, or different-agent state
fails explicitly; it is never silently discarded. Give each agent a separate
durable state file and run **one adapter process per file**. This is a local
delivery ledger, not a distributed claim or lock.

Task IDs do not expire with the local clock. In recovery mode, completion/deletion
events re-read the assigned task before removing receipts: a retained terminal
event must not clear a newly accepted reopened task. A currently completed or
no-longer-visible task ends the session; a currently incomplete task keeps it.
Receipts expire after 30 days
measured using server samples, and the ledger holds at most 1,000 task/comment
receipts/intents total. Either eviction logs a warning and can permit old work to be
delivered again. Queue/attention truncation and unread list chat are also reported
explicitly. List-chat messages are not task-channel messages.

Ready tasks lazily try `POST /api/v1/tasks/:id/claim` before first delivery;
attention that starts a new session uses `resume` unless the task is Ready.
Only HTTP 200 `claimed` / `already_yours` proceeds. Body-shaped `conflict`,
`not_ready`, and `not_found` skip the task. A plain disabled-route 404,
405/501, forbidden, network/5xx failure, or unknown response shape switches to
the legacy unclaimed behavior with one warning per adapter instance. Claims
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
failure aborts the stream and restores the pre-connection server-time checkpoint,
so replay retries unaccepted comments as well as pending task intents. Legacy
dispatch remains nonblocking and logs rejected callbacks. A process crash
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
epoch (zero disables replay in the current endpoint); subsequent
connections use the last **server** `connected.timestamp` / `keepalive.serverTime`
minus a 30-second overlap. Task events never advance the cursor using the client
clock. Missing/invalid server times log a warning and leave the cursor unchanged.
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

## Release and rollback

Keep `recovery` unset until the branch is reviewed and the consuming agent can
provide private durable state and idempotent acceptance. Disabling the option
restores the legacy channel path. A plain revert rolls back this branch; no
migration, publication, version bump, or production release is performed here.
