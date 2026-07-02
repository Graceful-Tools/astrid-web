-- Subtask display preference: "indented" (show in lists, indented) | "under_parent" (detail only)
ALTER TABLE "User" ADD COLUMN "subtaskDisplay" TEXT DEFAULT 'indented';
