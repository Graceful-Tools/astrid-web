-- Task AWTD-1074: a custom monthly pattern must carry a monthRepeatType.
--
-- Without one, web, iOS and astrid-core all end the series at its next
-- completion, so "every 6 months" silently stops repeating. Production holds
-- ten such patterns (checked 2026-10-04): all objects, all repeating from the
-- completion date, nine still open.
--
-- Jon's answer on the task: read a missing type as counting from the completion
-- date, update existing tasks, and always set it. `same_date` is N months from
-- the repeat anchor, and every one of these repeats from its completion date.
-- Every write now stores it (lib/task-enums.ts normalizeRepeatingData).

UPDATE "Task"
SET "repeatingData" = jsonb_set("repeatingData", '{monthRepeatType}', '"same_date"')
WHERE "repeating" = 'custom'
  AND jsonb_typeof("repeatingData") = 'object'
  AND "repeatingData" ->> 'unit' = 'months'
  AND COALESCE("repeatingData" ->> 'monthRepeatType', '') NOT IN ('same_date', 'same_weekday');
