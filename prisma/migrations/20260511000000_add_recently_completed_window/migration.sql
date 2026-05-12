-- Per-list "Recently completed" window. NULL = legacy 24h default.
-- Shape (JSON): see lib/recently-completed-window.ts → RecentlyCompletedWindow.
ALTER TABLE "TaskList" ADD COLUMN "recentlyCompletedWindow" JSONB;
