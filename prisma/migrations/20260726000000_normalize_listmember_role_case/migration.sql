-- Task e2803305: ListMember.role is compared lowercase almost everywhere
-- (schema default is 'member'), but app/api/v1/lists created members with
-- role 'MEMBER'. Those rows match no lowercase comparison, so the affected
-- users had no access to the list they were added to.
--
-- The permission helper now lowercases before comparing, which repairs the
-- user-facing symptom, but raw Prisma queries that filter `role: 'member'`
-- still miss these rows. Normalise the stored data so both paths agree.
UPDATE "ListMember" SET "role" = LOWER("role") WHERE "role" <> LOWER("role");
