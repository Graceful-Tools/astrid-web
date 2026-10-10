-- AWTD-1188 P6c-2: the GitHub label a label-flavor list mirrors, by node id.
-- Additive and nullable; no existing row changes. Unique, so two sync jobs
-- meeting the same new label create one list between them.
ALTER TABLE "TaskList" ADD COLUMN "remoteNodeId" TEXT;
CREATE UNIQUE INDEX "TaskList_remoteNodeId_key" ON "TaskList"("remoteNodeId");
