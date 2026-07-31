-- Task 12f54df4: human-readable task identifiers (AST-142).
--
-- A UUID is unspeakable — it cannot go in a branch name, a commit message, a
-- PR title or a standup. Scope is the project, so a task on a project-less
-- list gets no identifier at all and a solo user never sees one.

ALTER TABLE "Project" ADD COLUMN "key" TEXT;
ALTER TABLE "Project" ADD COLUMN "nextSequence" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Task" ADD COLUMN "identifier" TEXT;
ALTER TABLE "Task" ADD COLUMN "sequence" INTEGER;

-- Per owner, not global: two people may both want "AST", and forcing global
-- uniqueness would hand out increasingly ugly keys for no benefit.
CREATE UNIQUE INDEX "Project_ownerId_key_key" ON "Project"("ownerId", "key");

-- Identifiers are permanent and never reused, including after delete — a
-- branch named ast-142-* must not come to mean a different task.
CREATE UNIQUE INDEX "Task_identifier_key" ON "Task"("identifier");

-- ── Backfill ───────────────────────────────────────────────────────────────
-- 1. Derive a key per project: initials for multi-word names, leading letters
--    otherwise, capped at 5 chars. Collisions within an owner are resolved by
--    appending the project's rank, which is deterministic and terminates.
WITH derived AS (
    SELECT
        p."id",
        p."ownerId",
        UPPER(
            LEFT(
                CASE
                    WHEN array_length(regexp_split_to_array(regexp_replace(p."name", '[^A-Za-z0-9]+', ' ', 'g'), '\s+'), 1) > 1
                    THEN array_to_string(
                        ARRAY(
                            SELECT LEFT(word, 1)
                            FROM unnest(regexp_split_to_array(trim(regexp_replace(p."name", '[^A-Za-z0-9]+', ' ', 'g')), '\s+')) AS word
                            WHERE word <> ''
                        ), ''
                    )
                    ELSE regexp_replace(p."name", '[^A-Za-z0-9]', '', 'g')
                END,
                5
            )
        ) AS base,
        ROW_NUMBER() OVER (PARTITION BY p."ownerId" ORDER BY p."createdAt") AS rank
    FROM "Project" p
),
keyed AS (
    SELECT
        id,
        CASE
            WHEN base IS NULL OR base = '' OR base !~ '^[A-Z]' THEN 'P' || rank::text
            WHEN rank = 1 THEN base
            -- Later projects for the same owner get a numeric suffix only when
            -- the base actually collides with an earlier one.
            WHEN EXISTS (
                SELECT 1 FROM derived earlier
                WHERE earlier."ownerId" = derived."ownerId"
                  AND earlier.rank < derived.rank
                  AND earlier.base = derived.base
            ) THEN LEFT(base, 4) || rank::text
            ELSE base
        END AS key
    FROM derived
)
UPDATE "Project" p
SET "key" = k.key
FROM keyed k
WHERE p."id" = k.id AND p."key" IS NULL;

-- 2. Number each project's existing tasks in creation order, so the oldest
--    task gets -1. Only tasks on one of the project's lists qualify.
WITH numbered AS (
    SELECT
        t."id" AS task_id,
        p."id" AS project_id,
        p."key" AS project_key,
        ROW_NUMBER() OVER (PARTITION BY p."id" ORDER BY t."createdAt", t."id") AS seq
    FROM "Task" t
    JOIN "_TaskToTaskList" tl ON tl."A" = t."id"
    JOIN "TaskList" l ON l."id" = tl."B"
    JOIN "Project" p ON p."id" = l."projectId"
    WHERE p."key" IS NOT NULL
      AND t."identifier" IS NULL
      AND l."listType" <> 'status'
    GROUP BY t."id", p."id", p."key", t."createdAt"
)
UPDATE "Task" t
SET "identifier" = n.project_key || '-' || n.seq::text,
    "sequence" = n.seq
FROM numbered n
WHERE t."id" = n.task_id;

-- 3. Advance each project's counter past what we just handed out, so the next
--    allocation cannot collide with a backfilled identifier.
UPDATE "Project" p
SET "nextSequence" = COALESCE(
    (
        SELECT MAX(t."sequence") + 1
        FROM "Task" t
        JOIN "_TaskToTaskList" tl ON tl."A" = t."id"
        JOIN "TaskList" l ON l."id" = tl."B"
        WHERE l."projectId" = p."id" AND t."sequence" IS NOT NULL
    ),
    1
);
