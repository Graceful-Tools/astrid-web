-- AWTD-1567: the scopes an access token was minted with. Additive; null = unscoped.
ALTER TABLE "MCPToken" ADD COLUMN "scope" TEXT;
