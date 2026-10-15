-- AWTD-1117 P6a: a GitHub project's own fields and each task's values for them
-- (spec §9.4.1). Two new tables; no existing row or column changes. Only a
-- GitHub-backed board ever writes to either, so astrid.cc's stay empty.
CREATE TABLE "ProjectField" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "projectId" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dataType" TEXT NOT NULL,
    "options" JSONB,
    "iterations" JSONB,
    "mappedTo" TEXT,
    "position" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectField_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaskFieldValue" (
    "taskId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "text" TEXT,
    "number" DOUBLE PRECISION,
    "date" DATE,
    "optionId" TEXT,
    "iterationId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskFieldValue_pkey" PRIMARY KEY ("taskId","fieldId")
);

CREATE UNIQUE INDEX "ProjectField_projectId_remoteId_key" ON "ProjectField"("projectId", "remoteId");
CREATE INDEX "TaskFieldValue_projectId_updatedAt_idx" ON "TaskFieldValue"("projectId", "updatedAt");

ALTER TABLE "ProjectField" ADD CONSTRAINT "ProjectField_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskFieldValue" ADD CONSTRAINT "TaskFieldValue_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskFieldValue" ADD CONSTRAINT "TaskFieldValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "ProjectField"("id") ON DELETE CASCADE ON UPDATE CASCADE;
