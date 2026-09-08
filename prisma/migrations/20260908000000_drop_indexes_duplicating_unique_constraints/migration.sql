-- Task 466c10f1: drop the 17 indexes that duplicate a UNIQUE constraint, and
-- give the 15-minute GitHub sync an index to filter on.
--
-- WHY THESE 17 ARE SAFE WITHOUT A QUERY PLAN. Postgres implements a UNIQUE
-- constraint by building a unique B-tree index on exactly those columns. Each
-- index dropped below sits on the same column as a "<Table>_<col>_key" unique
-- index that stays, so it can serve no lookup, no ordering and no range that
-- the surviving index cannot. This is a property of how the index is built,
-- not a claim about any workload — there is no plan that could prefer the
-- duplicate. What they do cost is real: a second B-tree maintained on every
-- INSERT, UPDATE and DELETE.
--
-- Six of them are on the authentication path — MCPToken.token,
-- OAuthClient.clientId, OAuthToken.accessToken, OAuthAuthorizationCode.code,
-- Shortcode.code, Invitation.token, ListInvite.token — where the write
-- amplification is paid on token issue, refresh and revoke.
--
-- IF CONCURRENTLY MATTERS: DROP INDEX takes an ACCESS EXCLUSIVE lock on the
-- table for the duration, but dropping an index is a catalogue update, not a
-- table rewrite, so it is brief even on Task and User. It is not written
-- CONCURRENTLY because Prisma runs each migration inside a transaction and
-- DROP INDEX CONCURRENTLY cannot run in one.
--
-- IF NOT EXISTS on every statement: this file must be re-runnable against a
-- database where an earlier partial apply already removed some of them.

DROP INDEX IF EXISTS "public"."User_email_idx";
DROP INDEX IF EXISTS "public"."User_emailVerificationToken_idx";
DROP INDEX IF EXISTS "public"."SecureFile_blobUrl_idx";
DROP INDEX IF EXISTS "public"."Invitation_token_idx";
DROP INDEX IF EXISTS "public"."ListInvite_token_idx";
DROP INDEX IF EXISTS "public"."ReminderSettings_userId_idx";
-- UserWebhookConfig carries @@map("user_webhook_configs"), so its index is
-- named for the TABLE, not the model. The surviving unique index is
-- "user_webhook_configs_userId_key".
DROP INDEX IF EXISTS "public"."user_webhook_configs_userId_idx";
DROP INDEX IF EXISTS "public"."MCPToken_token_idx";
DROP INDEX IF EXISTS "public"."OAuthClient_clientId_idx";
DROP INDEX IF EXISTS "public"."OAuthToken_accessToken_idx";
DROP INDEX IF EXISTS "public"."OAuthAuthorizationCode_code_idx";
DROP INDEX IF EXISTS "public"."CodingTaskWorkflow_taskId_idx";
DROP INDEX IF EXISTS "public"."Shortcode_code_idx";
DROP INDEX IF EXISTS "public"."ChatChannel_listId_idx";
DROP INDEX IF EXISTS "public"."ChatChannel_virtualKey_idx";
DROP INDEX IF EXISTS "public"."AnalyticsDailyStats_date_idx";
DROP INDEX IF EXISTS "public"."CopilotCredential_userId_idx";

-- ADDITIVE, and the one change here that is about reads.
--
-- lib/sync/github/sync-all-links.ts runs, every 15 minutes:
--
--   SELECT ... FROM "ExternalListLink"
--   WHERE provider = 'GITHUB_ISSUES'
--   ORDER BY "lastReconciledAt" ASC NULLS FIRST
--   LIMIT <MAX_LINKS_PER_PASS>
--
-- ExternalListLink had indexes on astridListId and integrationId only, so
-- neither the filter nor the ordering had anything to use.
--
-- CAVEAT, stated rather than glossed: this index is (provider,
-- "lastReconciledAt") in the default ASC NULLS LAST order, and the query asks
-- for NULLS FIRST. Postgres cannot use it to satisfy that ordering, so the
-- sort remains — this index earns its place on the predicate, by turning a
-- sequential scan of the table into a scan of one provider's rows. Making the
-- ORDER BY index-driven too would need (provider, "lastReconciledAt" ASC NULLS
-- FIRST), which Prisma's @@index syntax cannot express; that is worth doing
-- only if a production plan shows the sort mattering.

CREATE INDEX IF NOT EXISTS "ExternalListLink_provider_lastReconciledAt_idx"
  ON "public"."ExternalListLink"("provider", "lastReconciledAt");
