ALTER TABLE "MCPToken" ADD COLUMN "agentUserId" TEXT;
ALTER TABLE "MCPToken" ADD COLUMN "agentMailbox" TEXT;

UPDATE "MCPToken"
SET "agentMailbox" = 'copilot'
WHERE "description" = 'GitHub Copilot cloud agent'
  AND "agentMailbox" IS NULL;

CREATE INDEX "MCPToken_agentUserId_idx" ON "MCPToken"("agentUserId");

ALTER TABLE "MCPToken"
ADD CONSTRAINT "MCPToken_agentUserId_fkey"
FOREIGN KEY ("agentUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
