-- CreateTable
CREATE TABLE "UserListFavorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "favoriteOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserListFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserListFavorite_userId_favoriteOrder_idx" ON "UserListFavorite"("userId", "favoriteOrder");

-- CreateIndex
CREATE INDEX "UserListFavorite_listId_idx" ON "UserListFavorite"("listId");

-- CreateIndex
CREATE UNIQUE INDEX "UserListFavorite_userId_listId_key" ON "UserListFavorite"("userId", "listId");

-- AddForeignKey
ALTER TABLE "UserListFavorite" ADD CONSTRAINT "UserListFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserListFavorite" ADD CONSTRAINT "UserListFavorite_listId_fkey" FOREIGN KEY ("listId") REFERENCES "TaskList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
