-- Task 518ec534: drop the hardcoded Astrid-blue defaults from the colour columns.
--
-- `NEXT_PUBLIC_BRAND_ACCENT_COLOR` reached only theme_color and the viewport;
-- every list and project a user created came out #3b82f6 regardless, because
-- the default lived in the database. The colour is now supplied by the
-- application from BRAND.accentColor (lib/brand/colors.ts).
--
-- Metadata-only: DROP DEFAULT does not rewrite the table and does not touch a
-- single existing row, so every list and project keeps the colour it has. The
-- columns stay NOT NULL, which is what makes the Prisma client require the
-- field and the compiler name any create site that forgets it.

ALTER TABLE "TaskList" ALTER COLUMN "color" DROP DEFAULT;
ALTER TABLE "Project" ALTER COLUMN "color" DROP DEFAULT;
