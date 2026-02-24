-- AlterTable
ALTER TABLE "Task" ADD COLUMN "clientRequestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Task_clientRequestId_key" ON "Task"("clientRequestId");
