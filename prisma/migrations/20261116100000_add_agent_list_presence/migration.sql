-- AWTD-1697: per-board agent presence. Additive only: one new table.

-- CreateTable
CREATE TABLE "AgentListPresence" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "lastQueueCheckAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "quietNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentListPresence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentListPresence_listId_agentId_key" ON "AgentListPresence"("listId", "agentId");

-- CreateIndex
CREATE INDEX "AgentListPresence_agentId_idx" ON "AgentListPresence"("agentId");

-- AddForeignKey
ALTER TABLE "AgentListPresence" ADD CONSTRAINT "AgentListPresence_listId_fkey" FOREIGN KEY ("listId") REFERENCES "TaskList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentListPresence" ADD CONSTRAINT "AgentListPresence_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
