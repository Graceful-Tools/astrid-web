-- Task AWTD-568: completed tasks must hold no status.
--
-- docs/product/project-status-board.md states the invariant:
--
--   completed = true  =>  no status memberships
--
-- 9 completed tasks still carry one. They predate the invariant being enforced
-- on every write path, and the AWTD-562 backfill deliberately skipped them --
-- which is why Task.statusRole is correctly null for all of them.
--
-- Harmless today: the board renders them in Done because `completed` wins over
-- any status. Worth clearing anyway, because iOS reads memberships and a client
-- that ever preferred status over completion would show them in Ready -- and a
-- documented invariant the data contradicts makes the doc untrustworthy.

DELETE FROM "_TaskToTaskList" tt
USING "TaskList" l, "Task" t
WHERE tt."B" = l."id"
  AND tt."A" = t."id"
  AND l."listType" = 'status'
  AND t."completed" = true;

-- The field half of the same invariant, in case a write path ever sets both.
UPDATE "Task" SET "statusRole" = NULL
WHERE "completed" = true AND "statusRole" IS NOT NULL;
