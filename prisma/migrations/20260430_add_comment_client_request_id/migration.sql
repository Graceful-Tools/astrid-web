-- AlterTable
ALTER TABLE "Comment" ADD COLUMN "clientRequestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Comment_clientRequestId_key" ON "Comment"("clientRequestId");
