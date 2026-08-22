-- Stage D of removing lists-as-status (task b7b0c2f5).
--
-- Status began as membership in a `listType: 'status'` TaskList. AWTD-562 moved
-- it to `Task.statusRole`; stages A–C moved every reader, both task routes and
-- the CLI scripts onto that field. These rows are what is left: board columns
-- that are no longer read as board columns by any current client. Web and iOS
-- (build 200+, 2026-08-08) both build columns from config, so their deletion is
-- a no-op on any current build.
--
-- Production before this migration: 35 rows across 12 owners, all three default
-- roles, all `projectId IS NULL`, none renamed, no custom status rows, and three
-- task memberships — all belonging to one user, all in Waiting. One of those
-- three carried the membership with a NULL `statusRole`, which is exactly the
-- case step 1 exists for.
--
-- The order matters. Deleting the rows before back-filling turns "a task whose
-- only status was a membership" into a task with no status at all: it lands in
-- Inbox, silently, and nothing records what it used to be.

-- 1. Back-fill `statusRole` from membership, for tasks that have no field yet.
--
--    Restricted to INCOMPLETE tasks on purpose. `completed = true` means the
--    card is in the virtual Done column and carries no status; writing one
--    here would create the violation the completion path spent task db7c6670
--    removing.
--
--    DISTINCT ON makes the choice deterministic when a task somehow sits in two
--    status lists — lowest `statusOrder` wins, i.e. the leftmost column — rather
--    than letting the planner pick.
UPDATE "Task" AS t
SET "statusRole" = picked.role
FROM (
  SELECT DISTINCT ON (x."A")
         x."A" AS task_id,
         l."statusRole" AS role
  FROM "_TaskToTaskList" x
  JOIN "TaskList" l ON l.id = x."B"
  WHERE l."listType" = 'status'
    AND l."statusRole" IS NOT NULL
  ORDER BY x."A", l."statusOrder" ASC NULLS LAST, l.id ASC
) AS picked
WHERE t.id = picked.task_id
  AND t."statusRole" IS NULL
  AND t.completed = false;

-- 2. Refuse to continue if any incomplete task would still lose its status.
--
--    Prisma runs a migration in a transaction, so RAISE rolls the whole thing
--    back rather than leaving the rows half-deleted. The guard is cheap and the
--    failure it catches is invisible: a card quietly in the wrong column.
DO $$
DECLARE
  orphaned integer;
BEGIN
  SELECT count(*) INTO orphaned
  FROM "_TaskToTaskList" x
  JOIN "TaskList" l ON l.id = x."B"
  JOIN "Task" t ON t.id = x."A"
  WHERE l."listType" = 'status'
    AND l."statusRole" IS NOT NULL
    AND t.completed = false
    AND t."statusRole" IS NULL;

  IF orphaned > 0 THEN
    RAISE EXCEPTION
      'Stage D aborted: % incomplete task(s) would lose their status. Back-fill failed.', orphaned;
  END IF;
END $$;

-- 3. Detach every task from every status list.
--
--    Explicit rather than relying on the FK cascade in step 4, so the join rows
--    are gone in a statement that says why.
DELETE FROM "_TaskToTaskList" x
USING "TaskList" l
WHERE l.id = x."B"
  AND l."listType" = 'status';

-- 4. Delete the rows. Everything that references a TaskList cascades
--    (ChatChannel, ListMember, UserListFavorite, MCPToken, SecureFile,
--    ListInvite, ExternalListLink); in production only one empty ChatChannel
--    was attached to any of them.
DELETE FROM "TaskList"
WHERE "listType" = 'status';
