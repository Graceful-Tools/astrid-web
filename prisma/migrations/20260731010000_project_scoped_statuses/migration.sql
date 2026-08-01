-- Task 142e4dd9: shared boards must share status.
--
-- Status lists were per-user and PRIVATE, so on a shared board Alice dragging a
-- card to Doing put it in *Alice's* Doing list; Bob resolved against his own
-- status lists, found no match, and saw the card fall back to Inbox. Two
-- people, one board, silently different columns.
--
-- This migration promotes every already-shared project to project-scoped status
-- lists and moves the existing memberships across. Forward-only and additive:
-- unlike 20260516000000_per_user_status_lists it does NOT drop memberships,
-- because that migration stranded in-progress tasks in Inbox.

-- 1. Projects that are shared: someone other than the owner is either a
--    ProjectMember or a member of one of the project's lists. List sharing is
--    how boards are actually shared, so both paths count.
CREATE TEMPORARY TABLE "_shared_projects" AS
SELECT DISTINCT p."id" AS project_id, p."ownerId" AS owner_id
FROM "Project" p
WHERE EXISTS (
    SELECT 1 FROM "ProjectMember" pm
    WHERE pm."projectId" = p."id" AND pm."userId" <> p."ownerId"
)
OR EXISTS (
    SELECT 1
    FROM "TaskList" l
    JOIN "ListMember" lm ON lm."listId" = l."id"
    WHERE l."projectId" = p."id" AND lm."userId" <> p."ownerId"
);

-- 2. Give each shared project its own Ready / Doing / Waiting, owned by the
--    project owner. Access comes from project membership (task 6c20d125) and,
--    for status lists, from membership of any of the project's domain lists —
--    so every collaborator resolves the same column ids.
INSERT INTO "TaskList" (
    "id", "name", "description", "color", "privacy", "ownerId", "projectId",
    "listType", "statusRole", "statusOrder", "statusDescription",
    "statusCompleted", "imageUrl", "createdAt", "updatedAt"
)
SELECT
    'projstatus_' || sp.project_id || '_' || s.role,
    s.name,
    s.description,
    '#3b82f6',
    'PRIVATE',
    sp.owner_id,
    sp.project_id,
    'status',
    s.role,
    s.ord,
    s.description,
    false,
    NULL,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "_shared_projects" sp
CROSS JOIN (
    VALUES
        ('ready',   'Ready',   'Time to get to work!',                        0),
        ('doing',   'Doing',   'Active work in progress!',                    1),
        ('waiting', 'Waiting', 'Paused until the circumstances are right.',   2)
) AS s(role, name, description, ord)
WHERE NOT EXISTS (
    SELECT 1 FROM "TaskList" existing
    WHERE existing."projectId" = sp.project_id
      AND existing."listType" = 'status'
      AND existing."statusRole" = s.role
);

-- 3. Move existing status memberships onto the project's lists, matching on
--    statusRole, for tasks that are actually in the project's domain. Anything
--    else — a personal status on an unrelated task — is left alone.
--
--    Insert the new membership first, then delete the old one, so a task is
--    never momentarily status-less.
INSERT INTO "_TaskToTaskList" ("A", "B")
SELECT DISTINCT tt."A", proj_status."id"
FROM "_TaskToTaskList" tt
JOIN "TaskList" personal
    ON personal."id" = tt."B"
   AND personal."listType" = 'status'
   AND personal."projectId" IS NULL
JOIN "_shared_projects" sp
    ON sp.owner_id = personal."ownerId"
JOIN "TaskList" proj_status
    ON proj_status."projectId" = sp.project_id
   AND proj_status."listType" = 'status'
   AND proj_status."statusRole" = personal."statusRole"
-- Only tasks that belong to one of this project's domain lists.
WHERE EXISTS (
    SELECT 1
    FROM "_TaskToTaskList" domain
    JOIN "TaskList" dl ON dl."id" = domain."B"
    WHERE domain."A" = tt."A"
      AND dl."projectId" = sp.project_id
      AND dl."listType" <> 'status'
)
ON CONFLICT DO NOTHING;

-- 4. Drop the now-redundant personal status memberships for exactly those
--    task/status pairs we just re-pointed.
DELETE FROM "_TaskToTaskList" old
USING "TaskList" personal, "_shared_projects" sp, "TaskList" proj_status
WHERE old."B" = personal."id"
  AND personal."listType" = 'status'
  AND personal."projectId" IS NULL
  AND sp.owner_id = personal."ownerId"
  AND proj_status."projectId" = sp.project_id
  AND proj_status."listType" = 'status'
  AND proj_status."statusRole" = personal."statusRole"
  AND EXISTS (
      SELECT 1 FROM "_TaskToTaskList" moved
      WHERE moved."A" = old."A" AND moved."B" = proj_status."id"
  );

DROP TABLE "_shared_projects";
