-- Remove the duplicate status lists created by 20260731010000.
--
-- That migration gave every shared project its own Ready/Doing/Waiting so both
-- members of a board could resolve the same columns. It reintroduced precisely
-- the problem 20260516000000_per_user_status_lists had removed: a user with two
-- boards ended up with NINE status lists — three of each role — surfacing as
-- duplicates in every list picker.
--
-- Status lists are per-user singletons. This moves any membership back onto the
-- owner's per-user row and deletes the project-scoped duplicates.
--
-- Insert-before-delete, so no task is ever momentarily status-less.

-- 1. Make sure every owner of a project-scoped status list actually has a
--    per-user row for that role to move memberships back to. Normally they do
--    (the 20260516 set), but a project created after that migration could have
--    produced a project-scoped row with no per-user counterpart.
INSERT INTO "TaskList" (
    "id", "name", "description", "color", "privacy", "ownerId", "projectId",
    "listType", "statusRole", "statusOrder", "statusDescription",
    "statusCompleted", "imageUrl", "createdAt", "updatedAt"
)
SELECT DISTINCT ON (dup."ownerId", dup."statusRole")
    'userstatus_' || dup."ownerId" || '_' || dup."statusRole",
    dup."name", dup."description", '#3b82f6', 'PRIVATE', dup."ownerId", NULL,
    'status', dup."statusRole", dup."statusOrder", dup."statusDescription",
    false, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaskList" dup
WHERE dup."listType" = 'status'
  AND dup."projectId" IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM "TaskList" personal
      WHERE personal."listType" = 'status'
        AND personal."projectId" IS NULL
        AND personal."ownerId" = dup."ownerId"
        AND personal."statusRole" = dup."statusRole"
  );

-- 2. Re-point memberships from each project-scoped row onto the owner's
--    per-user row for the same role.
INSERT INTO "_TaskToTaskList" ("A", "B")
SELECT DISTINCT tt."A", personal."id"
FROM "_TaskToTaskList" tt
JOIN "TaskList" dup
    ON dup."id" = tt."B"
   AND dup."listType" = 'status'
   AND dup."projectId" IS NOT NULL
JOIN "TaskList" personal
    ON personal."listType" = 'status'
   AND personal."projectId" IS NULL
   AND personal."ownerId" = dup."ownerId"
   AND personal."statusRole" = dup."statusRole"
ON CONFLICT DO NOTHING;

-- 3. Drop the duplicates. Their remaining memberships go with them via the
--    join table's ON DELETE CASCADE, and step 2 already copied each one across.
DELETE FROM "TaskList"
WHERE "listType" = 'status' AND "projectId" IS NOT NULL;

-- 4. Safety net: a task must still hold at most one status. If a task somehow
--    ended up on two per-user status rows, keep the lowest statusOrder.
DELETE FROM "_TaskToTaskList" extra
USING "TaskList" l
WHERE extra."B" = l."id"
  AND l."listType" = 'status'
  AND EXISTS (
      SELECT 1
      FROM "_TaskToTaskList" keep
      JOIN "TaskList" kl ON kl."id" = keep."B" AND kl."listType" = 'status'
      WHERE keep."A" = extra."A"
        AND (kl."statusOrder" < l."statusOrder"
             OR (kl."statusOrder" = l."statusOrder" AND kl."id" < l."id"))
  );
