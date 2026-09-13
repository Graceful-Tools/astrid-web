-- Per-user list view state: the sort you chose and the filters you applied.
--
-- Sort and filters were columns on the shared TaskList row, so changing one on
-- a shared list changed it for every member (task aa4e7eb0). They are now
-- per-user, keyed on userId -- which is what "AI agents and humans" means
-- here, since an agent is a User row.
--
-- PURELY ADDITIVE. No TaskList column is dropped or altered: those columns stay
-- as the fallback for a user who has no row here, so an untouched list looks
-- exactly as it did and a rollback strands nobody. manualSortOrder deliberately
-- stays on TaskList -- the arrangement is shared, only the choice to sort by it
-- is personal.

-- CreateTable
CREATE TABLE "UserListViewPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "sortBy" TEXT,
    "filterPriority" TEXT,
    "filterAssignee" TEXT,
    "filterDueDate" TEXT,
    "filterCompletion" TEXT,
    "filterRepeating" TEXT,
    "filterAssignedBy" TEXT,
    "filterInLists" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserListViewPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserListViewPreference_listId_idx" ON "UserListViewPreference"("listId");

-- CreateIndex
CREATE UNIQUE INDEX "UserListViewPreference_userId_listId_key" ON "UserListViewPreference"("userId", "listId");

-- AddForeignKey
ALTER TABLE "UserListViewPreference" ADD CONSTRAINT "UserListViewPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserListViewPreference" ADD CONSTRAINT "UserListViewPreference_listId_fkey" FOREIGN KEY ("listId") REFERENCES "TaskList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

