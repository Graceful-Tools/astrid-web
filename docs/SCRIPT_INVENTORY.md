# Active Script Inventory

This inventory covers every top-level file directly under `scripts/`. Categories
are mutually exclusive and use the strongest known caller in this order:
`package.json` command, GitHub workflow, active operational documentation,
source/test/script caller, then no known caller.

Regenerate the evidence with `npm run docs:scripts`. `npm run check:docs` fails
when a script is added, removed, or changes category without this inventory being
updated. "Unreferenced" means no caller was found by the reproducible scan; it is
an investigation queue, not proof that deletion is safe.

## package

`backup-database.ts`, `brand-audit.ts`, `build-with-migrations.js`, `check-api-boundaries.ts`, `check-api-breaking-changes.ts`, `check-doc-links.ts`, `check-env-schema.ts`, `check-i18n.ts`, `check-model-sync.ts`, `check-offline-mutations.ts`, `check-reuse.ts`, `check-test-risk-controls.ts`, `clear-mutations.ts`, `create-e2e-auth-state.ts`, `db-safety-check.ts`, `deploy-canary.ts`, `deploy-production.ts`, `deploy-to-vercel.ts`, `expire-stale-auth-records.ts`, `fix-deployment-issues.ts`, `generate-placeholder-images.js`, `migrate-production.ts`, `monitor-vercel-logs.ts`, `optimize-database.ts`, `pre-production-ai-agent-checklist.ts`, `predeploy-check.ts`, `predeploy-self-healing.ts`, `pull-user-feedback.ts`, `quick-test-ai-agent.ts`, `report-refactoring-metrics.ts`, `report-script-inventory.ts`, `reset-database.ts`, `reset-e2e-env.sh`, `retry-failed-mutations.ts`, `review-docs-after-changes.ts`, `rotate-fixall-mcp-token.ts`, `seed.ts`, `setup-astrid-config.ts`, `setup-ios-oauth.ts`, `setup-production-db.ts`, `suggest-test-type.ts`, `sync-vendor-assets.mjs`, `test-ai-agent-workflow-local.ts`, `test-astrid-models.ts`, `test-email-config.ts`, `test-email.ts`, `test-oauth-local.ts`, `test-progressive-caching.ts`, `test-verification-logic.ts`, `trigger-workflow.ts`, `validate-mcp-oauth.ts`, `validate-production-env.ts`, `verify-production.js`, `weekly-hygiene-review.sh`, `weekly-review.ts`, `worktree-cleanup.ts`, `worktree-list.ts`, `worktree-start.ts`

## workflow

`claim-fixall-task.ts`, `deploy-preview.sh`, `extract-preview-url.sh`, `parse-ready-tasks-output.ts`, `post-session-link.ts`, `ready-tasks.ts`

## documentation

`add-task-comment.ts`, `analyze-task.ts`, `assign-task.ts`, `complete-task-with-workflow.ts`, `create-task.ts`, `debug-production-oauth.ts`, `deploy-brand-preview.ts`, `file-ios-task.ts`, `get-astrid-tasks.ts`, `get-project-tasks-oauth.ts`, `migrate-agent-email-domain.ts`, `move-task-to-list.ts`, `run-weekly-hygiene-review.mjs`, `set-task-status.ts`, `setup.sh`, `test-cloud-workflow-improvements.ts`, `test-resend-outbound.ts`, `verify-github-agent-fix.ts`, `weekly-hygiene-review.prompt.md`

## caller

`add-oauth-comment.ts`, `assign-to-agent.ts`, `backfill-analytics.ts`, `cleanup-google-backfill-open-tasks.ts`, `cleanup-test-lists.ts`, `complete-by-prefix.ts`, `complete-from-file.ts`, `complete-ios-task.ts`, `complete-task-oauth.ts`, `create-ios-tasks.ts`, `create-specific-ai-agents.ts`, `debug-task-comments.ts`, `legacy-api-coverage.ts`, `migrate-favorites-to-per-user.ts`, `migrate-hash-mcp-tokens.ts`, `migrate-hash-oauth-tokens.ts`, `reset-webhook-failures.ts`, `restart-ai-tasks.ts`, `restart-stuck-tasks.ts`, `run-prod-migration.ts`, `setup-private-key.js`, `test-api-keys.ts`, `test-claude-direct.ts`, `test-cloud-workflow-quick.ts`, `test-email-reminder.ts`, `trigger-webhook.ts`, `uitest-account.ts`, `update-list-owner.ts`, `upload-ai-agent-images.ts`, `validate-secrets.ts`

## unreferenced

`01-init-database.sql`, `add-webhook-fkey.ts`, `assign-default-images.js`, `assign-default-list-images.ts`, `check-claude-agent-user.ts`, `check-duplicate-workflows.ts`, `check-github-integration.ts`, `check-jonparis-lists.ts`, `check-list-details.ts`, `check-local-mcp-token.ts`, `check-null-creators.ts`, `check-production-ai-agents.ts`, `check-public-lists.ts`, `check-repo-connections.ts`, `check-server-env.js`, `check-stuck-workflows.ts`, `check-uitest-lists.ts`, `clear-redis-cache.ts`, `complete-with-report.ts`, `comprehensive-api-audit.ts`, `configure-list-repository.ts`, `create-demo-task.ts`, `create-minimal-png-icons.js`, `create-placeholder-images.ts`, `create-simple-icons.js`, `debug-encryption.ts`, `debug-featured-lists.ts`, `debug-members.js`, `delete-uitest-data.ts`, `deploy-migrations.js`, `deploy-production-db.ts`, `diagnose-agent-github.ts`, `dump-secure-file.ts`, `find-users.ts`, `fix-missing-creators.js`, `generate-encryption-key.js`, `generate-png-icons.js`, `generate-pwa-icons.js`, `generate-task-sounds.ts`, `get-task-attachment.ts`, `get-task-by-shortid.ts`, `get-task-detail.ts`, `grant-access-to-specific-list.ts`, `grant-ai-agent-access.ts`, `inspect-uitest-lists.ts`, `ios-tasks-direct.ts`, `mac-audit-tasks.json`, `mark-shipped-tasks-complete.ts`, `migrate-assign-default-images.js`, `migrate-members.js`, `migrate-to-favorites.sql`, `pwa-debug.js`, `seed-ai-agents.ts`, `setup-ai-agents.ts`, `setup-dev-env.ts`, `test-ai-agent-workflow.ts`, `test-ai-orchestration.ts`, `test-api-save.ts`, `test-claude-api.ts`, `test-coding-agent-detection.ts`, `test-coding-agent-util.ts`, `test-complete-ai-workflow.ts`, `test-copy-utils.ts`, `test-full-auth.js`, `test-github-agent-connection.ts`, `test-github-client.ts`, `test-list-data.ts`, `test-oauth-locally.ts`, `test-phase2-workflow.ts`, `test-phase3-github.ts`, `test-profile-api.ts`, `test-public-api-endpoints.ts`, `test-resend-setup.ts`, `test-role-update.js`, `test-schema-validation.ts`, `test-simple-coding-workflow.ts`, `test-staging-links.ts`, `test-stats.ts`, `test-task-assignment.ts`, `test-task-counting.ts`, `test-workflow-cancellation.ts`, `test-workflow-improvements.ts`, `trigger-webhook-test.ts`, `trigger-workflow-manually.ts`, `update-all-user-stats.ts`

## Archive pair review

The remaining same-name pairs were compared against their shared archive-creation
commit and their current implementations. Nineteen archive files that differed
only because the active version adopted `scripts/lib/load-env.ts` were removed;
they preserved no historical behavior beyond an obsolete environment loader.

Two divergent pairs remain intentionally:

- `create-specific-ai-agents.ts`: the archive preserves the former hardcoded
  four-agent setup; active code uses brand-aware enabled mailboxes and dynamic
  profiles.
- `validate-secrets.ts`: the archive preserves retired Claude Remote/Fly.io and
  Anthropic checks; active code validates the current Astrid/OAuth/GitHub setup.

Historical documentation archives are not script callers and are excluded from
the inventory.
