-- Scrub bearer tokens out of telemetry routes (task fdcd6c03).
--
-- `normalizeLegacyRoute` collapsed uuid/cuid/numeric segments but not invite
-- tokens (`inv_` + 32 hex chars) or share shortcodes (8-char nanoids), so the
-- raw credentials were stored verbatim in `WebVitalSample.route` and
-- `LegacyApiDailyUsage.route`. The code fix in lib/legacy-api-usage.ts stops
-- the leak going forward; this rewrites the rows already written.
--
-- `WebVitalSample` has no unique key on route: rewrite in place, keeping the
-- samples (the p75 budget needs them).
UPDATE "WebVitalSample"
SET "route" = regexp_replace(
    regexp_replace("route", '/invite/inv_[0-9a-fA-F]{32}', '/invite/:id', 'g'),
    '(/s/)[0-9A-Za-z]{8}($|/)', '\1:id\2', 'g'
  )
WHERE "route" ~ '/invite/inv_[0-9a-fA-F]{32}'
   OR "route" ~ '/s/[0-9A-Za-z]{8}($|/)';

-- `LegacyApiDailyUsage` is unique on (day, route, method, platform): two token
-- rows for the same day collapse onto one normalized row, so merge the counts
-- rather than violating the constraint.
DO $$
DECLARE
  r RECORD;
  normalized TEXT;
  target_id TEXT;
BEGIN
  FOR r IN
    SELECT * FROM "LegacyApiDailyUsage"
    WHERE "route" ~ '/invitations/inv_[0-9a-fA-F]{32}'
       OR "route" ~ '/shortcodes/[0-9A-Za-z]{8}($|/)'
  LOOP
    normalized := regexp_replace(
      regexp_replace(r."route", '/invitations/inv_[0-9a-fA-F]{32}', '/invitations/:id', 'g'),
      '(/(v1/)?shortcodes/)[0-9A-Za-z]{8}($|/)', '\1:id\3', 'g'
    );
    -- Never merge a row into itself: if the replace patterns ever miss a
    -- route the WHERE matched, the row must be left alone, not doubled
    -- and deleted.
    SELECT "id" INTO target_id FROM "LegacyApiDailyUsage"
      WHERE "day" = r."day" AND "route" = normalized
        AND "method" = r."method" AND "platform" = r."platform"
        AND "id" <> r."id"
      LIMIT 1;
    IF target_id IS NOT NULL THEN
      UPDATE "LegacyApiDailyUsage"
        SET "count" = "count" + r."count", "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = target_id;
      DELETE FROM "LegacyApiDailyUsage" WHERE "id" = r."id";
    ELSIF normalized <> r."route" THEN
      UPDATE "LegacyApiDailyUsage" SET "route" = normalized WHERE "id" = r."id";
    END IF;
  END LOOP;
END $$;
