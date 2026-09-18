-- Delete the leftover `listType = 'status'` TaskList rows (AWTD-956).
--
-- Stage D (20260821000000_drop_status_lists) already ran exactly this delete,
-- unconditionally, and it worked. These rows are NOT ones it missed — they were
-- created AFTER it:
--
--   Stage D finished   2026-08-22T04:15:28Z
--   the three rows     2026-08-22T19:24:07Z   (~15 hours later)
--
-- All three belong to `uitest@astrid.cc`, the account the iOS UI suite runs as,
-- and that suite runs against PRODUCTION. Their names and descriptions match
-- DEFAULT_STATES verbatim. So they are debris from a UI-test run on an iOS
-- build that still carried the old "write a status list alongside the custom
-- state" path, which `addUserStatus` dropped in 19efe5d4.
--
-- That distinction decides whether this delete is durable. Nothing in the
-- current tree writes `listType: 'status'`: the only live mention is a
-- visibility WHERE clause in lib/list-permissions.ts, and addUserStatus's own
-- comment says the second write "would recreate exactly what the migration
-- removed". An OLD iOS build pointed at production could do it again; no
-- current code can.
--
-- Checked against production before writing this: zero task memberships, and
-- zero attached ChatChannel / ListMember / UserListFavorite / SecureFile rows.
-- This destroys three rows and nothing else.

-- Refuse rather than orphan. Stage D backfilled `Task.statusRole` from these
-- memberships before deleting, and that backfill is long done; if a membership
-- has appeared since, something is creating status lists again and this
-- migration is the wrong tool for it. Prisma runs a migration in a transaction,
-- so the RAISE rolls the delete back rather than half-applying it.
DO $$
DECLARE
  linked integer;
BEGIN
  SELECT count(*) INTO linked
  FROM "_TaskToTaskList" x
  JOIN "TaskList" l ON l.id = x."B"
  WHERE l."listType" = 'status';

  IF linked > 0 THEN
    RAISE EXCEPTION
      'AWTD-956 aborted: % task membership(s) still point at a status list. Something is creating them again — investigate before deleting.', linked;
  END IF;
END $$;

DELETE FROM "TaskList"
WHERE "listType" = 'status';
