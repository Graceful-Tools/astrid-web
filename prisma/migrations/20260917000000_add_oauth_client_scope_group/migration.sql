-- Record which SCOPE_GROUPS entry an OAuth client was provisioned from, so its
-- scopes can be reconciled to that group on use (task 9ebfaba7).
--
-- Additive and nullable ON PURPOSE. NULL is the "never reconcile" state, and
-- every row that exists when this lands gets it: no client gains a scope as a
-- side effect of this migration. Clients adopt a group through application
-- code, which is reviewable, rather than through a blanket UPDATE here.
ALTER TABLE "OAuthClient" ADD COLUMN "scopeGroup" TEXT;
