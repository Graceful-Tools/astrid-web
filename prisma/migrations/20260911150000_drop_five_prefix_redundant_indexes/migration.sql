-- AWTD-855: drop 5 of the 14 prefix-redundant indexes. The other 9 stay, and
-- the evidence for keeping them is the point of this migration as much as the
-- drops are.
--
-- A prefix-redundant index is a single-column @@index whose column already
-- leads a composite — @@index([assigneeId]) beside @@index([assigneeId,
-- completed]). The composite can serve the lookup, so the narrow one is
-- redundant for THAT query. It is not redundant the way a duplicate of a
-- UNIQUE constraint is (see 20260908000000, which needed no plan): the narrow
-- index is physically smaller, so a plan scanning a large fraction of it
-- touches fewer pages, and Postgres will genuinely prefer it for some shapes.
-- That is why this half was held back for production evidence.
--
-- THE EVIDENCE. `npx tsx scripts/index-drop-evidence.ts --prod` reads
-- pg_stat_user_indexes for all 14 and reports, per index, whether the planner
-- actually chose it. Run 2026-09-11 over a 5.4-day statistics window (Neon
-- resets cumulative statistics when the compute restarts, so the window is
-- measured from pg_postmaster_start_time, not stats_reset, which reads NULL
-- there):
--
--   9 of the 14 were scanned in production. Holding this half back was right.
--   Comment_taskId_idx alone served 1,581,363 lookups and Task_completed_idx
--   332,459 — and in both cases the composite meant to cover them was scanned
--   far less or not at all. Dropping all 14 on the structural argument would
--   have been a read regression on the two hottest tables.
--
-- The 5 below are the ones where nothing relied on the narrow index. Each is
-- justified on its own terms rather than on the aggregate.

-- 1 & 2. A sibling leading with the same column is demonstrably doing the work.
--
-- ProjectMember_projectId_idx: 0 scans, while ProjectMember_projectId_role_idx
-- served 11,590. EXPLAIN on `WHERE "projectId" = $1` selects the composite:
--
--   Bitmap Heap Scan on "ProjectMember"
--     ->  Bitmap Index Scan on "ProjectMember_projectId_role_idx"
--           Index Cond: ("projectId" = ...)
--
-- ListMember_listId_idx: 0 scans, and so is ListMember_listId_role_idx — the
-- 361,839 lookups all went to the UNIQUE index on (listId, userId), which
-- leads with listId and therefore already covers the prefix.
DROP INDEX IF EXISTS "public"."ProjectMember_projectId_idx";
DROP INDEX IF EXISTS "public"."ListMember_listId_idx";

-- 3. No query filters Task on reminderTime — in the window or in the code.
--
-- Task_reminderTime_idx and Task_reminderTime_reminderSent_idx were both at 0
-- scans, which on its own is ambiguous: a reminder sweep that had not run
-- since the compute restart would leave exactly the same trace. So this one
-- was settled in the source rather than in the statistics. Reminder delivery
-- runs off ReminderQueue.scheduledFor (lib/reminder-service.ts);
-- Task.reminderTime is written by lib/reminder-manager.ts and read back
-- per-row, never used as a filter. Nothing can regress because nothing
-- queries it.
--
-- Kept deliberately: the composite Task_reminderTime_reminderSent_idx, which
-- is not prefix-redundant and is the index a future sweep would want. If such
-- a sweep is ever written, EXPLAIN showed it planning as an Index Cond on both
-- columns there — strictly better than this narrow index plus a Filter.
DROP INDEX IF EXISTS "public"."Task_reminderTime_idx";

-- 4 & 5. Invitation is an empty table, and the composites cover the prefix.
--
-- 0 live rows, 0 writes ever, 0 scans on every index including the primary
-- key: this feature has no production traffic at all. That is weaker evidence
-- than the cases above — it shows nothing uses the TABLE, not that a composite
-- outcompeted the narrow index. It is enough here because the structural
-- argument stands on its own: Invitation_email_status_idx leads with email and
-- Invitation_senderId_status_idx leads with senderId, so if the feature ever
-- activates, both lookups are covered.
DROP INDEX IF EXISTS "public"."Invitation_email_idx";
DROP INDEX IF EXISTS "public"."Invitation_senderId_idx";

-- LOCKING: DROP INDEX takes an ACCESS EXCLUSIVE lock on the table, but it is a
-- catalogue update rather than a table rewrite, so it is brief even on Task.
-- Not written CONCURRENTLY because Prisma runs each migration inside a
-- transaction and DROP INDEX CONCURRENTLY cannot run in one.
--
-- IF EXISTS on every statement so the file is re-runnable after a partial
-- apply.
--
-- BEFORE THE MANUAL DEPLOY (CLAUDE.md rule 1 — migrations apply during the
-- deploy, not on merge): re-run `npx tsx scripts/index-drop-evidence.ts --prod`.
-- The statistics window moves, and any of these 5 turning up with scans since
-- 2026-09-11 is a read regression this file would otherwise cause.
